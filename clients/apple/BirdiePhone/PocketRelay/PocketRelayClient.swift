import Foundation

struct PocketRelayPairRequest: Encodable, Sendable {
    let pairingCode: String
    let deviceName: String
    let platform: String
    let publicKey: String
}

private struct PocketRelayPairResponse: Decodable, Sendable {
    let version: String
    let deviceId: String
    let targetDevice: PocketRelayTargetDevice
    let accessToken: String
    let accessTokenExpiresAt: String
    let receiptPublicKey: String
    let serverTime: String
}

private struct PocketRelayTokenProof: Encodable, Sendable {
    let deviceId: String
    let nonce: String
    let issuedAt: String
    let expiresAt: String
    let signature: String
}

private struct PocketRelayTokenResponse: Decodable, Sendable {
    let accessToken: String
    let accessTokenExpiresAt: String
    let serverTime: String
}

private struct PocketRelaySignedCommandRequest: Encodable, Sendable {
    let signedCommand: String
    let signature: String
}

struct PocketRelaySignedReceipt: Codable, Equatable, Sendable {
    let receipt: String
    let signature: String
    let algorithm: String
}

struct PocketRelayCommandResponse: Decodable, Equatable, Sendable {
    let success: Bool
    let idempotentReplay: Bool
    let nonceReplay: Bool?
    let state: PocketRelayCommandState
    let result: PocketRelayJSONValue?
    let error: PocketRelayExecutionError?
    let signedReceipt: PocketRelaySignedReceipt
}

struct PocketRelayExecutionOutcome: Sendable {
    let response: PocketRelayCommandResponse
    let audit: PocketRelayAuditSummary
}

struct PocketRelayExecutionError: Codable, Equatable, Sendable {
    let code: String
    let message: String
    let status: Int?
}

struct PocketRelayHostError: LocalizedError, Sendable {
    let code: String
    let message: String
    let status: Int?
    let underlyingDescription: String?

    var isRemoteRevocation: Bool { code == "DEVICE_REVOKED" }
    var isKillSwitch: Bool { code == "RELAY_KILL_SWITCH_ACTIVE" }
    var isAuthenticationRefreshable: Bool {
        ["ACCESS_TOKEN_EXPIRED", "ACCESS_TOKEN_INVALID", "ACCESS_TOKEN_REQUIRED"].contains(code)
    }
    var isTransient: Bool {
        if code == "NETWORK_UNAVAILABLE" || code == "REQUEST_TIMEOUT" { return true }
        guard let status else { return false }
        return status == 408 || status == 429 || (500...599).contains(status) && !isKillSwitch
    }

    var errorDescription: String? { message }
}

private struct PocketRelayHostErrorEnvelope: Decodable {
    struct Detail: Decodable {
        let code: String?
        let message: String?
    }

    let error: Detail?
    let code: String?
    let message: String?
}

private enum PocketRelayTransportError: Error {
    case invalidResponse
    case responseTooLarge
}

