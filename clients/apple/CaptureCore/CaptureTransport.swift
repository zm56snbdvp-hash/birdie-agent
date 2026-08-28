import Foundation

public struct CaptureContractPart: Codable, Equatable, Sendable {
    public let id: UUID
    public let kind: CapturePayloadKind
    public let displayName: String
    public let typeIdentifier: String?
    public let byteCount: Int64?
    public let sha256: String?
    public let inlineText: String?
}

public struct CaptureSubmissionRequest: Codable, Equatable, Sendable {
    public static let contractVersion = "birdie.capture.v1"

    public let contract: String
    public let captureID: UUID
    public let idempotencyKey: String
    public let createdAt: Date
    public let source: CaptureSource
    public let requestedIntent: CaptureIntent
    public let parts: [CaptureContractPart]
    public let suggestions: [CaptureSuggestion]
    public let requiresUserReview: Bool
    public let originalsConfirmedForLocalStaging: Bool
    public let originalPolicy: CaptureOriginalPolicy

    public init(item: CaptureItem) throws {
        guard item.schemaVersion == CaptureItem.currentSchemaVersion else {
            throw CaptureCoreError.unsupportedSchema(item.schemaVersion)
        }
        guard item.originalStorageConsent == .confirmed else {
            throw CaptureCoreError.invalidPayload("Die lokale Übernahme wurde noch nicht bestätigt.")
        }
        if item.originalPolicy == .derivedTextOnly,
           item.payloads.contains(where: { [.image, .pdf, .file].contains($0.kind) }) {
            throw CaptureCoreError.invalidPayload("Originaldateien sind für diesen Eintrag nicht freigegeben.")
        }
        try Self.validate(payloads: item.payloads)
        self.contract = Self.contractVersion
        self.captureID = item.id
        self.idempotencyKey = item.idempotencyKey
        self.createdAt = item.createdAt
        self.source = item.source
        self.requestedIntent = item.intent
        self.parts = item.payloads.map {
            CaptureContractPart(
                id: $0.id,
                kind: $0.kind,
                displayName: $0.displayName,
                typeIdentifier: $0.typeIdentifier,
                byteCount: $0.byteCount,
                sha256: $0.sha256,
                inlineText: $0.inlineText
            )
        }
        self.suggestions = item.suggestions
        self.requiresUserReview = true
        self.originalsConfirmedForLocalStaging = true
        self.originalPolicy = item.originalPolicy
    }

    private static func validate(payloads: [CapturePayload]) throws {
        guard (1...CaptureLimits.maximumPartCount).contains(payloads.count) else {
            throw CaptureCoreError.invalidPayload("Ein Capture benötigt 1 bis 20 Inhalte.")
        }
        var totalBytes: Int64 = 0
        for payload in payloads {
            switch (payload.inlineText, payload.relativeFilePath) {
            case (.some(let text), .none):
                guard [.url, .text, .recognizedText].contains(payload.kind) else {
                    throw CaptureCoreError.invalidPayload("Dieser Inhaltstyp darf nicht inline übertragen werden.")
                }
                let count = Int64(text.utf8.count)
                guard count > 0,
                      count <= Int64(CaptureLimits.maximumTextBytes),
                      payload.byteCount == nil || payload.byteCount == count else {
                    throw CaptureCoreError.invalidPayload("Inline-Text ist zu groß oder inkonsistent.")
                }
                totalBytes += count
            case (.none, .some):
                guard [.image, .pdf, .file].contains(payload.kind),
                      let byteCount = payload.byteCount,
                      byteCount > 0,
                      byteCount <= CaptureLimits.maximumFileBytes,
                      let checksum = payload.sha256,
                      checksum.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
                    throw CaptureCoreError.invalidPayload("Dateimetadaten sind unvollständig oder inkonsistent.")
                }
                totalBytes += byteCount
            default:
                throw CaptureCoreError.invalidPayload("Jeder Inhalt braucht genau eine lokale oder inline Quelle.")
            }
            guard totalBytes <= CaptureLimits.maximumTotalBytes else {
                throw CaptureCoreError.invalidPayload("Der Capture überschreitet das Gesamtlimit von 250 MB.")
            }
        }
    }
}

