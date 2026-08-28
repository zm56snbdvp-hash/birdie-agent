import CryptoKit
import Foundation
import Security

protocol BirdieDeviceBindingClient: Sendable {
    func createRegistrationChallenge(
        _ request: AppAttestRegistrationChallengeRequest
    ) async throws -> AppAttestRegistrationChallenge
    func registerAppAttestKey(
        _ request: AppAttestRegistrationRequest
    ) async throws -> AppAttestRegistrationAcknowledgement
}

struct UnavailableDeviceBindingClient: BirdieDeviceBindingClient {
    func createRegistrationChallenge(
        _ request: AppAttestRegistrationChallengeRequest
    ) async throws -> AppAttestRegistrationChallenge {
        _ = request
        throw BirdieTrustError.backendUnavailable
    }

    func registerAppAttestKey(
        _ request: AppAttestRegistrationRequest
    ) async throws -> AppAttestRegistrationAcknowledgement {
        _ = request
        throw BirdieTrustError.backendUnavailable
    }
}

struct BirdiePendingRegistration: Codable, Sendable {
    let challenge: AppAttestRegistrationChallenge
    let request: AppAttestRegistrationRequest
}

actor BirdiePendingRegistrationCache {
    private let fileURL: URL?
    private var pending: BirdiePendingRegistration?

    init() {
        let fileURL = Self.defaultURL()
        self.fileURL = fileURL
        pending = Self.load(from: fileURL)
    }

    init(fileURL: URL?) {
        self.fileURL = fileURL
        pending = Self.load(from: fileURL)
    }

    func value() -> BirdiePendingRegistration? { pending }

    func store(_ value: BirdiePendingRegistration) throws {
        try persist([value])
        pending = value
    }

    func clear() throws {
        try persist([])
        pending = nil
    }

    private func persist(_ values: [BirdiePendingRegistration]) throws {
        guard let fileURL else { return }
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(values)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    private static func defaultURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("BirdieTrust", isDirectory: true)
            .appendingPathComponent("pending-app-attest-registration-v1.json")
    }

    private static func load(from fileURL: URL?) -> BirdiePendingRegistration? {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL)
        else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let values = try? decoder.decode([BirdiePendingRegistration].self, from: data) else {
            return nil
        }
        return values.first
    }
}