private final class PocketRelayTransportDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let maximumResponseBytes = 12 * 1024 * 1024

    private struct PendingResponse {
        let continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>
        var response: HTTPURLResponse?
        var data = Data()
    }

    private let lock = NSLock()
    private var pending: [Int: PendingResponse] = [:]

    func data(for request: URLRequest, using session: URLSession) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.dataTask(with: request)
            lock.lock()
            pending[task.taskIdentifier] = PendingResponse(continuation: continuation)
            lock.unlock()
            task.resume()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            fail(taskIdentifier: dataTask.taskIdentifier, with: PocketRelayTransportError.invalidResponse)
            return
        }
        guard responseLengthIsAllowed(http) else {
            completionHandler(.cancel)
            fail(taskIdentifier: dataTask.taskIdentifier, with: PocketRelayTransportError.responseTooLarge)
            return
        }

        lock.lock()
        if var value = pending[dataTask.taskIdentifier] {
            value.response = http
            if http.expectedContentLength > 0 {
                value.data.reserveCapacity(Int(http.expectedContentLength))
            }
            pending[dataTask.taskIdentifier] = value
        }
        lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
        lock.lock()
        if var value = pending[dataTask.taskIdentifier] {
            if data.count > Self.maximumResponseBytes
                || value.data.count > Self.maximumResponseBytes - data.count {
                pending[dataTask.taskIdentifier] = nil
                continuation = value.continuation
            } else {
                value.data.append(data)
                pending[dataTask.taskIdentifier] = value
            }
        }
        lock.unlock()

        if let continuation {
            dataTask.cancel()
            continuation.resume(throwing: PocketRelayTransportError.responseTooLarge)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let value = pending.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let value else { return }

        if let error {
            value.continuation.resume(throwing: error)
            return
        }
        guard let response = value.response ?? task.response as? HTTPURLResponse else {
            value.continuation.resume(throwing: PocketRelayTransportError.invalidResponse)
            return
        }
        guard responseLengthIsAllowed(response), value.data.count <= Self.maximumResponseBytes else {
            value.continuation.resume(throwing: PocketRelayTransportError.responseTooLarge)
            return
        }
        value.continuation.resume(returning: (value.data, response))
    }

    private func responseLengthIsAllowed(_ response: HTTPURLResponse) -> Bool {
        if response.expectedContentLength > Int64(Self.maximumResponseBytes) { return false }
        guard let header = response.value(forHTTPHeaderField: "Content-Length") else { return true }
        let clean = header.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let declared = Int64(clean), declared >= 0 else { return false }
        return declared <= Int64(Self.maximumResponseBytes)
    }

    private func fail(taskIdentifier: Int, with error: Error) {
        lock.lock()
        let value = pending.removeValue(forKey: taskIdentifier)
        lock.unlock()
        value?.continuation.resume(throwing: error)
    }
}