public struct CaptureSubmissionReceipt: Codable, Equatable, Sendable {
    public enum Disposition: String, Codable, Sendable {
        case localPreviewOnly
        case acceptedByBackend
    }

    public let captureID: UUID
    public let idempotencyKey: String
    public let disposition: Disposition
    public let receivedAt: Date
    public let serverReceiptID: String?
    public let processingState: String?

    public init(
        request: CaptureSubmissionRequest,
        receivedAt: Date = Date(),
        disposition: Disposition = .localPreviewOnly,
        serverReceiptID: String? = nil,
        processingState: String? = nil
    ) {
        self.captureID = request.captureID
        self.idempotencyKey = request.idempotencyKey
        self.disposition = disposition
        self.receivedAt = receivedAt
        self.serverReceiptID = serverReceiptID
        self.processingState = processingState
    }
}

public enum CaptureAdapterError: LocalizedError, Equatable {
    case offline
    case retryable(code: String, message: String)
    case permanent(code: String, message: String)

    public var errorDescription: String? {
        switch self {
        case .offline:
            "Birdie ist offline. Der Inhalt bleibt lokal in der Warteschlange."
        case .retryable(_, let message), .permanent(_, let message):
            message
        }
    }

    var failure: CaptureFailure {
        switch self {
        case .offline:
            CaptureFailure(code: "offline", message: errorDescription!, isRetryable: true)
        case .retryable(let code, let message):
            CaptureFailure(code: code, message: message, isRetryable: true)
        case .permanent(let code, let message):
            CaptureFailure(code: code, message: message, isRetryable: false)
        }
    }
}

public protocol CaptureTransportAdapter: Sendable {
    func submit(_ request: CaptureSubmissionRequest) async throws -> CaptureSubmissionReceipt
}

public struct CaptureBackendConfiguration: Sendable, Equatable {
    public let baseURL: URL
    public let capturesPath: String

    public init(baseURL: URL, capturesPath: String = "/v1/captures") throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
            throw CaptureAdapterError.permanent(
                code: "invalid_backend_configuration",
                message: "Der Capture-Backend-Endpunkt muss HTTPS verwenden."
            )
        }
        let normalizedPath = capturesPath.hasPrefix("/") ? capturesPath : "/\(capturesPath)"
        guard normalizedPath.contains("/v1/") else {
            throw CaptureAdapterError.permanent(
                code: "invalid_backend_configuration",
                message: "Der Capture-Backend-Endpunkt muss versioniert sein."
            )
        }
        self.baseURL = baseURL
        self.capturesPath = normalizedPath
    }

    var capturesURL: URL {
        baseURL.appendingPathComponent(capturesPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }
}

public protocol CaptureAccessTokenProvider: Sendable {
    func accessToken() async throws -> String?
}

/// Backend adapter scaffold. It is intentionally not used by the app until the
/// contract in BIRDIE_CAPTURE_BACKEND_CONTRACT.md is approved and a token provider
/// is supplied by the authenticated main-app session.
public struct HTTPSCaptureBackendAdapter: CaptureTransportAdapter {
    private let configuration: CaptureBackendConfiguration
    private let tokenProvider: any CaptureAccessTokenProvider

    public init(
        configuration: CaptureBackendConfiguration,
        tokenProvider: any CaptureAccessTokenProvider
    ) {
        self.configuration = configuration
        self.tokenProvider = tokenProvider
    }

