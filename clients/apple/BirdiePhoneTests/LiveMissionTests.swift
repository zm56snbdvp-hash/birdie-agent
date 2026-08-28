import CryptoKit
import XCTest
@testable import Birdie

final class LiveMissionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_788_000_000)

    func testMissionRejectsMoreThanEightHours() throws {
        XCTAssertThrowsError(
            try LiveMissionRecord(
                missionID: "mission-unit-test-001",
                recordVersion: 1,
                title: "Begrenzter Auftrag",
                scope: LiveMissionScope(
                    summary: "Test",
                    boundary: "Keine externen Aktionen",
                    maximumDurationSeconds: 8 * 60 * 60
                ),
                status: .running,
                progress: 0,
                currentStep: LiveMissionStep(index: 1, total: 1, title: "Prüfen"),
                blocker: nil,
                allowsPause: true,
                allowsCancel: true,
                startedAt: now,
                updatedAt: now,
                expiresAt: now.addingTimeInterval(8 * 60 * 60 + 1)
            )
        ) { error in
            XCTAssertEqual(error as? LiveMissionValidationError, .invalidDuration)
        }
    }

    @MainActor
    func testLiveActivityUsesOnlyGenericLockScreenTitle() {
        XCTAssertEqual(LiveMissionActivityCoordinator.lockScreenTitle, "Birdie-Auftrag")
        XCTAssertNotEqual(
            LiveMissionActivityCoordinator.lockScreenTitle,
            "Freigabebericht vorbereiten"
        )
    }

    func testCoordinatorBuildsTrustV1RequestAndVerifiableMockReceipt() async throws {
        let fixedNow = now
        let baseService = LiveMissionMockService(now: { fixedNow })
        let service = CapturingMissionService(base: baseService)
        let authorizer = RecordingMissionAuthorizer(now: fixedNow, biometricMethod: "face_id")
        let pendingCache = LiveMissionPendingRequestCache(fileURL: nil)
        let coordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: authorizer,
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: pendingCache,
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let mission = try XCTUnwrap(fetchedMission)

        let response = try await coordinator.execute(
            mission: mission,
            command: .pause,
            idempotencyKey: "mission-command-unit-test-001",
            reason: nil
        )

        let challenges = await service.capturedChallenges()
        let requests = await service.capturedRequests()
        let challenge = try XCTUnwrap(challenges.first)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(challenges.count, 1)
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(challenge.resourceType, "mission")
        XCTAssertEqual(challenge.missionID, mission.missionID)
        XCTAssertEqual(challenge.recordVersion, mission.recordVersion)
        XCTAssertEqual(challenge.actionDigest, request.actionDigest)
        XCTAssertEqual(challenge.oneTimeNonce, request.oneTimeNonce)
        XCTAssertEqual(try XCTUnwrap(decodeBase64URL(challenge.oneTimeNonce)).count, 32)
        XCTAssertEqual(request.deviceBindingID, LocalMockDeviceIdentity.bindingID)
        XCTAssertEqual(request.deviceAssertion.keyID, LocalMockDeviceIdentity.keyID)
        XCTAssertNotEqual(request.deviceAssertion.keyID, request.deviceBindingID)
        XCTAssertFalse(request.deviceAssertion.keyID.isEmpty)
        XCTAssertLessThanOrEqual(request.deviceAssertion.keyID.count, 1_024)
        XCTAssertEqual(request.deviceAssertion.provider, "local_mock_only")
        XCTAssertEqual(request.localAuthorization.method, "not_required")
        XCTAssertEqual(request.localAuthorization.policy, "low_risk_only")
        XCTAssertEqual(request.localAuthorization.contextDigest, request.actionDigest)
        XCTAssertEqual(response.mission.status, .paused)
        XCTAssertEqual(response.mission.recordVersion, mission.recordVersion + 1)
        XCTAssertEqual(response.receipt.requestDigest, try BirdieCanonicalJSON.sha256Digest(request))
        XCTAssertEqual(response.receipt.serverSignature.format, "raw-ed25519-jcs")
        XCTAssertEqual(response.receipt.serverSignature.algorithm, "EdDSA")
        XCTAssertEqual(response.receipt.serverSignature.canonicalization, "RFC8785")

        let verificationKey = await baseService.debugReceiptVerificationKey()
        let publicKey = try Curve25519.Signing.PublicKey(
            rawRepresentation: verificationKey.rawRepresentation
        )
        XCTAssertEqual(verificationKey.keyID, response.receipt.serverSignature.keyID)
        let signature = try XCTUnwrap(decodeBase64URL(response.receipt.serverSignature.signature))
        let signedData = try BirdieCanonicalJSON.data(response.receipt.signingPayload)
        XCTAssertTrue(publicKey.isValidSignature(signature, for: signedData))

        let durableURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pending-mission-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: durableURL) }
        let durableCache = LiveMissionPendingRequestCache(fileURL: durableURL)
        try await durableCache.store(
            request,
            originalMission: mission,
            expiresAt: mission.expiresAt,
            storedAt: fixedNow
        )
        let reloadedCache = LiveMissionPendingRequestCache(fileURL: durableURL)
        let reloadedRequest = await reloadedCache.request(for: request.idempotencyKey)
        XCTAssertEqual(reloadedRequest, request)

        let recoveryAuthorizer = RecordingMissionAuthorizer(
            now: fixedNow,
            biometricMethod: "face_id"
        )
        let recoveryCoordinator = LiveMissionCommandCoordinator(
            service: baseService,
            localAuthorizer: recoveryAuthorizer,
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: reloadedCache,
            now: { fixedNow }
        )
        let recoveredResponse = try await recoveryCoordinator.execute(
            mission: mission,
            command: .pause,
            idempotencyKey: "mission-new-key-after-relaunch-001",
            reason: nil
        )
        let recoveryAuthorizationCalls = await recoveryAuthorizer.recordedRequirements()
        XCTAssertEqual(recoveredResponse, response)
        XCTAssertTrue(recoveryAuthorizationCalls.isEmpty)
    }

    @MainActor
    func testResponseLossRestartRecoversExactRequestAfterMissionReachedNextVersion() async throws {
        let fixedNow = now
        let baseService = LiveMissionMockService(now: { fixedNow })
        let service = CapturingMissionService(
            base: baseService,
            loseFirstResponse: true,
            hideTerminalMission: true
        )
        let authorizer = RecordingMissionAuthorizer(now: fixedNow, biometricMethod: "face_id")
        let durableURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pending-mission-restart-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: durableURL) }
        let pendingCache = LiveMissionPendingRequestCache(fileURL: durableURL)
        let coordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: authorizer,
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: pendingCache,
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let mission = try XCTUnwrap(fetchedMission)
        let idempotencyKey = "mission-cancel-response-loss-001"

        do {
            _ = try await coordinator.execute(
                mission: mission,
                command: .cancel,
                idempotencyKey: idempotencyKey,
                reason: nil
            )
            XCTFail("Der simulierte Antwortverlust muss beim ersten Aufruf sichtbar sein.")
        } catch is SimulatedResponseLoss {
            // Expected: the mock server already committed and cached the response.
        }

        let cachedAfterLoss = await pendingCache.request(for: idempotencyKey)
        XCTAssertNotNil(cachedAfterLoss)
        let fetchedServerMissionAfterCommit = try await baseService.fetchCurrentMission()
        let serverMissionAfterCommit = try XCTUnwrap(fetchedServerMissionAfterCommit)
        XCTAssertEqual(serverMissionAfterCommit.recordVersion, mission.recordVersion + 1)
        XCTAssertEqual(serverMissionAfterCommit.status, .cancelled)

        let reloadedCache = LiveMissionPendingRequestCache(fileURL: durableURL)
        let recoveryCoordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: authorizer,
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: reloadedCache,
            now: { fixedNow }
        )
        let recoveredStore = LiveMissionStore(
            service: service,
            activityCoordinator: NoopMissionActivityCoordinator(),
            commandCoordinator: recoveryCoordinator
        )
        await recoveredStore.load()
        let submittedRequests = await service.capturedRequests()
        let authorizationCalls = await authorizer.recordedRequirements()
        let challenges = await service.capturedChallenges()
        let cachedAfterReceipt = await reloadedCache.request(for: idempotencyKey)

        XCTAssertEqual(submittedRequests.count, 2)
        XCTAssertEqual(submittedRequests[0], submittedRequests[1])
        XCTAssertEqual(authorizationCalls, [true])
        XCTAssertEqual(challenges.count, 1)
        XCTAssertNil(cachedAfterReceipt)
        XCTAssertEqual(recoveredStore.mission?.recordVersion, mission.recordVersion + 1)
        XCTAssertEqual(recoveredStore.mission?.status, .cancelled)
        XCTAssertEqual(recoveredStore.lastCommandReceipt?.idempotencyKey, idempotencyKey)
    }

    @MainActor
    func testExpiredUncommittedPendingDoesNotPoisonStoreLoad() async throws {
        let fixedNow = now
        let baseService = LiveMissionMockService(now: { fixedNow })
        let service = ExpiringPendingMissionService(base: baseService)
        let durableURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pending-mission-expired-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: durableURL) }
        let cache = LiveMissionPendingRequestCache(fileURL: durableURL)
        let firstCoordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: RecordingMissionAuthorizer(
                now: fixedNow,
                biometricMethod: "face_id"
            ),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: cache,
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let original = try XCTUnwrap(fetchedMission)
        let idempotencyKey = "mission-expired-pending-test-001"

        do {
            _ = try await firstCoordinator.execute(
                mission: original,
                command: .pause,
                idempotencyKey: idempotencyKey,
                reason: nil
            )
            XCTFail("Der erste Transportverlust muss den exakten Request persistent lassen.")
        } catch is SimulatedResponseLoss {
            // Expected: this service deliberately does not commit the request.
        }

        let reloadedCache = LiveMissionPendingRequestCache(fileURL: durableURL)
        let recoveryCoordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: RecordingMissionAuthorizer(
                now: fixedNow,
                biometricMethod: "face_id"
            ),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            pendingRequestCache: reloadedCache,
            now: { fixedNow }
        )
        let store = LiveMissionStore(
            service: service,
            activityCoordinator: NoopMissionActivityCoordinator(),
            commandCoordinator: recoveryCoordinator
        )

        await store.load()

        XCTAssertEqual(store.mission, original)
        XCTAssertNil(await reloadedCache.request(for: idempotencyKey))
        XCTAssertEqual(await service.submissionCount(), 2)
        XCTAssertEqual(await service.fetchCount(), 2)
    }

    func testMutatedIdempotentRetryFailsClosed() async throws {
        let fixedNow = now
        let baseService = LiveMissionMockService(now: { fixedNow })
        let service = CapturingMissionService(base: baseService)
        let coordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: RecordingMissionAuthorizer(now: fixedNow, biometricMethod: "face_id"),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let mission = try XCTUnwrap(fetchedMission)
        _ = try await coordinator.execute(
            mission: mission,
            command: .pause,
            idempotencyKey: "mission-command-mutation-test-001",
            reason: nil
        )
        let requests = await service.capturedRequests()
        let original = try XCTUnwrap(requests.first)
        let mutated = MissionCommandRequest(
            contractVersion: original.contractVersion,
            commandID: "mutated-command-001",
            missionID: original.missionID,
            recordVersion: original.recordVersion,
            idempotencyKey: original.idempotencyKey,
            challengeID: original.challengeID,
            oneTimeNonce: original.oneTimeNonce,
            actionDigest: original.actionDigest,
            deviceBindingID: original.deviceBindingID,
            deviceAssertion: original.deviceAssertion,
            localAuthorization: original.localAuthorization,
            command: original.command,
            reason: original.reason,
            clientIssuedAt: original.clientIssuedAt
        )

        do {
            _ = try await baseService.submit(mutated)
            XCTFail("Ein mutierter Retry mit demselben Idempotency-Key muss fehlschlagen.")
        } catch let error as LiveMissionServiceError {
            XCTAssertEqual(error, .idempotencyConflict)
        }
    }

    func testUntrustedReceiptFailsClosedAndPendingRequestSurvives() async throws {
        let fixedNow = now
        let service = LiveMissionMockService(now: { fixedNow })
        let cache = LiveMissionPendingRequestCache(fileURL: nil)
        let coordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: RecordingMissionAuthorizer(
                now: fixedNow,
                biometricMethod: "face_id"
            ),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: UnconfiguredServerSignatureVerifier(),
            pendingRequestCache: cache,
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let mission = try XCTUnwrap(fetchedMission)
        let idempotencyKey = "mission-untrusted-receipt-test-001"

        do {
            _ = try await coordinator.execute(
                mission: mission,
                command: .pause,
                idempotencyKey: idempotencyKey,
                reason: nil
            )
            XCTFail("Ein Receipt ohne vertrauenswürdigen Verifikations-Key muss scheitern.")
        } catch let error as BirdieTrustError {
            if case .invalidContract = error {
                // Expected.
            } else {
                XCTFail("Unerwarteter Trust-Fehler: \(error)")
            }
        }

        let cachedRequest = await cache.request(for: idempotencyKey)
        XCTAssertNotNil(cachedRequest)
    }

    func testCancellationRequiresFreshBiometricsOnlyAuthorization() async throws {
        let fixedNow = now
        let baseService = LiveMissionMockService(now: { fixedNow })
        let service = CapturingMissionService(base: baseService)
        let authorizer = RecordingMissionAuthorizer(now: fixedNow, biometricMethod: "face_id")
        let coordinator = LiveMissionCommandCoordinator(
            service: service,
            localAuthorizer: authorizer,
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: baseService),
            now: { fixedNow }
        )
        let fetchedMission = try await service.fetchCurrentMission()
        let mission = try XCTUnwrap(fetchedMission)

        let response = try await coordinator.execute(
            mission: mission,
            command: .cancel,
            idempotencyKey: "mission-cancel-unit-test-001",
            reason: "Vom Nutzer in der geöffneten App bestätigt"
        )
        let requirements = await authorizer.recordedRequirements()
        let requests = await service.capturedRequests()
        let request = try XCTUnwrap(requests.first)

        XCTAssertEqual(requirements, [true])
        XCTAssertEqual(request.localAuthorization.method, "face_id")
        XCTAssertEqual(request.localAuthorization.policy, "biometrics_only")
        XCTAssertEqual(response.mission.status, .cancelled)

        let staleService = LiveMissionMockService(now: { fixedNow })
        let staleCoordinator = LiveMissionCommandCoordinator(
            service: staleService,
            localAuthorizer: RecordingMissionAuthorizer(
                now: fixedNow.addingTimeInterval(-181),
                biometricMethod: "face_id"
            ),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            receiptVerifier: mockReceiptVerifier(for: staleService),
            now: { fixedNow }
        )
        let fetchedStaleMission = try await staleService.fetchCurrentMission()
        let staleMission = try XCTUnwrap(fetchedStaleMission)
        do {
            _ = try await staleCoordinator.execute(
                mission: staleMission,
                command: .cancel,
                idempotencyKey: "mission-cancel-stale-test-001",
                reason: nil
            )
            XCTFail("Veraltete biometrische Evidenz muss vor dem Submit scheitern.")
        } catch let error as LiveMissionServiceError {
            XCTAssertEqual(error, .localAuthorizationRequired)
        }
    }

    @MainActor
    func testStoreRetainsPendingIdempotencyAcrossTransportFailure() async throws {
        let fixedNow = now
        let service = LiveMissionMockService(now: { fixedNow })
        let failingCoordinator = AlwaysFailingMissionCoordinator()
        let store = LiveMissionStore(
            service: service,
            activityCoordinator: NoopMissionActivityCoordinator(),
            commandCoordinator: failingCoordinator
        )
        await store.load()
        let missionID = try XCTUnwrap(store.mission?.missionID)
        let pauseURL = try XCTUnwrap(
            BirdieLiveMissionDeepLink(missionID: missionID, intent: .pause).url
        )
        store.handle(deepLink: pauseURL, applicationIsActive: true)
        XCTAssertEqual(store.pendingCommand?.command, .pause)
        let originalKey = try XCTUnwrap(store.pendingCommand?.idempotencyKey)
        store.prepare(command: .pause, applicationIsActive: true)
        XCTAssertEqual(store.pendingCommand?.idempotencyKey, originalKey)

        await store.confirmPendingCommand(applicationIsActive: true)
        XCTAssertEqual(store.pendingCommand?.idempotencyKey, originalKey)
        await store.confirmPendingCommand(applicationIsActive: true)
        XCTAssertEqual(store.pendingCommand?.idempotencyKey, originalKey)

        let keys = await failingCoordinator.recordedKeys()
        XCTAssertEqual(keys, [originalKey, originalKey])
    }

    @MainActor
    func testStoreAndActivityRejectOlderRecordVersions() async throws {
        let fixedNow = now
        let mock = LiveMissionMockService(now: { fixedNow })
        let fetchedMission = try await mock.fetchCurrentMission()
        let original = try XCTUnwrap(fetchedMission)
        let newer = try original.replacing(
            recordVersion: original.recordVersion + 1,
            status: .paused,
            updatedAt: fixedNow
        )
        let service = SequencedMissionService(responses: [newer, original])
        let store = LiveMissionStore(
            service: service,
            activityCoordinator: NoopMissionActivityCoordinator(),
            commandCoordinator: AlwaysFailingMissionCoordinator()
        )

        await store.load()
        XCTAssertEqual(store.mission, newer)
        await store.load()
        XCTAssertEqual(store.mission, newer)

        XCTAssertTrue(
            LiveMissionActivityCoordinator.acceptsUpdate(
                recordVersion: newer.recordVersion,
                currentRecordVersion: newer.recordVersion
            )
        )
        XCTAssertFalse(
            LiveMissionActivityCoordinator.acceptsUpdate(
                recordVersion: original.recordVersion,
                currentRecordVersion: newer.recordVersion
            )
        )
    }

    func testDeepLinkUsesContractHostAndAllowsQuerylessOpen() throws {
        let missionID = "mission-unit-test-001"
        let activityLink = BirdieLiveMissionDeepLink(
            missionID: missionID,
            intent: .cancel
        )
        let activityURL = try XCTUnwrap(activityLink.url)
        let decodedActivityLink = try XCTUnwrap(BirdieLiveMissionDeepLink(url: activityURL))
        let components = try XCTUnwrap(URLComponents(url: activityURL, resolvingAgainstBaseURL: false))
        let queryNames = Set(components.queryItems?.map(\.name) ?? [])

        XCTAssertEqual(activityURL.host, "missions")
        XCTAssertEqual(decodedActivityLink, activityLink)
        XCTAssertEqual(queryNames, Set(["intent"]))

        let openURL = try XCTUnwrap(URL(string: "birdie://missions/\(missionID)"))
        let openLink = try XCTUnwrap(BirdieLiveMissionDeepLink(url: openURL))
        XCTAssertEqual(openLink.missionID, missionID)
        XCTAssertEqual(openLink.intent, .open)
        XCTAssertNil(BirdieLiveMissionDeepLink(url: URL(string: "birdie://live-mission/\(missionID)")!))
        XCTAssertNil(BirdieLiveMissionDeepLink(url: URL(string: "birdie://missions/\(missionID)?")!))
        XCTAssertNil(BirdieLiveMissionDeepLink(url: URL(string: "birdie://missions/\(missionID)/")!))
        XCTAssertNil(BirdieLiveMissionDeepLink(url: URL(string: "https://example.invalid/missions/id")!))
    }
}