/// Coordinates the only safe activation order for an App Attest key. A full
/// attested request is durably file-protected before submission, so response-loss
/// retries reuse the exact request; activation in Keychain happens only after an
/// exact, cryptographically verified server ack.
actor BirdieDeviceBindingCoordinator {
    private let client: any BirdieDeviceBindingClient
    private let registrar: any BirdieAppAttestRegistering
    private let serverSignatureVerifier: any BirdieServerSignatureVerifying
    private let pendingCache: BirdiePendingRegistrationCache
    private let now: @Sendable () -> Date
    private var pending: BirdiePendingRegistration?

    init(
        client: any BirdieDeviceBindingClient,
        registrar: any BirdieAppAttestRegistering,
        serverSignatureVerifier: any BirdieServerSignatureVerifying,
        pendingCache: BirdiePendingRegistrationCache = BirdiePendingRegistrationCache(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.client = client
        self.registrar = registrar
        self.serverSignatureVerifier = serverSignatureVerifier
        self.pendingCache = pendingCache
        self.now = now
    }

    func enroll() async throws -> AppAttestRegistrationAcknowledgement {
        if pending == nil {
            pending = await pendingCache.value()
        }
        if let pending {
            return try await submit(pending)
        }

        let keyID = try await registrar.beginRegistration()
        do {
            guard !keyID.isEmpty, keyID.count <= 1_024 else {
                throw BirdieTrustError.invalidContract("App-Attest-Key-ID ist ungültig.")
            }
            let registrationID = "registration-\(UUID().uuidString.lowercased())"
            let idempotencyKey = "registration-\(UUID().uuidString.lowercased())"
            let challengeRequest = AppAttestRegistrationChallengeRequest(
                contractVersion: BirdieTrustSchema.contract,
                registrationID: registrationID,
                idempotencyKey: idempotencyKey,
                keyID: keyID
            )
            let challenge = try await client.createRegistrationChallenge(challengeRequest)
            try validate(challenge: challenge, request: challengeRequest)

            let payload = AppAttestRegistrationPayload(
                contractVersion: BirdieTrustSchema.contract,
                registrationID: registrationID,
                challengeID: challenge.challengeID,
                idempotencyKey: idempotencyKey,
                keyID: keyID,
                nonce: challenge.nonce,
                clientIssuedAt: now()
            )
            let clientDataHash = Data(
                SHA256.hash(data: try BirdieCanonicalJSON.data(payload))
            )
            let attestation = try await registrar.createRegistrationAttestation(
                keyID: keyID,
                clientDataHash: clientDataHash
            )
            let expectedHash = BirdieCanonicalJSON.base64URL(clientDataHash)
            guard attestation.keyID == keyID,
                  attestation.clientDataHash == expectedHash,
                  BirdieCanonicalJSON.validBase64URL(
                      attestation.attestationObject,
                      minimumDecodedBytes: 16,
                      encodedLength: 16 ... 8_192
                  )
            else {
                throw BirdieTrustError.invalidContract(
                    "App-Attest-Registrierung ist nicht an die Challenge gebunden."
                )
            }

            let registrationRequest = AppAttestRegistrationRequest(
                contractVersion: payload.contractVersion,
                registrationID: payload.registrationID,
                challengeID: payload.challengeID,
                idempotencyKey: payload.idempotencyKey,
                keyID: payload.keyID,
                nonce: payload.nonce,
                clientIssuedAt: payload.clientIssuedAt,
                clientDataHash: expectedHash,
                attestation: attestation.attestationObject
            )
            let prepared = BirdiePendingRegistration(
                challenge: challenge,
                request: registrationRequest
            )
            try await pendingCache.store(prepared)
            pending = prepared
            return try await submit(prepared)
        } catch {
            if pending == nil {
                await registrar.discardPendingRegistration(keyID: keyID)
            }
            throw error
        }
    }

    func discardPendingRegistration() async {
        if pending == nil {
            pending = await pendingCache.value()
        }
        guard let pending else { return }
        await registrar.discardPendingRegistration(keyID: pending.request.keyID)
        try? await pendingCache.clear()
        self.pending = nil
    }

    private func submit(
        _ pending: BirdiePendingRegistration
    ) async throws -> AppAttestRegistrationAcknowledgement {
        let acknowledgement = try await client.registerAppAttestKey(pending.request)
        try validate(
            acknowledgement: acknowledgement,
            request: pending.request,
            challenge: pending.challenge
        )
        try await serverSignatureVerifier.verify(
            signature: acknowledgement.serverSignature,
            payload: BirdieCanonicalJSON.data(acknowledgement.signingPayload)
        )
        try await registrar.activateRegistration(
            afterBackendAcknowledgedKeyID: acknowledgement.keyID,
            deviceBindingID: acknowledgement.deviceBindingID
        )
        try await pendingCache.clear()
        self.pending = nil
        return acknowledgement
    }

    private func validate(
        challenge: AppAttestRegistrationChallenge,
        request: AppAttestRegistrationChallengeRequest
    ) throws {
        let current = now()
        guard challenge.contractVersion == BirdieTrustSchema.contract,
              challenge.registrationID == request.registrationID,
              challenge.idempotencyKey == request.idempotencyKey,
              challenge.keyID == request.keyID,
              BirdieApprovalValidation.isOpaqueIdentifier(challenge.challengeID),
              BirdieCanonicalJSON.validBase64URL(
                  challenge.nonce,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 128
              ),
              challenge.maxAttempts == 1,
              challenge.consumed == false,
              challenge.issuedAt <= current.addingTimeInterval(5),
              challenge.expiresAt > current,
              challenge.expiresAt <= challenge.issuedAt.addingTimeInterval(120)
        else {
            throw BirdieTrustError.invalidContract(
                "App-Attest-Registration-Challenge ist ungültig oder abgelaufen."
            )
        }
    }

    private func validate(
        acknowledgement: AppAttestRegistrationAcknowledgement,
        request: AppAttestRegistrationRequest,
        challenge: AppAttestRegistrationChallenge
    ) throws {
        guard acknowledgement.contractVersion == BirdieTrustSchema.contract,
              acknowledgement.registrationID == request.registrationID,
              acknowledgement.keyID == request.keyID,
              BirdieApprovalValidation.isOpaqueIdentifier(
                  acknowledgement.acknowledgementID
              ),
              BirdieApprovalValidation.isOpaqueIdentifier(
                  acknowledgement.deviceBindingID
              ),
              acknowledgement.registeredAt >= challenge.issuedAt.addingTimeInterval(-5),
              acknowledgement.registeredAt <= now().addingTimeInterval(5),
              acknowledgement.serverSignature.format == "raw-ed25519-jcs",
              acknowledgement.serverSignature.algorithm == "EdDSA",
              acknowledgement.serverSignature.canonicalization == "RFC8785"
        else {
            throw BirdieTrustError.invalidContract(
                "App-Attest-Registration-Acknowledgement ist nicht exakt gebunden."
            )
        }
    }
}

#if DEBUG
actor MockDeviceBindingClient: BirdieDeviceBindingClient {
    private struct CachedAcknowledgement {
        let requestDigest: String
        let acknowledgement: AppAttestRegistrationAcknowledgement
    }

    private let signingKey = Curve25519.Signing.PrivateKey()
    private let loseFirstRegistrationResponse: Bool
    private var challengesByIdempotencyKey: [String: AppAttestRegistrationChallenge] = [:]
    private var acknowledgementsByIdempotencyKey: [String: CachedAcknowledgement] = [:]
    private var registrationSubmissionCount = 0

    init(loseFirstRegistrationResponse: Bool = false) {
        self.loseFirstRegistrationResponse = loseFirstRegistrationResponse
    }

    func createRegistrationChallenge(
        _ request: AppAttestRegistrationChallengeRequest
    ) async throws -> AppAttestRegistrationChallenge {
        guard request.contractVersion == BirdieTrustSchema.contract,
              BirdieApprovalValidation.isOpaqueIdentifier(request.registrationID),
              BirdieApprovalValidation.isOpaqueIdentifier(request.idempotencyKey),
              !request.keyID.isEmpty,
              request.keyID.count <= 1_024
        else {
            throw BirdieTrustError.invalidContract("Mock-Registration-Request ist ungültig.")
        }
        if let existing = challengesByIdempotencyKey[request.idempotencyKey] {
            guard existing.registrationID == request.registrationID,
                  existing.keyID == request.keyID else {
                throw BirdieTrustError.replayDetected
            }
            return existing
        }
        let issuedAt = Date()
        let challenge = AppAttestRegistrationChallenge(
            contractVersion: BirdieTrustSchema.contract,
            registrationID: request.registrationID,
            challengeID: "registration-challenge-\(UUID().uuidString.lowercased())",
            idempotencyKey: request.idempotencyKey,
            keyID: request.keyID,
            nonce: try Self.randomNonce(),
            issuedAt: issuedAt,
            expiresAt: issuedAt.addingTimeInterval(90),
            maxAttempts: 1,
            consumed: false
        )
        challengesByIdempotencyKey[request.idempotencyKey] = challenge
        return challenge
    }

    func registerAppAttestKey(
        _ request: AppAttestRegistrationRequest
    ) async throws -> AppAttestRegistrationAcknowledgement {
        registrationSubmissionCount += 1
        let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        if let cached = acknowledgementsByIdempotencyKey[request.idempotencyKey] {
            guard cached.requestDigest == requestDigest else {
                throw BirdieTrustError.replayDetected
            }
            return cached.acknowledgement
        }
        guard let challenge = challengesByIdempotencyKey[request.idempotencyKey],
              challenge.registrationID == request.registrationID,
              challenge.challengeID == request.challengeID,
              challenge.keyID == request.keyID,
              challenge.nonce == request.nonce,
              challenge.expiresAt > Date(),
              request.contractVersion == BirdieTrustSchema.contract
        else {
            throw BirdieTrustError.invalidContract("Mock-Registration ist nicht gebunden.")
        }
        let expectedHash = try BirdieCanonicalJSON.sha256Digest(request.assertionPayload)
        guard request.clientDataHash == expectedHash,
              request.attestation == BirdieCanonicalJSON.base64URL(
                  Data("mock-attestation:\(expectedHash)".utf8)
              )
        else {
            throw BirdieTrustError.invalidContract("Mock-Attestation ist ungültig.")
        }

        let registeredAt = Date()
        let signingPayload = AppAttestRegistrationAcknowledgementSigningPayload(
            contractVersion: BirdieTrustSchema.contract,
            acknowledgementID: "registration-ack-\(UUID().uuidString.lowercased())",
            registrationID: request.registrationID,
            deviceBindingID: "debug-device-binding-\(request.registrationID)",
            keyID: request.keyID,
            registeredAt: registeredAt
        )
        let signature = try signingKey.signature(
            for: BirdieCanonicalJSON.data(signingPayload)
        )
        let key = verificationKey()
        let acknowledgement = AppAttestRegistrationAcknowledgement(
            contractVersion: signingPayload.contractVersion,
            acknowledgementID: signingPayload.acknowledgementID,
            registrationID: signingPayload.registrationID,
            deviceBindingID: signingPayload.deviceBindingID,
            keyID: signingPayload.keyID,
            registeredAt: signingPayload.registeredAt,
            serverSignature: ServerSignature(
                format: "raw-ed25519-jcs",
                algorithm: "EdDSA",
                keyID: key.keyID,
                canonicalization: "RFC8785",
                signature: BirdieCanonicalJSON.base64URL(signature),
                signedAt: registeredAt
            )
        )
        acknowledgementsByIdempotencyKey[request.idempotencyKey] =
            CachedAcknowledgement(
                requestDigest: requestDigest,
                acknowledgement: acknowledgement
            )
        challengesByIdempotencyKey.removeValue(forKey: request.idempotencyKey)
        if loseFirstRegistrationResponse && registrationSubmissionCount == 1 {
            throw BirdieTrustError.backendUnavailable
        }
        return acknowledgement
    }

    func verificationKey() -> BirdieServerVerificationKey {
        BirdieServerVerificationKey(
            keyID: "debug-registration-\(BirdieCanonicalJSON.sha256Digest(signingKey.publicKey.rawRepresentation))",
            rawRepresentation: signingKey.publicKey.rawRepresentation
        )
    }

    private static func randomNonce() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw BirdieTrustError.backendUnavailable
        }
        return BirdieCanonicalJSON.base64URL(Data(bytes))
    }
}
#endif