actor PocketRelayHostClient {
    private let signer: PocketRelayDeviceSigner
    private let credentials: PocketRelayCredentialStore
    private let transport: PocketRelayTransportDelegate
    private let session: URLSession

    init(
        signer: PocketRelayDeviceSigner,
        credentials: PocketRelayCredentialStore
    ) {
        let transport = PocketRelayTransportDelegate()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        self.signer = signer
        self.credentials = credentials
        self.transport = transport
        self.session = URLSession(configuration: configuration, delegate: transport, delegateQueue: nil)
    }

    func currentSession() async throws -> PocketRelaySession? {
        guard let stored = try await credentials.load() else { return nil }
        do {
            return try validatedStoredSession(stored)
        } catch {
            try? await credentials.clear()
            throw error
        }
    }

    func pair(hostURLText: String, pairingCode: String, deviceName: String) async throws -> PocketRelaySession {
        let baseURL = try PocketRelayHostURLPolicy.validate(hostURLText)
        let cleanCode = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanName = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanCode == pairingCode, (8...128).contains(cleanCode.count) else {
            throw PocketRelayLocalError.contract("Der Pairing-Code muss 8 bis 128 Zeichen lang sein und darf keine äußeren Leerzeichen enthalten.")
        }
        guard cleanName == deviceName, (1...80).contains(cleanName.count) else {
            throw PocketRelayLocalError.contract("Der iPhone-Gerätename muss 1 bis 80 Zeichen lang sein.")
        }

        let request = PocketRelayPairRequest(
            pairingCode: cleanCode,
            deviceName: cleanName,
            platform: "ios",
            publicKey: try await signer.publicKeyBase64URL()
        )
        let response: PocketRelayPairResponse = try await post(
            endpoint: endpoint(baseURL: baseURL, leaf: "pair"),
            body: request,
            bearerToken: nil
        )
        guard response.version == PocketRelayContract.pairingVersion else {
            throw PocketRelayLocalError.contract("Der Host verwendet einen nicht unterstützten Pairing-Vertrag.")
        }
        try PocketRelayValidation.requireOpaqueID(response.deviceId, field: "pairing.deviceId")
        _ = try response.targetDevice.validated()
        let tokenExpiresAt = try PocketRelayTimestamp.date(from: response.accessTokenExpiresAt)
        let serverTime = try PocketRelayTimestamp.date(from: response.serverTime)
        try validateAccessToken(response.accessToken, expiresAt: tokenExpiresAt, serverTime: serverTime)
        let offset = try validatedClockOffset(serverTime.timeIntervalSince(Date()))
        let receiptKey = try PocketRelayEncoding.decodeBase64URL(response.receiptPublicKey)
        guard receiptKey.count == 32 else {
            throw PocketRelayLocalError.contract("Die Pairing-Antwort des Hosts ist unvollständig.")
        }

        let paired = try validatedStoredSession(PocketRelaySession(
            baseURL: baseURL,
            deviceId: response.deviceId,
            targetDevice: response.targetDevice,
            accessToken: response.accessToken,
            accessTokenExpiresAt: tokenExpiresAt,
            receiptPublicKey: response.receiptPublicKey,
            serverClockOffset: offset
        ))
        try await credentials.save(paired)
        return paired
    }

    func disconnect() async throws {
        try await credentials.clear()
    }

    func execute(
        record: PocketRelayQueueRecord,
        fileData: Data?
    ) async throws -> PocketRelayExecutionOutcome {
        var paired = try await usableSession(forceRefresh: false)
        do {
            return try await executeOnce(record: record, fileData: fileData, paired: paired)
        } catch let error as PocketRelayHostError where error.isAuthenticationRefreshable {
            paired = try await usableSession(forceRefresh: true)
            return try await executeOnce(record: record, fileData: fileData, paired: paired)
        }
    }

    private func executeOnce(
        record: PocketRelayQueueRecord,
        fileData: Data?,
        paired: PocketRelaySession
    ) async throws -> PocketRelayExecutionOutcome {
        let hostNow = Date().addingTimeInterval(paired.serverClockOffset)
        let command = try PocketRelayCommandBuilder.build(
            record: record,
            deviceId: paired.deviceId,
            fileData: fileData,
            now: hostNow
        )
        let request = PocketRelaySignedCommandRequest(
            signedCommand: PocketRelayEncoding.base64URL(command.bytes),
            signature: try await signer.sign(command.bytes)
        )
        let response: PocketRelayCommandResponse = try await post(
            endpoint: endpoint(baseURL: paired.baseURL, leaf: "commands"),
            body: request,
            bearerToken: paired.accessToken,
            acceptStructuredFailure: true
        )
        let audit = try PocketRelayReceiptVerifier.verify(
            signedReceipt: response.signedReceipt,
            publicKeyBase64URL: paired.receiptPublicKey,
            expectation: command.receiptExpectation,
            response: response,
            idempotentReplay: response.idempotentReplay
        )
        return PocketRelayExecutionOutcome(response: response, audit: audit)
    }

    private func usableSession(forceRefresh: Bool) async throws -> PocketRelaySession {
        guard let stored = try await credentials.load() else { throw PocketRelayLocalError.notPaired }
        let paired: PocketRelaySession
        do {
            paired = try validatedStoredSession(stored)
        } catch {
            try? await credentials.clear()
            throw error
        }
        if !forceRefresh, paired.hasUsableToken { return paired }
        return try await refresh(paired)
    }

    private func refresh(_ paired: PocketRelaySession) async throws -> PocketRelaySession {
        let issuedAt = Date().addingTimeInterval(paired.serverClockOffset)
        let expiresAt = issuedAt.addingTimeInterval(90)
        let nonce = try PocketRelayEncoding.randomBase64URL(byteCount: 32)
        let issuedText = PocketRelayTimestamp.string(from: issuedAt)
        let expiresText = PocketRelayTimestamp.string(from: expiresAt)
        let signingInput = [
            PocketRelayContract.tokenProofVersion,
            paired.deviceId,
            nonce,
            issuedText,
            expiresText
        ].joined(separator: "\n")
        let proof = PocketRelayTokenProof(
            deviceId: paired.deviceId,
            nonce: nonce,
            issuedAt: issuedText,
            expiresAt: expiresText,
            signature: try await signer.sign(Data(signingInput.utf8))
        )

        do {
            let response: PocketRelayTokenResponse = try await post(
                endpoint: endpoint(baseURL: paired.baseURL, leaf: "token"),
                body: proof,
                bearerToken: nil
            )
            let serverTime = try PocketRelayTimestamp.date(from: response.serverTime)
            let tokenExpiresAt = try PocketRelayTimestamp.date(from: response.accessTokenExpiresAt)
            try validateAccessToken(response.accessToken, expiresAt: tokenExpiresAt, serverTime: serverTime)
            var refreshed = paired
            refreshed.accessToken = response.accessToken
            refreshed.accessTokenExpiresAt = tokenExpiresAt
            refreshed.serverClockOffset = try validatedClockOffset(serverTime.timeIntervalSince(Date()))
            let validated = try validatedStoredSession(refreshed)
            try await credentials.save(validated)
            return validated
        }
    }

    private func endpoint(baseURL: URL, leaf: String) -> URL {
        baseURL
            .appendingPathComponent("pocket-relay", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
            .appendingPathComponent(leaf, isDirectory: false)
    }

    private func post<Request: Encodable, Response: Decodable>(
        endpoint: URL,
        body: Request,
        bearerToken: String?,
        acceptStructuredFailure: Bool = false
    ) async throws -> Response {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try PocketRelayEncoding.wireEncoder.encode(body)

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport.data(for: request, using: session)
        } catch PocketRelayTransportError.responseTooLarge {
            throw PocketRelayHostError(
                code: "RESPONSE_TOO_LARGE",
                message: "Die Host-Antwort überschreitet das Pocket-Relay-Limit von 12 MiB.",
                status: nil,
                underlyingDescription: nil
            )
        } catch PocketRelayTransportError.invalidResponse {
            throw PocketRelayHostError(
                code: "INVALID_RESPONSE",
                message: "Der Pocket-Relay-Host hat keine gültige HTTP-Antwort geliefert.",
                status: nil,
                underlyingDescription: nil
            )
        } catch let error as URLError {
            let code = error.code == .timedOut ? "REQUEST_TIMEOUT" : "NETWORK_UNAVAILABLE"
            throw PocketRelayHostError(
                code: code,
                message: error.code == .timedOut
                    ? "Der Pocket-Relay-Host hat nicht rechtzeitig geantwortet."
                    : "Der Pocket-Relay-Host ist derzeit nicht erreichbar.",
                status: nil,
                underlyingDescription: error.localizedDescription
            )
        }

        guard (200..<300).contains(http.statusCode) else {
            if acceptStructuredFailure, let structured = try? JSONDecoder().decode(Response.self, from: data) {
                return structured
            }
            let envelope = try? JSONDecoder().decode(PocketRelayHostErrorEnvelope.self, from: data)
            let code = envelope?.error?.code ?? envelope?.code ?? "HTTP_\(http.statusCode)"
            throw PocketRelayHostError(
                code: code,
                message: envelope?.error?.message ?? envelope?.message ?? "Der Pocket-Relay-Host hat die Anfrage abgelehnt.",
                status: http.statusCode,
                underlyingDescription: nil
            )
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw PocketRelayHostError(
                code: "RESPONSE_CONTRACT_INVALID",
                message: "Die Host-Antwort entspricht nicht dem Pocket-Relay-v1-Vertrag.",
                status: http.statusCode,
                underlyingDescription: error.localizedDescription
            )
        }
    }

    private func validatedClockOffset(_ value: TimeInterval) throws -> TimeInterval {
        guard value.isFinite, abs(value) <= 300 else {
            throw PocketRelayLocalError.contract("Die Uhrzeit des Hosts weicht zu stark vom iPhone ab.")
        }
        return value
    }

    private func validateAccessToken(_ token: String, expiresAt: Date, serverTime: Date) throws {
        let lifetime = expiresAt.timeIntervalSince(serverTime)
        try validateAccessTokenForm(token)
        guard lifetime > 0,
              lifetime <= 15 * 60 + PocketRelayContract.maximumClockSkew
        else {
            throw PocketRelayLocalError.contract("Der Host hat keinen gültigen kurzlebigen Zugriffstoken geliefert.")
        }
    }

    private func validateAccessTokenForm(_ token: String) throws {
        guard token == token.trimmingCharacters(in: .whitespacesAndNewlines),
              (32...4_096).contains(token.count),
              token.range(
                of: "^[A-Za-z0-9\\-._~+/]+=*$",
                options: .regularExpression
              ) != nil
        else {
            throw PocketRelayLocalError.contract("Der gespeicherte Zugriffstoken hat ein ungültiges Format.")
        }
    }

    private func validatedStoredSession(_ stored: PocketRelaySession) throws -> PocketRelaySession {
        let baseURL = try PocketRelayHostURLPolicy.validate(stored.baseURL.absoluteString)
        try PocketRelayValidation.requireOpaqueID(stored.deviceId, field: "session.deviceId")
        let target = try stored.targetDevice.validated()
        let offset = try validatedClockOffset(stored.serverClockOffset)
        try validateAccessTokenForm(stored.accessToken)

        let hostNow = Date().addingTimeInterval(offset)
        guard stored.accessTokenExpiresAt.timeIntervalSince1970.isFinite,
              stored.accessTokenExpiresAt.timeIntervalSince(hostNow)
                <= 15 * 60 + PocketRelayContract.maximumClockSkew
        else {
            throw PocketRelayLocalError.contract("Die gespeicherte Token-Laufzeit ist ungültig.")
        }
        let receiptKey = try PocketRelayEncoding.decodeBase64URL(stored.receiptPublicKey)
        guard receiptKey.count == 32 else {
            throw PocketRelayLocalError.contract("Der gespeicherte Audit-Schlüssel ist ungültig.")
        }

        return PocketRelaySession(
            baseURL: baseURL,
            deviceId: stored.deviceId,
            targetDevice: target,
            accessToken: stored.accessToken,
            accessTokenExpiresAt: stored.accessTokenExpiresAt,
            receiptPublicKey: stored.receiptPublicKey,
            serverClockOffset: offset
        )
    }
}