private actor RecordingMissionAuthorizer: LiveMissionLocalAuthorizing {
    private let now: Date
    private let biometricMethod: String
    private var requirements: [Bool] = []

    init(now: Date, biometricMethod: String) {
        self.now = now
        self.biometricMethod = biometricMethod
    }

    func authorize(
        actionDigest: String,
        requiresBiometrics: Bool
    ) async throws -> LocalAuthorizationEvidence {
        requirements.append(requiresBiometrics)
        return LocalAuthorizationEvidence(
            method: requiresBiometrics ? biometricMethod : "not_required",
            policy: requiresBiometrics ? "biometrics_only" : "low_risk_only",
            success: true,
            evaluatedAt: now,
            contextDigest: actionDigest
        )
    }

    func recordedRequirements() -> [Bool] {
        requirements
    }
}

private struct SimulatedResponseLoss: Error {}

private actor CapturingMissionService: LiveMissionServicing {
    private let base: LiveMissionMockService
    private var challengeValues: [MissionActionChallenge] = []
    private var requestValues: [MissionCommandRequest] = []
    private var loseNextResponse: Bool
    private let hideTerminalMission: Bool

    init(
        base: LiveMissionMockService,
        loseFirstResponse: Bool = false,
        hideTerminalMission: Bool = false
    ) {
        self.base = base
        loseNextResponse = loseFirstResponse
        self.hideTerminalMission = hideTerminalMission
    }

    func fetchCurrentMission() async throws -> LiveMissionRecord? {
        let mission = try await base.fetchCurrentMission()
        if hideTerminalMission, mission?.status.isTerminal == true {
            return nil
        }
        return mission
    }

    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge {
        let challenge = try await base.fetchChallenge(request)
        challengeValues.append(challenge)
        return challenge
    }

    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse {
        requestValues.append(request)
        let response = try await base.submit(request)
        if loseNextResponse {
            loseNextResponse = false
            throw SimulatedResponseLoss()
        }
        return response
    }

    func capturedChallenges() -> [MissionActionChallenge] {
        challengeValues
    }

    func capturedRequests() -> [MissionCommandRequest] {
        requestValues
    }
}