    public func submit(_ request: CaptureSubmissionRequest) async throws -> CaptureSubmissionReceipt {
        guard request.originalPolicy == .derivedTextOnly else {
            throw CaptureAdapterError.permanent(
                code: "original_upload_not_enabled",
                message: "Originaldatei-Uploads benötigen zuerst den freigegebenen Background-Upload-Vertrag."
            )
        }
        guard let token = try await tokenProvider.accessToken(), !token.isEmpty else {
            throw CaptureAdapterError.permanent(
                code: "authentication_required",
                message: "Für die externe Übergabe ist eine gültige Anmeldung erforderlich."
            )
        }

        var urlRequest = URLRequest(url: configuration.capturesURL)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = 30
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue(request.idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try Self.encode(BackendCaptureRequest(request: request))

        do {
            let (data, response) = try await URLSession.shared.data(for: urlRequest)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw CaptureAdapterError.retryable(code: "invalid_response", message: "Das Backend hat keine HTTP-Antwort geliefert.")
            }
            switch httpResponse.statusCode {
            case 200, 202:
                guard let receipt = try? Self.decode(BackendCaptureResponse.self, from: data),
                      receipt.captureID == request.captureID,
                      !receipt.serverReceiptID.isEmpty else {
                    throw CaptureAdapterError.permanent(code: "invalid_backend_response", message: "Die Backend-Antwort ist unvollständig.")
                }
                return CaptureSubmissionReceipt(
                    request: request,
                    disposition: .acceptedByBackend,
                    serverReceiptID: receipt.serverReceiptID,
                    processingState: receipt.processingState
                )
            case 401, 403:
                throw CaptureAdapterError.permanent(code: "authentication_rejected", message: "Die Backend-Anmeldung wurde abgelehnt.")
            case 409:
                throw CaptureAdapterError.permanent(code: "idempotency_conflict", message: "Der Idempotenzschlüssel ist bereits mit anderem Inhalt belegt.")
            case 413:
                throw CaptureAdapterError.permanent(code: "payload_too_large", message: "Der Capture ist für das Backend zu groß.")
            case 408, 429, 500...599:
                throw CaptureAdapterError.retryable(code: "backend_temporary", message: "Das Backend ist vorübergehend nicht verfügbar.")
            default:
                throw CaptureAdapterError.permanent(code: "backend_rejected", message: "Das Backend hat den Capture abgelehnt (HTTP \(httpResponse.statusCode)).")
            }
        } catch let error as CaptureAdapterError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw CaptureAdapterError.retryable(code: "network_unavailable", message: "Die externe Übergabe konnte nicht erreicht werden.")
        }
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: data)
    }
}

private struct BackendCaptureRequest: Encodable {
    let contract: String
    let captureID: UUID
    let idempotencyKey: String
    let createdAt: Date
    let source: String
    let intent: CaptureIntent
    let parts: [BackendCapturePart]
    let derivedText: String?
    let suggestions: [CaptureSuggestion]
    let requiresUserReview: Bool
    let originalPolicy: CaptureOriginalPolicy
    let pcTarget: String? = nil

    init(request: CaptureSubmissionRequest) {
        self.contract = request.contract
        self.captureID = request.captureID
        self.idempotencyKey = request.idempotencyKey
        self.createdAt = request.createdAt
        self.source = request.source.backendValue
        self.intent = request.requestedIntent
        self.parts = request.parts.map(BackendCapturePart.init)
        self.derivedText = request.parts.compactMap(\.inlineText).joined(separator: "\n\n").nilIfEmpty
        self.suggestions = request.suggestions
        self.requiresUserReview = request.requiresUserReview
        self.originalPolicy = request.originalPolicy
    }
}

private extension CaptureSource {
    var backendValue: String {
        switch self {
        case .shareExtension:
            "share"
        case .document, .receipt, .businessCard, .whiteboard, .errorMessage:
            "lens"
        }
    }
}

private struct BackendCapturePart: Encodable {
    let partID: UUID
    let kind: CapturePayloadKind
    let displayName: String
    let contentType: String?
    let byteCount: Int64?
    let sha256: String?

    init(_ part: CaptureContractPart) {
        self.partID = part.id
        self.kind = part.kind
        self.displayName = part.displayName
        self.contentType = part.typeIdentifier
        self.byteCount = part.byteCount
        self.sha256 = part.sha256
    }
}

private struct BackendCaptureResponse: Decodable {
    let captureID: UUID
    let serverReceiptID: String
    let processingState: String?
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Default adapter until a reviewed backend exists. It writes only the versioned request
/// manifest to the protected App Group outbox and never performs a network request or action.
public struct LocalCaptureMockAdapter: CaptureTransportAdapter {
    private let locations: CaptureStoreLocations

    public init(locations: CaptureStoreLocations) {
        self.locations = locations
    }

