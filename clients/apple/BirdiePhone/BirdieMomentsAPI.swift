import Foundation

struct BirdieMomentPurchaseIntent: Decodable, Sendable {
    let status: String
    let purchaseId: String
    let productType: String?
    let appStoreProductId: String?
    let appAccountToken: String?
    let downloadHref: String?

    var isAlreadyPurchased: Bool { status == "ALREADY_PURCHASED" }
}

struct BirdieMomentPurchaseConfirmation: Decodable, Sendable {
    let processed: Bool
    let duplicate: Bool?
    let status: String
    let purchaseId: String
    let entitlementGrantedAt: String?
}

enum BirdieMomentsAPIError: LocalizedError {
    case invalidConfiguration(String)
    case invalidResponse
    case http(status: Int, code: String?)
    case malformedPayload

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration(let message): return message
        case .invalidResponse: return "Birdie Moments returned an invalid HTTP response."
        case .http(let status, let code): return "Birdie Moments request failed (HTTP \(status)\(code.map { ", \($0)" } ?? ""))."
        case .malformedPayload: return "Birdie Moments returned an unreadable response."
        }
    }
}

struct BirdieMomentsAPIConfiguration: Sendable {
    let baseURL: URL
    let startPurchasePath: @Sendable (String) -> String
    let confirmPurchasePath: @Sendable (String) -> String

    init(
        baseURL: URL,
        startPurchasePath: @escaping @Sendable (String) -> String = { momentId in
            "/api/moments/\(momentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? momentId)/app-store/start"
        },
        confirmPurchasePath: @escaping @Sendable (String) -> String = { purchaseId in
            "/api/moment-purchases/\(purchaseId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? purchaseId)/app-store/confirm"
        }
    ) {
        self.baseURL = baseURL
        self.startPurchasePath = startPurchasePath
        self.confirmPurchasePath = confirmPurchasePath
    }
}

actor BirdieMomentsAPI {
    typealias AuthenticatedSend = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private struct ErrorEnvelope: Decodable { let error: String? }
    private struct ConfirmBody: Encodable { let signedTransactionInfo: String }

    private let configuration: BirdieMomentsAPIConfiguration
    private let send: AuthenticatedSend
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(configuration: BirdieMomentsAPIConfiguration, send: @escaping AuthenticatedSend) {
        self.configuration = configuration
        self.send = send
    }

    func startDigitalPurchase(momentId: String) async throws -> BirdieMomentPurchaseIntent {
        guard !momentId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BirdieMomentsAPIError.invalidConfiguration("momentId is required.")
        }
        var request = try makeRequest(path: configuration.startPurchasePath(momentId), method: "POST")
        request.httpBody = Data("{}".utf8)
        return try await perform(request, as: BirdieMomentPurchaseIntent.self)
    }

    func confirmDigitalPurchase(purchaseId: String, signedTransactionInfo: String) async throws -> BirdieMomentPurchaseConfirmation {
        guard !purchaseId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BirdieMomentsAPIError.invalidConfiguration("purchaseId is required.")
        }
        guard !signedTransactionInfo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BirdieMomentsAPIError.invalidConfiguration("signedTransactionInfo is required.")
        }
        var request = try makeRequest(path: configuration.confirmPurchasePath(purchaseId), method: "POST")
        request.httpBody = try encoder.encode(ConfirmBody(signedTransactionInfo: signedTransactionInfo))
        return try await perform(request, as: BirdieMomentPurchaseConfirmation.self)
    }

    private func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: configuration.baseURL)?.absoluteURL,
              url.scheme == configuration.baseURL.scheme,
              url.host == configuration.baseURL.host else {
            throw BirdieMomentsAPIError.invalidConfiguration("Birdie Moments endpoint path is invalid.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else {
            let code = try? decoder.decode(ErrorEnvelope.self, from: data).error
            throw BirdieMomentsAPIError.http(status: response.statusCode, code: code ?? nil)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw BirdieMomentsAPIError.malformedPayload
        }
    }
}

extension BirdieMomentsAPI {
    static func urlSessionTransport(_ session: URLSession) -> AuthenticatedSend {
        return { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw BirdieMomentsAPIError.invalidResponse
            }
            return (data, http)
        }
    }
}
