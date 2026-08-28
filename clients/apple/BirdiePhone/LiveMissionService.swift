import CryptoKit
import Foundation
import Security

protocol LiveMissionServicing: Sendable {
    func fetchCurrentMission() async throws -> LiveMissionRecord?
    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge
    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse
}

enum LiveMissionServiceError: LocalizedError, Equatable, Sendable {
    case productionServiceNotConfigured
    case missionNotFound
    case missionExpired
    case challengeExpired
    case versionConflict
    case commandNotAllowed
    case localAuthorizationRequired
    case idempotencyConflict
    case invalidChallenge
    case invalidDeviceAssertion
    case replayDetected
    case commandInProgress

    var errorDescription: String? {
        switch self {
        case .productionServiceNotConfigured:
            "Live Mission ist in diesem Release nicht mit einem verifizierten Backend verbunden."
        case .missionNotFound:
            "Die Mission wurde nicht gefunden."
        case .missionExpired:
            "Die Mission ist abgelaufen. Bitte den aktuellen Stand neu laden."
        case .challengeExpired:
            "Die Einmal-Challenge ist abgelaufen."
        case .versionConflict:
            "Die Mission wurde inzwischen aktualisiert. Bitte neu laden."
        case .commandNotAllowed:
            "Dieser Befehl ist im aktuellen Missionszustand nicht erlaubt."
        case .localAuthorizationRequired:
            "Die lokale Autorisierung ist ungültig oder nicht mehr frisch."
        case .idempotencyConflict:
            "Der Idempotency-Key wurde bereits für einen anderen Befehl verwendet."
        case .invalidChallenge:
            "Challenge und Missionsbefehl stimmen nicht exakt überein."
        case .invalidDeviceAssertion:
            "Die Geräteassertion ist nicht an diesen Missionsbefehl gebunden."
        case .replayDetected:
            "Die Einmal-Challenge wurde bereits konsumiert."
        case .commandInProgress:
            "Dieser Missionsbefehl wird bereits sicher übertragen."
        }
    }
}

enum LiveMissionEnvironment {
    static func makeService() -> any LiveMissionServicing {
#if DEBUG
        LiveMissionMockService()
#else
        UnconfiguredLiveMissionService()
#endif
    }
}

/// Release builds intentionally have no fallback URL, token, or invented
/// production configuration. Integration must inject a verified service.
private struct UnconfiguredLiveMissionService: LiveMissionServicing {
    func fetchCurrentMission() async throws -> LiveMissionRecord? {
        throw LiveMissionServiceError.productionServiceNotConfigured
    }

    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge {
        throw LiveMissionServiceError.productionServiceNotConfigured
    }

    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse {
        throw LiveMissionServiceError.productionServiceNotConfigured
    }
}

