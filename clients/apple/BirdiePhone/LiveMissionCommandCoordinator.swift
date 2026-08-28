import CryptoKit
import Foundation

struct MissionCommandActionSnapshot: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let missionID: String
    let recordVersion: Int
    let command: LiveMissionCommand

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case missionID = "missionId"
        case recordVersion
        case command
    }
}

actor LiveMissionPendingRequestCache {
    struct PendingRequest: Codable, Sendable {
        let request: MissionCommandRequest
        let originalMission: LiveMissionRecord
        let expiresAt: Date
        let storedAt: Date
    }

    private let fileURL: URL?
    private var requests: [String: PendingRequest]

    init() {
        let fileURL = Self.defaultURL()
        self.fileURL = fileURL
        requests = Self.load(from: fileURL)
    }

    init(fileURL: URL?) {
        self.fileURL = fileURL
        requests = Self.load(from: fileURL)
    }

    func request(for idempotencyKey: String) -> MissionCommandRequest? {
        requests[idempotencyKey]?.request
    }

    func request(
        missionID: String,
        recordVersion: Int,
        command: LiveMissionCommand
    ) -> MissionCommandRequest? {
        requests.values
            .filter {
                $0.request.missionID == missionID
                    && $0.request.recordVersion == recordVersion
                    && $0.request.command == command
            }
            .max { $0.storedAt < $1.storedAt }?
            .request
    }

    func pendingRequests() -> [PendingRequest] {
        requests.values
            .sorted { $0.storedAt < $1.storedAt }
    }

    func store(
        _ request: MissionCommandRequest,
        originalMission: LiveMissionRecord,
        expiresAt: Date,
        storedAt: Date
    ) throws {
        if let existing = requests[request.idempotencyKey], existing.request != request {
            throw LiveMissionServiceError.idempotencyConflict
        }
        let previous = requests[request.idempotencyKey]
        requests[request.idempotencyKey] = PendingRequest(
            request: request,
            originalMission: originalMission,
            expiresAt: expiresAt,
            storedAt: storedAt
        )
        do {
            try persist()
        } catch {
            if let previous {
                requests[request.idempotencyKey] = previous
            } else {
                requests.removeValue(forKey: request.idempotencyKey)
            }
            throw error
        }
    }

    func clear(idempotencyKey: String) throws {
        let removed = requests.removeValue(forKey: idempotencyKey)
        do {
            try persist()
        } catch {
            if let removed {
                requests[idempotencyKey] = removed
            }
            throw error
        }
    }

    private func persist() throws {
        guard let fileURL else { return }
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(Array(requests.values))
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    private static func defaultURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("BirdieTrust", isDirectory: true)
            .appendingPathComponent("pending-mission-commands-v1.json", isDirectory: false)
    }

    private static func load(from fileURL: URL?) -> [String: PendingRequest] {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let values = try? makeDecoder().decode([PendingRequest].self, from: data)
        else { return [:] }
        return Dictionary(
            values.map { ($0.request.idempotencyKey, $0) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

struct LiveMissionPendingRecoveryReport: Equatable, Sendable {
    let responses: [MissionCommandResponse]
    let discardedExpiredRequestCount: Int
    let retainedPendingRequestCount: Int

    static let empty = LiveMissionPendingRecoveryReport(
        responses: [],
        discardedExpiredRequestCount: 0,
        retainedPendingRequestCount: 0
    )
}

protocol LiveMissionCommandCoordinating: Sendable {
    func execute(
        mission: LiveMissionRecord,
        command: LiveMissionCommand,
        idempotencyKey: String,
        reason: String?
    ) async throws -> MissionCommandResponse

    func recoverAllPendingResponses() async throws -> LiveMissionPendingRecoveryReport
}

actor LiveMissionCommandCoordinator: LiveMissionCommandCoordinating {
    private let service: any LiveMissionServicing
    private let localAuthorizer: any LiveMissionLocalAuthorizing
    private let deviceAssertionProvider: any BirdieDeviceAssertionProviding
    private let receiptVerifier: any BirdieServerSignatureVerifying
    private let replayProtector: BirdieReplayProtector
    private let pendingRequestCache: LiveMissionPendingRequestCache
    private let now: @Sendable () -> Date
    private var inFlightIdempotencyKeys: Set<String> = []

    init(
        service: any LiveMissionServicing,
        localAuthorizer: any LiveMissionLocalAuthorizing,
        deviceAssertionProvider: any BirdieDeviceAssertionProviding,
        receiptVerifier: any BirdieServerSignatureVerifying = UnconfiguredServerSignatureVerifier(),
        replayProtector: BirdieReplayProtector = BirdieReplayProtector(),
        pendingRequestCache: LiveMissionPendingRequestCache = LiveMissionPendingRequestCache(fileURL: nil),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.service = service
        self.localAuthorizer = localAuthorizer
        self.deviceAssertionProvider = deviceAssertionProvider
        self.receiptVerifier = receiptVerifier
        self.replayProtector = replayProtector
        self.pendingRequestCache = pendingRequestCache
        self.now = now
    }

    func execute(
        mission: LiveMissionRecord,
        command: LiveMissionCommand,
        idempotencyKey: String,
        reason: String? = nil
    ) async throws -> MissionCommandResponse {
        guard mission.contractVersion == LiveMissionContract.version,
              mission.recordVersion >= 1,
              validIdempotencyKey(idempotencyKey),
              (reason?.count ?? 0) <= 1_000 else {
            throw LiveMissionServiceError.invalidChallenge
        }
        guard now() < mission.expiresAt else {
            throw LiveMissionServiceError.missionExpired
        }
        guard commandIsAllowed(command, for: mission) else {
            throw LiveMissionServiceError.commandNotAllowed
        }

        let actionSnapshot = MissionCommandActionSnapshot(
            contractVersion: LiveMissionContract.version,
            missionID: mission.missionID,
            recordVersion: mission.recordVersion,
            command: command
        )
        let actionDigest = try BirdieCanonicalJSON.sha256Digest(actionSnapshot)

        let exactCachedRequest = await pendingRequestCache.request(for: idempotencyKey)
        let cachedRequest: MissionCommandRequest?
        if let exactCachedRequest {
            cachedRequest = exactCachedRequest
        } else {
            cachedRequest = await pendingRequestCache.request(
                missionID: mission.missionID,
                recordVersion: mission.recordVersion,
                command: command
            )
        }
        let operationIdempotencyKey = cachedRequest?.idempotencyKey ?? idempotencyKey
        guard !inFlightIdempotencyKeys.contains(operationIdempotencyKey) else {
            throw LiveMissionServiceError.commandInProgress
        }
        inFlightIdempotencyKeys.insert(operationIdempotencyKey)
        defer { inFlightIdempotencyKeys.remove(operationIdempotencyKey) }

        let request: MissionCommandRequest
        if let cached = cachedRequest {
            guard cached.contractVersion == LiveMissionContract.version,
                  cached.missionID == mission.missionID,
                  cached.recordVersion == mission.recordVersion,
                  cached.command == command,
                  cached.actionDigest == actionDigest,
                  cached.reason == reason else {
                throw LiveMissionServiceError.idempotencyConflict
            }
            try validateCachedRequest(cached)
            try await replayProtector.reserve(
                nonce: cached.oneTimeNonce,
                requestDigest: BirdieCanonicalJSON.sha256Digest(cached)
            )
            request = cached
        } else {
            request = try await makeRequest(
                mission: mission,
                command: command,
                actionDigest: actionDigest,
                idempotencyKey: idempotencyKey,
                reason: reason
            )
            let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
            try await replayProtector.reserve(
                nonce: request.oneTimeNonce,
                requestDigest: requestDigest
            )
            try await pendingRequestCache.store(
                request,
                originalMission: mission,
                expiresAt: mission.expiresAt,
                storedAt: now()
            )
        }

        // A transport failure after server commit leaves this exact request in
        // the cache. The next attempt resubmits byte-equivalent Codable fields.
        let response = try await service.submit(request)
        try validate(response: response, request: request, originalMission: mission)
        try await verifyReceiptSignature(response.receipt)
        try await pendingRequestCache.clear(idempotencyKey: request.idempotencyKey)
        return response
    }

    /// Replays persisted, byte-identical requests after an app restart. This is
    /// intentionally independent of the just-fetched N+1 MissionRecord: the
    /// idempotent server path returns the already committed Receipt first.
    func recoverAllPendingResponses() async throws -> LiveMissionPendingRecoveryReport {
        let pendingRequests = await pendingRequestCache.pendingRequests()
        var recovered: [MissionCommandResponse] = []
        var discardedExpiredRequestCount = 0
        for pending in pendingRequests {
            let request = pending.request
            guard !inFlightIdempotencyKeys.contains(request.idempotencyKey) else {
                continue
            }
            inFlightIdempotencyKeys.insert(request.idempotencyKey)
            defer { inFlightIdempotencyKeys.remove(request.idempotencyKey) }

            do {
                try validateCachedRequest(request)
                try await replayProtector.reserve(
                    nonce: request.oneTimeNonce,
                    requestDigest: BirdieCanonicalJSON.sha256Digest(request)
                )

                let response: MissionCommandResponse
                do {
                    response = try await service.submit(request)
                } catch let error as LiveMissionServiceError where error == .challengeExpired {
                    // Trust-v1 requires committed idempotency to be checked before
                    // challenge expiry. This typed response therefore proves that
                    // the exact request was not committed and is safe to discard.
                    try await pendingRequestCache.clear(idempotencyKey: request.idempotencyKey)
                    discardedExpiredRequestCount += 1
                    continue
                }

                try validate(
                    response: response,
                    request: request,
                    originalMission: pending.originalMission
                )
                try await verifyReceiptSignature(response.receipt)
                try await pendingRequestCache.clear(idempotencyKey: request.idempotencyKey)
                recovered.append(response)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // Transport, malformed response, unknown key, and all other
                // ambiguous failures keep the exact request for a later retry.
                continue
            }
        }
        let retainedPendingRequestCount = await pendingRequestCache.pendingRequests().count
        return LiveMissionPendingRecoveryReport(
            responses: recovered,
            discardedExpiredRequestCount: discardedExpiredRequestCount,
            retainedPendingRequestCount: retainedPendingRequestCount
        )
    }

    private func makeRequest(
        mission: LiveMissionRecord,
        command: LiveMissionCommand,
        actionDigest: String,
        idempotencyKey: String,
        reason: String?
    ) async throws -> MissionCommandRequest {
        let deviceBindingID = try await deviceAssertionProvider.bindingID()
        let challengeRequest = MissionChallengeRequest(
            contractVersion: LiveMissionContract.version,
            missionID: mission.missionID,
            recordVersion: mission.recordVersion,
            idempotencyKey: idempotencyKey,
            deviceBindingID: deviceBindingID,
            actionDigest: actionDigest,
            command: command
        )
        let challenge = try await service.fetchChallenge(challengeRequest)
        try validate(
            challenge: challenge,
            request: challengeRequest,
            missionExpiresAt: mission.expiresAt
        )

        let localAuthorization = try await localAuthorizer.authorize(
            actionDigest: actionDigest,
            requiresBiometrics: command == .cancel
        )
        try validate(
            localAuthorization: localAuthorization,
            actionDigest: actionDigest,
            command: command,
            challengeIssuedAt: challenge.issuedAt
        )
        guard challenge.expiresAt > now() else {
            throw LiveMissionServiceError.challengeExpired
        }

        let commandID = UUID().uuidString.lowercased()
        let clientIssuedAt = now()
        let assertionPayload = MissionCommandAssertionPayload(
            contractVersion: LiveMissionContract.version,
            commandID: commandID,
            missionID: mission.missionID,
            recordVersion: mission.recordVersion,
            idempotencyKey: idempotencyKey,
            challengeID: challenge.challengeID,
            oneTimeNonce: challenge.oneTimeNonce,
            actionDigest: actionDigest,
            deviceBindingID: deviceBindingID,
            localAuthorization: localAuthorization,
            command: command,
            reason: reason,
            clientIssuedAt: clientIssuedAt
        )
        let clientDataHash = Data(
            SHA256.hash(data: try BirdieCanonicalJSON.data(assertionPayload))
        )
        let deviceAssertion = try await deviceAssertionProvider.assertion(for: clientDataHash)
        guard deviceAssertion.clientDataHash == BirdieCanonicalJSON.base64URL(clientDataHash),
              (1 ... 1_024).contains(deviceAssertion.keyID.count),
              BirdieCanonicalJSON.validBase64URL(
                  deviceAssertion.assertionObject,
                  minimumDecodedBytes: 16,
                  encodedLength: 16 ... 8_192
              ) else {
            throw LiveMissionServiceError.invalidDeviceAssertion
        }

        return MissionCommandRequest(
            contractVersion: assertionPayload.contractVersion,
            commandID: assertionPayload.commandID,
            missionID: assertionPayload.missionID,
            recordVersion: assertionPayload.recordVersion,
            idempotencyKey: assertionPayload.idempotencyKey,
            challengeID: assertionPayload.challengeID,
            oneTimeNonce: assertionPayload.oneTimeNonce,
            actionDigest: assertionPayload.actionDigest,
            deviceBindingID: assertionPayload.deviceBindingID,
            deviceAssertion: deviceAssertion,
            localAuthorization: assertionPayload.localAuthorization,
            command: assertionPayload.command,
            reason: assertionPayload.reason,
            clientIssuedAt: assertionPayload.clientIssuedAt
        )
    }

    private func validateCachedRequest(_ request: MissionCommandRequest) throws {
        let clientDataHash = Data(
            SHA256.hash(data: try BirdieCanonicalJSON.data(request.assertionPayload))
        )
#if DEBUG
        let allowedProvider = request.deviceAssertion.provider == "app_attest"
            || request.deviceAssertion.provider == "local_mock_only"
#else
        let allowedProvider = request.deviceAssertion.provider == "app_attest"
#endif
        guard request.contractVersion == LiveMissionContract.version,
              validIdentifier(request.commandID),
              validIdentifier(request.missionID),
              request.recordVersion >= 1,
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
              allowedProvider,
              (1 ... 1_024).contains(request.deviceAssertion.keyID.count),
              request.deviceAssertion.clientDataHash == BirdieCanonicalJSON.base64URL(clientDataHash),
              BirdieCanonicalJSON.validBase64URL(
                  request.deviceAssertion.assertionObject,
                  minimumDecodedBytes: 16,
                  encodedLength: 16 ... 8_192
              ),
              request.localAuthorization.success,
              request.localAuthorization.contextDigest == request.actionDigest,
              (request.reason?.count ?? 0) <= 1_000 else {
            throw LiveMissionServiceError.invalidChallenge
        }
        if request.command == .cancel {
            guard ["face_id", "touch_id"].contains(request.localAuthorization.method),
                  request.localAuthorization.policy == "biometrics_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        } else {
            guard request.localAuthorization.method == "not_required",
                  request.localAuthorization.policy == "low_risk_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        }
    }

    private func validate(
        challenge: MissionActionChallenge,
        request: MissionChallengeRequest,
        missionExpiresAt: Date
    ) throws {
        let currentDate = now()
        guard challenge.contractVersion == LiveMissionContract.version,
              challenge.resourceType == "mission",
              challenge.missionID == request.missionID,
              challenge.recordVersion == request.recordVersion,
              challenge.idempotencyKey == request.idempotencyKey,
              challenge.deviceBindingID == request.deviceBindingID,
              challenge.actionDigest == request.actionDigest,
              validIdentifier(challenge.challengeID),
              BirdieCanonicalJSON.validBase64URL(
                  challenge.oneTimeNonce,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 128
              ),
              challenge.maxAttempts == 1,
              challenge.consumed == false else {
            throw LiveMissionServiceError.invalidChallenge
        }
        guard challenge.issuedAt <= currentDate.addingTimeInterval(5),
              challenge.expiresAt > currentDate,
              challenge.expiresAt <= challenge.issuedAt.addingTimeInterval(120),
              challenge.expiresAt <= missionExpiresAt else {
            throw LiveMissionServiceError.challengeExpired
        }
    }

    private func verifyReceiptSignature(_ receipt: MissionCommandReceipt) async throws {
        try await receiptVerifier.verify(
            signature: receipt.serverSignature,
            payload: BirdieCanonicalJSON.data(receipt.signingPayload)
        )
    }

    private func validate(
        localAuthorization: LocalAuthorizationEvidence,
        actionDigest: String,
        command: LiveMissionCommand,
        challengeIssuedAt: Date
    ) throws {
        let currentDate = now()
        guard localAuthorization.success,
              localAuthorization.contextDigest == actionDigest,
              localAuthorization.evaluatedAt >= challengeIssuedAt.addingTimeInterval(-5),
              localAuthorization.evaluatedAt <= currentDate.addingTimeInterval(5),
              currentDate.timeIntervalSince(localAuthorization.evaluatedAt) <= 2 * 60 else {
            throw LiveMissionServiceError.localAuthorizationRequired
        }
        if command == .cancel {
            guard ["face_id", "touch_id"].contains(localAuthorization.method),
                  localAuthorization.policy == "biometrics_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        } else {
            guard localAuthorization.method == "not_required",
                  localAuthorization.policy == "low_risk_only" else {
                throw LiveMissionServiceError.localAuthorizationRequired
            }
        }
    }

    private func validate(
        response: MissionCommandResponse,
        request: MissionCommandRequest,
        originalMission: LiveMissionRecord
    ) throws {
        let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        let receipt = response.receipt
        guard response.contractVersion == LiveMissionContract.version,
              response.mission.contractVersion == LiveMissionContract.version,
              response.mission.missionID == request.missionID,
              receipt.contractVersion == LiveMissionContract.version,
              receipt.commandID == request.commandID,
              receipt.missionID == request.missionID,
              receipt.recordVersion == response.mission.recordVersion,
              receipt.command == request.command,
              receipt.idempotencyKey == request.idempotencyKey,
              receipt.requestDigest == requestDigest,
              validIdentifier(receipt.receiptID),
              validIdentifier(receipt.auditEventID),
              receipt.auditSequence >= 1,
              BirdieCanonicalJSON.validBase64URL(
                  receipt.auditHeadHash,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 43
              ),
              receipt.serverSignature.format == "raw-ed25519-jcs",
              receipt.serverSignature.algorithm == "EdDSA",
              receipt.serverSignature.canonicalization == "RFC8785",
              (1 ... 256).contains(receipt.serverSignature.keyID.count),
              BirdieCanonicalJSON.validBase64URL(
                  receipt.serverSignature.signature,
                  minimumDecodedBytes: 64,
                  encodedLength: 86 ... 86
              ),
              receipt.recordedAt >= request.clientIssuedAt.addingTimeInterval(-5),
              receipt.serverSignature.signedAt >= receipt.recordedAt.addingTimeInterval(-5) else {
            throw LiveMissionServiceError.invalidChallenge
        }
        if receipt.outcome == .accepted {
            let expectedStatus: LiveMissionStatus = switch request.command {
            case .pause: .paused
            case .resume: .running
            case .cancel: .cancelled
            }
            guard response.mission.recordVersion == request.recordVersion + 1,
                  response.mission.status == expectedStatus else {
                throw LiveMissionServiceError.versionConflict
            }
        } else {
            guard response.mission == originalMission else {
                throw LiveMissionServiceError.versionConflict
            }
        }
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
}