    public func submit(_ request: CaptureSubmissionRequest) async throws -> CaptureSubmissionReceipt {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(request)
        let destination = locations.outbox.appendingPathComponent(
            "\(request.captureID.uuidString.lowercased()).json"
        )
        let tombstone = locations.tombstones.appendingPathComponent(
            "\(request.captureID.uuidString.lowercased()).deleted"
        )
        guard !FileManager.default.fileExists(atPath: tombstone.path) else {
            throw CaptureAdapterError.permanent(
                code: "capture_deleted",
                message: "Der Capture-Eintrag wurde gelöscht."
            )
        }
        if FileManager.default.fileExists(atPath: destination.path) {
            let existingData = try Data(contentsOf: destination)
            guard existingData == data else {
                throw CaptureAdapterError.permanent(
                    code: "idempotency_conflict",
                    message: "Der lokale Capture-Vertrag stimmt nicht mit dem vorhandenen Eintrag überein."
                )
            }
            do {
                try ProtectedFileWriter.applySensitiveAttributes(to: destination)
            } catch {
                try? FileManager.default.removeItem(at: destination)
                throw error
            }
            return CaptureSubmissionReceipt(request: request)
        }
        try ProtectedFileWriter.write(data, to: destination)
        if FileManager.default.fileExists(atPath: tombstone.path) {
            try? FileManager.default.removeItem(at: destination)
            throw CaptureAdapterError.permanent(
                code: "capture_deleted",
                message: "Der Capture-Eintrag wurde während der Vorbereitung gelöscht."
            )
        }
        return CaptureSubmissionReceipt(request: request)
    }
}

public actor CaptureQueueProcessor {
    private let store: CaptureQueueStore
    private let adapter: any CaptureTransportAdapter
    private let now: @Sendable () -> Date
    private let retryDelays: [TimeInterval]

    public init(
        store: CaptureQueueStore,
        adapter: any CaptureTransportAdapter,
        retryDelays: [TimeInterval] = [30, 120, 600, 3_600],
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.adapter = adapter
        self.retryDelays = retryDelays.isEmpty ? [30] : retryDelays
        self.now = now
    }

    public func processDueItems() async {
        guard let items = try? store.allItems() else { return }
        for item in items where isDue(item) {
            await process(itemID: item.id)
        }
    }

    public func retryNow(itemID: UUID) async {
        _ = try? store.update(id: itemID) { item in
            item.status = .queued
            item.nextRetryAt = nil
            item.lastFailure = nil
        }
        await process(itemID: itemID)
    }

    private func isDue(_ item: CaptureItem) -> Bool {
        switch item.status {
        case .staged, .queued:
            true
        case .retryScheduled:
            item.nextRetryAt.map { $0 <= now() } ?? true
        case .processing:
            item.updatedAt <= now().addingTimeInterval(-300)
        case .readyForReview, .failed:
            false
        }
    }

    private func process(itemID: UUID) async {
        do {
            let processing = try store.update(id: itemID) { item in
                item.status = .processing
                item.attemptCount += 1
                item.lastFailure = nil
            }
            let request = try CaptureSubmissionRequest(item: processing)
            try store.validateIntegrity(of: processing)
            _ = try await adapter.submit(request)
            _ = try store.update(id: itemID) { item in
                item.status = .readyForReview
                item.nextRetryAt = nil
                item.lastFailure = nil
            }
        } catch {
            let adapterError: CaptureAdapterError
            if let known = error as? CaptureAdapterError {
                adapterError = known
            } else if error is CaptureCoreError {
                adapterError = .permanent(code: "invalid_contract", message: error.localizedDescription)
            } else {
                adapterError = .retryable(code: "adapter_error", message: error.localizedDescription)
            }
            try? schedule(adapterError, itemID: itemID)
        }
    }

    private func schedule(_ error: CaptureAdapterError, itemID: UUID) throws {
        _ = try store.update(id: itemID) { item in
            let failure = error.failure
            item.lastFailure = failure
            guard failure.isRetryable, item.attemptCount <= retryDelays.count else {
                item.status = .failed
                item.nextRetryAt = nil
                return
            }
            item.status = .retryScheduled
            let delayIndex = max(0, item.attemptCount - 1)
            item.nextRetryAt = now().addingTimeInterval(retryDelays[delayIndex])
        }
    }
}