#if DEBUG
actor LiveMissionMockService: LiveMissionServicing {
    private struct ChallengeRecord {
        let request: MissionChallengeRequest
        let requestDigest: String
        let challenge: MissionActionChallenge
    }

    private struct CachedResponse {
        let requestDigest: String
        let response: MissionCommandResponse
    }

    private var mission: LiveMissionRecord?
    private var challengesByID: [String: ChallengeRecord] = [:]
    private var challengeIDByIdempotencyKey: [String: String] = [:]
    private var consumedChallengeIDs: Set<String> = []
    private var nonceReservations: [String: String] = [:]
    private var responsesByIdempotencyKey: [String: CachedResponse] = [:]
    private var auditSequence = 0
    private let now: @Sendable () -> Date
    private let receiptSigningKey: Curve25519.Signing.PrivateKey
    private let receiptSigningKeyID = "debug-mission-receipt-key-v1"

    init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
        receiptSigningKey = Curve25519.Signing.PrivateKey()
        let startDate = now()
        mission = try? LiveMissionRecord(
            missionID: "debug-live-mission-001",
            recordVersion: 4,
            title: "Freigabebericht vorbereiten",
            scope: LiveMissionScope(
                summary: "Ein Bericht in fünf klar begrenzten Schritten",
                boundary: "Keine Veröffentlichung und keine Änderung externer Daten",
                maximumDurationSeconds: 2 * 60 * 60
            ),
            status: .running,
            progress: 0.4,
            currentStep: LiveMissionStep(
                index: 2,
                total: 5,
                title: "Quellen prüfen",
                detail: "Nur lokale DEBUG-Beispieldaten"
            ),
            blocker: nil,
            allowsPause: true,
            allowsCancel: true,
            startedAt: startDate,
            updatedAt: startDate,
            expiresAt: startDate.addingTimeInterval(2 * 60 * 60)
        )
    }

    func fetchCurrentMission() async throws -> LiveMissionRecord? {
        mission
    }

    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge {
        let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        if let challengeID = challengeIDByIdempotencyKey[request.idempotencyKey],
           let cached = challengesByID[challengeID] {
            guard cached.requestDigest == requestDigest else {
                throw LiveMissionServiceError.idempotencyConflict
            }
            return cached.challenge
        }

        guard request.contractVersion == LiveMissionContract.version,
              validIdentifier(request.missionID),
              request.recordVersion >= 1,
              validIdempotencyKey(request.idempotencyKey),
              validIdentifier(request.deviceBindingID),
              BirdieCanonicalJSON.validBase64URL(
                  request.actionDigest,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 43
              ) else {
            throw LiveMissionServiceError.invalidChallenge
        }
        guard let current = mission, current.missionID == request.missionID else {
            throw LiveMissionServiceError.missionNotFound
        }
        guard current.recordVersion == request.recordVersion else {
            throw LiveMissionServiceError.versionConflict
        }
        let issuedAt = now()
        guard issuedAt < current.expiresAt else {
            throw LiveMissionServiceError.missionExpired
        }
        guard commandIsAllowed(request.command, for: current) else {
            throw LiveMissionServiceError.commandNotAllowed
        }
        let expectedActionDigest = try BirdieCanonicalJSON.sha256Digest(
            MissionCommandActionSnapshot(
                contractVersion: LiveMissionContract.version,
                missionID: request.missionID,
                recordVersion: request.recordVersion,
                command: request.command
            )
        )
        guard request.actionDigest == expectedActionDigest else {
            throw LiveMissionServiceError.invalidChallenge
        }

        let challenge = MissionActionChallenge(
            contractVersion: LiveMissionContract.version,
            challengeID: UUID().uuidString.lowercased(),
            resourceType: "mission",
            missionID: request.missionID,
            recordVersion: request.recordVersion,
            idempotencyKey: request.idempotencyKey,
            deviceBindingID: request.deviceBindingID,
            oneTimeNonce: try Self.randomNonce(),
            actionDigest: request.actionDigest,
            issuedAt: issuedAt,
            expiresAt: min(current.expiresAt, issuedAt.addingTimeInterval(90)),
            maxAttempts: 1,
            consumed: false
        )
        let record = ChallengeRecord(
            request: request,
            requestDigest: requestDigest,
            challenge: challenge
        )
        challengesByID[challenge.challengeID] = record
        challengeIDByIdempotencyKey[request.idempotencyKey] = challenge.challengeID
        return challenge
    }

    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse {
        let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        if let cached = responsesByIdempotencyKey[request.idempotencyKey] {
            guard cached.requestDigest == requestDigest else {
                throw LiveMissionServiceError.idempotencyConflict
            }
            return cached.response
        }

        guard request.contractVersion == LiveMissionContract.version,
              validIdentifier(request.commandID),
              validIdentifier(request.missionID),
              validIdempotencyKey(request.idempotencyKey),
              validIdentifier(request.challengeID),
              validIdentifier(request.deviceBindingID),
              BirdieCanonicalJSON.validBase64URL(
                  request.oneTimeNonce,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 128
              ),
              BirdieCanonicalJSON.validBase64URL(
                  request.actionDigest,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 43
              ),
              (request.reason?.count ?? 0) <= 1_000 else {
            throw LiveMissionServiceError.invalidChallenge
        }
        guard let challengeRecord = challengesByID[request.challengeID] else {
            throw LiveMissionServiceError.invalidChallenge
        }
        let challenge = challengeRecord.challenge
        guard challengeRecord.request.missionID == request.missionID,
              challengeRecord.request.recordVersion == request.recordVersion,
              challengeRecord.request.idempotencyKey == request.idempotencyKey,
              challengeRecord.request.deviceBindingID == request.deviceBindingID,
              challengeRecord.request.actionDigest == request.actionDigest,
              challengeRecord.request.command == request.command,
              challenge.contractVersion == request.contractVersion,
              challenge.resourceType == "mission",
              challenge.missionID == request.missionID,
              challenge.recordVersion == request.recordVersion,
              challenge.idempotencyKey == request.idempotencyKey,
              challenge.deviceBindingID == request.deviceBindingID,
              challenge.oneTimeNonce == request.oneTimeNonce,
              challenge.actionDigest == request.actionDigest,
              challenge.maxAttempts == 1,
              challenge.consumed == false else {
            throw LiveMissionServiceError.invalidChallenge
        }
        guard !consumedChallengeIDs.contains(request.challengeID) else {
            throw LiveMissionServiceError.replayDetected
        }
        let currentDate = now()
        guard challenge.expiresAt > currentDate else {
            throw LiveMissionServiceError.challengeExpired
        }
        guard request.clientIssuedAt >= challenge.issuedAt.addingTimeInterval(-5),
              request.clientIssuedAt <= currentDate.addingTimeInterval(5) else {
            throw LiveMissionServiceError.invalidChallenge
        }

        if let existingDigest = nonceReservations[request.oneTimeNonce],
           existingDigest != requestDigest {
            throw LiveMissionServiceError.replayDetected
        }

        let assertionPayloadData = try BirdieCanonicalJSON.data(request.assertionPayload)
        let expectedClientDataHash = Data(SHA256.hash(data: assertionPayloadData))
        let expectedClientDataHashString = BirdieCanonicalJSON.base64URL(expectedClientDataHash)
        let expectedMockAssertion = BirdieCanonicalJSON.base64URL(
            Data("mock:\(expectedClientDataHashString)".utf8)
        )
        guard request.deviceAssertion.provider == "local_mock_only",
              request.deviceBindingID == LocalMockDeviceIdentity.bindingID,
              request.deviceAssertion.keyID == LocalMockDeviceIdentity.keyID,
              request.deviceAssertion.clientDataHash == expectedClientDataHashString,
              request.deviceAssertion.assertionObject == expectedMockAssertion else {
            throw LiveMissionServiceError.invalidDeviceAssertion
        }

        let evidence = request.localAuthorization
        guard evidence.success,
              evidence.contextDigest == request.actionDigest,
              evidence.evaluatedAt >= challenge.issuedAt.addingTimeInterval(-5),
              evidence.evaluatedAt <= currentDate.addingTimeInterval(5),
              currentDate.timeIntervalSince(evidence.evaluatedAt) <= 2 * 60 else {
            throw LiveMissionServiceError.localAuthorizationRequired
        }
        if request.command == .cancel {
            guard ["face_id", "touch_id"].contains(evidence.method),
                  evidence.policy == "biometrics_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        } else {
            guard evidence.method == "not_required",
                  evidence.policy == "low_risk_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        }

        guard let current = mission, current.missionID == request.missionID else {
            throw LiveMissionServiceError.missionNotFound
        }
        guard current.recordVersion == request.recordVersion else {
            throw LiveMissionServiceError.versionConflict
        }
        guard currentDate < current.expiresAt else {
            throw LiveMissionServiceError.missionExpired
        }
        guard commandIsAllowed(request.command, for: current) else {
            throw LiveMissionServiceError.commandNotAllowed
        }
        let expectedActionDigest = try BirdieCanonicalJSON.sha256Digest(
            MissionCommandActionSnapshot(
                contractVersion: LiveMissionContract.version,
                missionID: request.missionID,
                recordVersion: request.recordVersion,
                command: request.command
            )
        )
        guard request.actionDigest == expectedActionDigest else {
            throw LiveMissionServiceError.invalidChallenge
        }

        let nextStatus: LiveMissionStatus = switch request.command {
        case .pause: .paused
        case .resume: .running
        case .cancel: .cancelled
        }
        let updated = try current.replacing(
            recordVersion: current.recordVersion + 1,
            status: nextStatus,
            updatedAt: max(currentDate, current.updatedAt)
        )

        // Keep the in-memory sequence unchanged until the complete response is
        // assembled and committed below; signing/encoding failures must not
        // consume an audit number.
        let nextAuditSequence = auditSequence + 1
        let receiptID = "receipt-\(requestDigest)"
        let auditEventID = "audit-\(BirdieCanonicalJSON.sha256Digest(Data((requestDigest + ":event").utf8)))"
        let auditHeadHash = BirdieCanonicalJSON.sha256Digest(
            Data([requestDigest, auditEventID, String(nextAuditSequence)].joined(separator: ":").utf8)
        )
        let unsignedReceipt = MissionCommandReceiptSigningPayload(
            contractVersion: LiveMissionContract.version,
            receiptID: receiptID,
            commandID: request.commandID,
            missionID: request.missionID,
            recordVersion: updated.recordVersion,
            command: request.command,
            outcome: .accepted,
            idempotencyKey: request.idempotencyKey,
            requestDigest: requestDigest,
            recordedAt: currentDate,
            auditEventID: auditEventID,
            auditSequence: nextAuditSequence,
            auditHeadHash: auditHeadHash
        )
        let signedData = try BirdieCanonicalJSON.data(unsignedReceipt)
        let signature = try receiptSigningKey.signature(for: signedData)
        let receipt = MissionCommandReceipt(
            contractVersion: unsignedReceipt.contractVersion,
            receiptID: unsignedReceipt.receiptID,
            commandID: unsignedReceipt.commandID,
            missionID: unsignedReceipt.missionID,
            recordVersion: unsignedReceipt.recordVersion,
            command: unsignedReceipt.command,
            outcome: unsignedReceipt.outcome,
            idempotencyKey: unsignedReceipt.idempotencyKey,
            requestDigest: unsignedReceipt.requestDigest,
            recordedAt: unsignedReceipt.recordedAt,
            auditEventID: unsignedReceipt.auditEventID,
            auditSequence: unsignedReceipt.auditSequence,
            auditHeadHash: unsignedReceipt.auditHeadHash,
            serverSignature: ServerSignature(
                format: "raw-ed25519-jcs",
                algorithm: "EdDSA",
                keyID: receiptSigningKeyID,
                canonicalization: "RFC8785",
                signature: BirdieCanonicalJSON.base64URL(signature),
                signedAt: currentDate
            )
        )
        let response = MissionCommandResponse(
            contractVersion: LiveMissionContract.version,
            receipt: receipt,
            mission: updated
        )

        // These mutations model the server's single atomic transaction.
        mission = updated
        auditSequence = nextAuditSequence
        nonceReservations[request.oneTimeNonce] = requestDigest
        consumedChallengeIDs.insert(request.challengeID)
        responsesByIdempotencyKey[request.idempotencyKey] = CachedResponse(
            requestDigest: requestDigest,
            response: response
        )
        return response
    }

    func debugReceiptVerificationKey() -> BirdieServerVerificationKey {
        BirdieServerVerificationKey(
            keyID: receiptSigningKeyID,
            rawRepresentation: receiptSigningKey.publicKey.rawRepresentation
        )
    }

    private func commandIsAllowed(_ command: LiveMissionCommand, for mission: LiveMissionRecord) -> Bool {
        switch command {
        case .pause:
            mission.status == .running && mission.allowsPause
        case .resume:
            mission.status == .paused
        case .cancel:
            !mission.status.isTerminal && mission.allowsCancel
        }
    }

    private func validIdentifier(_ value: String) -> Bool {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        return (16 ... 128).contains(value.count)
            && value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private func validIdempotencyKey(_ value: String) -> Bool {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
        )
        return (16 ... 128).contains(value.count)
            && value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func randomNonce() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw LiveMissionServiceError.invalidChallenge
        }
        return BirdieCanonicalJSON.base64URL(Data(bytes))
    }
}
#endif
