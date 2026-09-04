import Foundation

enum BirdieMomentsAPIError: LocalizedError {
    case invalidResponse
    case invalidPayload
    case recoveryNotConfigured
    case server(status: Int, code: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Birdie Moments hat keine gültige Serverantwort erhalten."
        case .invalidPayload:
            return "Birdie Moments hat eine unvollständige Serverantwort erhalten."
        case .recoveryNotConfigured:
            return "Birdie Moments StoreKit-Recovery ist noch nicht konfiguriert."
        case let .server(status, code):
            return code.map { "Birdie Moments Serverfehler \(status): \($0)" }
                ?? "Birdie Moments Serverfehler \(status)."
        }
    }
}

protocol BirdieMomentsRequestAuthorizing: Sendable {
    func authorize(_ request: URLRequest) async throws -> URLRequest
}

struct BirdieMomentsAPIEndpoints: Sendable {
    let startAppStorePurchase: @Sendable (_ momentId: String) throws -> URL
    let confirmAppStorePurchase: @Sendable (_ purchaseId: String) throws -> URL
    let recoverAppStorePurchase: (@Sendable () throws -> URL)?

    init(
        startAppStorePurchase: @escaping @Sendable (_ momentId: String) throws -> URL,
        confirmAppStorePurchase: @escaping @Sendable (_ purchaseId: String) throws -> URL,
        recoverAppStorePurchase: (@Sendable () throws -> URL)? = nil
    ) {
        self.startAppStorePurchase = startAppStorePurchase
        self.confirmAppStorePurchase = confirmAppStorePurchase
        self.recoverAppStorePurchase = recoverAppStorePurchase
    }
}

struct BirdieMomentsAppStoreIntent: Decodable, Sendable {
    let status: String
    let purchaseId: String
    let productType: String?
    let appStoreProductId: String?
    let appAccountToken: String?
    let downloadHref: String?
}

struct BirdieMomentsAppStoreConfirmation: Decodable, Sendable {
    let processed: Bool
    let duplicate: Bool?
    let status: String
    let purchaseId: String
    let transactionId: String?
    let entitlementGrantedAt: String?
    let downloadHref: String?
}

private struct BirdieMomentsConfirmBody: Encodable {
    let signedTransactionInfo: String
}

private struct BirdieMomentsErrorBody: Decodable {
    let error: String?
}

final class BirdieMomentsAPIClient: @unchecked Sendable {
    private let session: URLSession
    private let endpoints: BirdieMomentsAPIEndpoints
    private let authorizer: (any BirdieMomentsRequestAuthorizing)?
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(
        session: URLSession = .shared,
        endpoints: BirdieMomentsAPIEndpoints,
        authorizer: (any BirdieMomentsRequestAuthorizing)? = nil
    ) {
        self.session = session
        self.endpoints = endpoints
        self.authorizer = authorizer
    }

    func startAppStorePurchase(momentId: String) async throws -> BirdieMomentsAppStoreIntent {
        let url = try endpoints.startAppStorePurchase(momentId)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        return try await send(request, as: BirdieMomentsAppStoreIntent.self)
    }

    func confirmAppStorePurchase(
        purchaseId: String,
        signedTransactionInfo: String
    ) async throws -> BirdieMomentsAppStoreConfirmation {
        let url = try endpoints.confirmAppStorePurchase(purchaseId)
        return try await postSignedTransaction(url: url, signedTransactionInfo: signedTransactionInfo)
    }

    func recoverAppStorePurchase(
        signedTransactionInfo: String
    ) async throws -> BirdieMomentsAppStoreConfirmation {
        guard let endpoint = endpoints.recoverAppStorePurchase else {
            throw BirdieMomentsAPIError.recoveryNotConfigured
        }
        let url = try endpoint()
        return try await postSignedTransaction(url: url, signedTransactionInfo: signedTransactionInfo)
    }

    private func postSignedTransaction(
        url: URL,
        signedTransactionInfo: String
    ) async throws -> BirdieMomentsAppStoreConfirmation {
        guard !signedTransactionInfo.isEmpty else {
            throw BirdieMomentsAPIError.invalidPayload
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(
            BirdieMomentsConfirmBody(signedTransactionInfo: signedTransactionInfo)
        )
        return try await send(request, as: BirdieMomentsAppStoreConfirmation.self)
    }

    private func send<T: Decodable>(_ originalRequest: URLRequest, as type: T.Type) async throws -> T {
        let request: URLRequest
        if let authorizer {
            request = try await authorizer.authorize(originalRequest)
        } else {
            request = originalRequest
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BirdieMomentsAPIError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            let errorBody = try? decoder.decode(BirdieMomentsErrorBody.self, from: data)
            throw BirdieMomentsAPIError.server(status: http.statusCode, code: errorBody?.error)
        }

        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw BirdieMomentsAPIError.invalidPayload
        }
    }
}