private actor ExpiringPendingMissionService: LiveMissionServicing {
    private let base: LiveMissionMockService
    private var submissions = 0
    private var fetches = 0

    init(base: LiveMissionMockService) {
        self.base = base
    }

    func fetchCurrentMission() async throws -> LiveMissionRecord? {
        fetches += 1
        return try await base.fetchCurrentMission()
    }

    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge {
        try await base.fetchChallenge(request)
    }

    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse {
        _ = request
        submissions += 1
        if submissions == 1 {
            throw SimulatedResponseLoss()
        }
        throw LiveMissionServiceError.challengeExpired
    }

    func submissionCount() -> Int { submissions }
    func fetchCount() -> Int { fetches }
}

private actor AlwaysFailingMissionCoordinator: LiveMissionCommandCoordinating {
    private var keys: [String] = []

    func execute(
        mission: LiveMissionRecord,
        command: LiveMissionCommand,
        idempotencyKey: String,
        reason: String?
    ) async throws -> MissionCommandResponse {
        keys.append(idempotencyKey)
        throw SimulatedResponseLoss()
    }

    func recordedKeys() -> [String] {
        keys
    }

    func recoverAllPendingResponses() async throws -> LiveMissionPendingRecoveryReport {
        .empty
    }
}

private actor SequencedMissionService: LiveMissionServicing {
    private var responses: [LiveMissionRecord?]

    init(responses: [LiveMissionRecord?]) {
        self.responses = responses
    }

    func fetchCurrentMission() async throws -> LiveMissionRecord? {
        guard !responses.isEmpty else { return nil }
        return responses.removeFirst()
    }

    func fetchChallenge(_ request: MissionChallengeRequest) async throws -> MissionActionChallenge {
        _ = request
        throw LiveMissionServiceError.productionServiceNotConfigured
    }

    func submit(_ request: MissionCommandRequest) async throws -> MissionCommandResponse {
        _ = request
        throw LiveMissionServiceError.productionServiceNotConfigured
    }
}

@MainActor
private final class NoopMissionActivityCoordinator: LiveMissionActivityCoordinating {
    func start(for mission: LiveMissionRecord) throws -> String { "noop" }
    func update(for mission: LiveMissionRecord) async throws {}
    func end(for mission: LiveMissionRecord) async throws {}
    func isActive(missionID: String) -> Bool { false }
}

private func mockReceiptVerifier(
    for service: LiveMissionMockService
) -> DynamicDebugEd25519ServerSignatureVerifier {
    DynamicDebugEd25519ServerSignatureVerifier {
        await service.debugReceiptVerificationKey()
    }
}

private func decodeBase64URL(_ value: String) -> Data? {
    let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
    let standard = value
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/") + padding
    return Data(base64Encoded: standard)
}