enum PocketRelayHostURLPolicy {
    static func validate(_ text: String) throws -> URL {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean == text, !clean.isEmpty,
              var components = URLComponents(string: clean),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else {
            throw PocketRelayLocalError.unconfigured
        }

        components.scheme = scheme
        components.host = host
        components.path = ""
        guard let url = components.url else { throw PocketRelayLocalError.unconfigured }

        let allowed: Bool
        #if DEBUG
        allowed = scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
        #else
        if let configuredURL = PocketRelayBuildConfiguration.productionHostURL {
            allowed = scheme == "https"
                && PocketRelayBuildConfiguration.pairingAssuranceConfigured
                && url == configuredURL
        } else {
            allowed = false
        }
        #endif
        guard allowed else { throw PocketRelayLocalError.insecureHost }
        return url
    }
}

enum PocketRelayBuildConfiguration {
    static var pairingAssuranceConfigured: Bool {
        Bundle.main.object(forInfoDictionaryKey: "POCKET_RELAY_PAIRING_ASSURANCE") as? String
            == "device_bound_one_time_v1"
    }

    static var productionHostURL: URL? {
        guard pairingAssuranceConfigured,
              let text = Bundle.main.object(forInfoDictionaryKey: "POCKET_RELAY_HOST_URL") as? String,
              text == text.trimmingCharacters(in: .whitespacesAndNewlines),
              var components = URLComponents(string: text),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else { return nil }
        components.scheme = "https"
        components.host = host
        components.path = ""
        return components.url
    }

    static var pairingAvailable: Bool {
        #if DEBUG
        true
        #else
        productionHostURL != nil
        #endif
    }
}
