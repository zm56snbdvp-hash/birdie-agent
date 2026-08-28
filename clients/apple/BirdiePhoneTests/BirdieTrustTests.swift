import CryptoKit
import XCTest
@testable import Birdie

final class BirdieTrustTests: XCTestCase {
    func testAppAttestEnrollmentActivatesOnlyVerifiedServerBinding() async throws {
        let client = MockDeviceBindingClient()
        let registrar = RegistrationProviderSpy()
        let coordinator = BirdieDeviceBindingCoordinator(
            client: client,
            registrar: registrar,
            serverSignatureVerifier: DynamicDebugEd25519ServerSignatureVerifier {
                await client.verificationKey()
            },
            pendingCache: BirdiePendingRegistrationCache(fileURL: nil)
        )

        let acknowledgement = try await coordinator.enroll()
        let activation = await registrar.activation

        XCTAssertEqual(activation?.keyID, "opaque.apple/key+id==20260828")
        XCTAssertEqual(activation?.keyID, acknowledgement.keyID)
        XCTAssertEqual(activation?.deviceBindingID, acknowledgement.deviceBindingID)
        XCTAssertNotEqual(acknowledgement.keyID, acknowledgement.deviceBindingID)
    }

    func testAppAttestEnrollmentRecoversExactRequestAfterRestartAndLostResponse() async throws {
        let client = MockDeviceBindingClient(loseFirstRegistrationResponse: true)
        let sharedKeyState = SharedRegistrationKeyState()
        let cacheURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("pending-registration.json")
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }
        let makeVerifier = {
            DynamicDebugEd25519ServerSignatureVerifier {
                await client.verificationKey()
            }
        }
        let firstCoordinator = BirdieDeviceBindingCoordinator(
            client: client,
            registrar: RestartableRegistrationProviderSpy(state: sharedKeyState),
            serverSignatureVerifier: makeVerifier(),
            pendingCache: BirdiePendingRegistrationCache(fileURL: cacheURL)
        )

        do {
            _ = try await firstCoordinator.enroll()
            XCTFail("Erster registrierter Response muss simuliert verloren gehen")
        } catch let error as BirdieTrustError {
            XCTAssertEqual(error, .backendUnavailable)
        }

        let relaunchedCoordinator = BirdieDeviceBindingCoordinator(
            client: client,
            registrar: RestartableRegistrationProviderSpy(state: sharedKeyState),
            serverSignatureVerifier: makeVerifier(),
            pendingCache: BirdiePendingRegistrationCache(fileURL: cacheURL)
        )
        let acknowledgement = try await relaunchedCoordinator.enroll()
        let activation = await sharedKeyState.activation()

        XCTAssertEqual(activation?.keyID, acknowledgement.keyID)
        XCTAssertEqual(activation?.deviceBindingID, acknowledgement.deviceBindingID)
    }

    func testRedApprovalBindsBiometricsNonceIdempotencyAndReceipt() async throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-28T10:00:00Z"))
        let approval = fixture(now: now, risk: .red, actionKind: .deploy)
        let client = ApprovalClientSpy(now: now)
        let authorizer = LocalAuthorizerSpy(now: now)
        let assertionProvider = DeviceAssertionSpy()
        let audit = BirdieLocalAuditTrail(fileURL: nil)
        let coordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: authorizer,
            deviceAssertionProvider: assertionProvider,
            auditTrail: audit,
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )

        let receipt = try await coordinator.decide(approval: approval, decision: .approve)
        let capturedRequest = await client.lastRequest
        let request = try XCTUnwrap(capturedRequest)
        let authorizationCount = await authorizer.callCount
        let auditCount = await audit.snapshot().count

        XCTAssertEqual(authorizationCount, 1)
        XCTAssertEqual(request.localAuthorization.policy, "biometrics_only")
        XCTAssertEqual(request.recordVersion, approval.recordVersion)
        XCTAssertFalse(request.oneTimeNonce.isEmpty)
        XCTAssertTrue(request.idempotencyKey.hasPrefix("approval-"))
        XCTAssertFalse(request.idempotencyKey.contains(approval.approvalID))
        XCTAssertEqual(request.idempotencyKey, receipt.idempotencyKey)
        XCTAssertEqual(receipt.requestDigest, try BirdieCanonicalJSON.sha256Digest(request))
        XCTAssertEqual(auditCount, 1)
    }

    func testGreenRejectionDoesNotPromptForBiometrics() async throws {
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        let approval = fixture(now: now, risk: .green, actionKind: .mail)
        let client = ApprovalClientSpy(now: now)
        let authorizer = LocalAuthorizerSpy(now: now)
        let coordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: authorizer,
            deviceAssertionProvider: DeviceAssertionSpy(),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )

        _ = try await coordinator.decide(approval: approval, decision: .reject)

        let authorizationCount = await authorizer.callCount
        let request = await client.lastRequest
        XCTAssertEqual(authorizationCount, 0)
        XCTAssertEqual(request?.localAuthorization.method, "not_required")
    }

    func testMockServerRejectsDecisionDisallowedByCapabilities() async throws {
        let client = MockApprovalClient(now: Date())
        let pendingApprovals = try await client.fetchPendingApprovals()
        let approval = try XCTUnwrap(
            pendingApprovals.first { !$0.capabilities.canEdit }
        )
        let editedChanges = approval.changes.map {
            ApprovalChange(
                field: $0.field,
                before: $0.before,
                proposed: $0.proposed + " · geändert",
                classification: $0.classification
            )
        }
        let intent = ApprovalIntent(
            decision: .requestChanges,
            editPatch: zip(approval.changes, editedChanges).map { original, edited in
                ApprovalEditOperation(
                    path: "/fields/\(BirdieApprovalValidation.escapedJSONPointerToken(original.field))",
                    operation: "replace",
                    before: original.before,
                    after: edited.proposed,
                    classification: original.classification
                )
            },
            reason: "unit-test"
        )
        let digest = try BirdieApprovalCanonicalizer.actionDigest(
            approval: approval,
            effectiveChanges: editedChanges,
            decision: .requestChanges
        )

        do {
            _ = try await client.fetchChallenge(
                approvalID: approval.approvalID,
                recordVersion: approval.recordVersion,
                intent: intent,
                actionDigest: digest,
                idempotencyKey: "approval-capability-test-001",
                deviceBindingID: LocalMockDeviceIdentity.bindingID
            )
            XCTFail("Server-Mock muss die Capability erneut erzwingen")
        } catch let error as BirdieTrustError {
            guard case .requestRejected = error else {
                return XCTFail("Falscher Fehler: \(error)")
            }
        }
    }

    func testRequestChangesRequiresAnActualEdit() async throws {
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        let approval = fixture(now: now, risk: .amber, actionKind: .publish)
        let coordinator = BirdieApprovalDecisionCoordinator(
            client: ApprovalClientSpy(now: now),
            authorizer: LocalAuthorizerSpy(now: now),
            deviceAssertionProvider: DeviceAssertionSpy(),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )

        do {
            _ = try await coordinator.decide(
                approval: approval,
                decision: .requestChanges,
                editedChanges: approval.changes
            )
            XCTFail("Unveränderte Daten dürfen keinen Änderungsrequest erzeugen")
        } catch let error as BirdieTrustError {
            guard case .invalidContract = error else {
                return XCTFail("Falscher Fehler: \(error)")
            }
        }
    }

    func testReplayProtectorAllowsExactRetryAndRejectsMutation() async throws {
        let protector = BirdieReplayProtector()
        try await protector.reserve(nonce: "one-time", requestDigest: "digest-a")
        try await protector.reserve(nonce: "one-time", requestDigest: "digest-a")

        do {
            try await protector.reserve(nonce: "one-time", requestDigest: "digest-b")
            XCTFail("Veränderte Wiederholung muss fehlschlagen")
        } catch let error as BirdieTrustError {
            XCTAssertEqual(error, .replayDetected)
        }
    }

    func testExpiredApprovalFailsBeforeChallenge() async throws {
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        var approval = fixture(now: now, risk: .red, actionKind: .delete)
        approval = ApprovalItem(
            schemaVersion: approval.schemaVersion,
            approvalID: approval.approvalID,
            recordVersion: approval.recordVersion,
            actionKind: approval.actionKind,
            title: approval.title,
            summary: approval.summary,
            payloadDigest: approval.payloadDigest,
            risk: approval.risk,
            riskReasons: approval.riskReasons,
            irreversible: approval.irreversible,
            requiresInteractiveAuthorization: approval.requiresInteractiveAuthorization,
            target: approval.target,
            changes: approval.changes,
            source: approval.source,
            capabilities: approval.capabilities,
            createdAt: now.addingTimeInterval(-300),
            updatedAt: now.addingTimeInterval(-60),
            expiresAt: now.addingTimeInterval(-1),
            status: .pending
        )
        let client = ApprovalClientSpy(now: now)
        let coordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: LocalAuthorizerSpy(now: now),
            deviceAssertionProvider: DeviceAssertionSpy(),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )

        do {
            _ = try await coordinator.decide(approval: approval, decision: .approve)
            XCTFail("Abgelaufene Freigabe muss fehlschlagen")
        } catch let error as BirdieTrustError {
            XCTAssertEqual(error, .approvalExpired)
        }
        let challengeCount = await client.challengeCount
        XCTAssertEqual(challengeCount, 0)
    }

    func testCanonicalJSONUsesRFC8785ObjectOrderAndEscaping() throws {
        let canonical = try BirdieCanonicalJSON.data([
            "z": "line\nquote\"slash/",
            "a": "first"
        ])
        XCTAssertEqual(
            String(decoding: canonical, as: UTF8.self),
            #"{"a":"first","z":"line\nquote\"slash/"}"#
        )
    }

    func testLostResponseIsRecoveredFromDurableDecisionIdentity() async throws {
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        let approval = fixture(now: now, risk: .red, actionKind: .deploy)
        let client = ApprovalClientSpy(now: now, loseFirstResponse: true)
        let authorizer = LocalAuthorizerSpy(now: now)
        let cacheURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("pending.json")
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }
        let firstCoordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: authorizer,
            deviceAssertionProvider: DeviceAssertionSpy(),
            pendingCache: BirdiePendingDecisionCache(fileURL: cacheURL),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )

        do {
            _ = try await firstCoordinator.decide(approval: approval, decision: .approve)
            XCTFail("Der simulierte erste Response muss verloren gehen")
        } catch let error as BirdieTrustError {
            XCTAssertEqual(error, .backendUnavailable)
        }

        let relaunchedCoordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: authorizer,
            deviceAssertionProvider: DeviceAssertionSpy(),
            pendingCache: BirdiePendingDecisionCache(fileURL: cacheURL),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: TestServerSignatureVerifier(),
            now: { now }
        )
        let recovered = try await relaunchedCoordinator.recoverPendingReceipts()
        let challengeCount = await client.challengeCount
        let authorizationCount = await authorizer.callCount
        let submissionCount = await client.submissionCount

        XCTAssertEqual(recovered.count, 1)
        XCTAssertEqual(challengeCount, 1)
        XCTAssertEqual(authorizationCount, 1)
        XCTAssertEqual(submissionCount, 1)
    }

    func testDebugMockReceiptHasVerifiableEd25519JCSSignature() async throws {
        let now = Date()
        let client = MockApprovalClient(now: now)
        let approvals = try await client.fetchPendingApprovals()
        let approval = try XCTUnwrap(approvals.first)
        let coordinator = BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: LocalAuthorizerSpy(now: now),
            deviceAssertionProvider: LocalMockDeviceAssertionProvider(),
            pendingCache: BirdiePendingDecisionCache(fileURL: nil),
            auditTrail: BirdieLocalAuditTrail(fileURL: nil),
            serverSignatureVerifier: DynamicDebugEd25519ServerSignatureVerifier {
                await client.receiptVerificationKey()
            }
        )

        let receipt = try await coordinator.decide(approval: approval, decision: .reject)
        let verificationKey = await client.receiptVerificationKey()
        let updatedApproval = await client.debugApprovalRecord(
            approvalID: approval.approvalID
        )
        let publicKey = try Curve25519.Signing.PublicKey(
            rawRepresentation: verificationKey.rawRepresentation
        )
        let signature = try XCTUnwrap(Self.decodeBase64URL(receipt.serverSignature.signature))
        let payload = try BirdieCanonicalJSON.data(ApprovalReceiptSigningPayload(receipt: receipt))

        XCTAssertEqual(receipt.serverSignature.format, "raw-ed25519-jcs")
        XCTAssertEqual(receipt.serverSignature.keyID, verificationKey.keyID)
        XCTAssertEqual(updatedApproval?.recordVersion, receipt.recordVersion)
        XCTAssertEqual(updatedApproval?.status, .rejected)
        XCTAssertTrue(publicKey.isValidSignature(signature, for: payload))
    }

    func testApprovalDeepLinkMatchesPushContractAndRejectsExtraData() throws {
        let link = BirdieApprovalDeepLink(approvalID: "apr-test-20260828-001")
        let url = try XCTUnwrap(link.url)

        XCTAssertEqual(url.absoluteString, "birdie://approvals/apr-test-20260828-001")
        XCTAssertEqual(BirdieApprovalDeepLink(url: url), link)
        XCTAssertNil(
            BirdieApprovalDeepLink(
                url: URL(string: "birdie://approvals/apr-test-20260828-001?token=forbidden")!
            )
        )
    }

    private func fixture(
        now: Date,
        risk: ApprovalRisk,
        actionKind: ApprovalActionKind
    ) -> ApprovalItem {
        let target = ApprovalTarget(
            kind: .other,
            displayName: "Exaktes Testziel",
            canonicalIdentifier: "tests/target/001"
        )
        let changes = [
            ApprovalChange(
                field: "state",
                before: "old",
                proposed: "new",
                classification: "internal"
            )
        ]
        guard let payloadDigest = try? BirdieApprovalCanonicalizer.payloadDigest(
            actionKind: actionKind,
            target: target,
            changes: changes
        ) else {
            preconditionFailure("Test payload must canonicalize")
        }
        return ApprovalItem(
            schemaVersion: BirdieTrustSchema.approval,
            approvalID: "apr-test-20260828-001",
            recordVersion: 4,
            actionKind: actionKind,
            title: "Testfreigabe",
            summary: "Nur für Unit-Tests",
            payloadDigest: payloadDigest,
            risk: risk,
            riskReasons: ["Unit-Test-Risiko"],
            irreversible: actionKind == .delete,
            requiresInteractiveAuthorization: risk != .green,
            target: target,
            changes: changes,
            source: ApprovalSource(
                system: "Unit Test",
                workflowID: "wf-test",
                requestedBy: "XCTest",
                correlationID: "corr-test-20260828"
            ),
            capabilities: ApprovalCapabilities(
                canApprove: true,
                canReject: true,
                canEdit: true
            ),
            createdAt: now.addingTimeInterval(-30),
            updatedAt: now.addingTimeInterval(-10),
            expiresAt: now.addingTimeInterval(300),
            status: .pending
        )
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        let standard = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding
        return Data(base64Encoded: standard)
    }
}

private actor ApprovalClientSpy: BirdieApprovalClient {
    private let now: Date
    private let loseFirstResponse: Bool
    private var acceptedReceipt: ApprovalReceipt?
    private(set) var lastRequest: ApprovalDecisionRequest?
    private(set) var challengeCount = 0
    private(set) var submissionCount = 0

    init(now: Date, loseFirstResponse: Bool = false) {
        self.now = now
        self.loseFirstResponse = loseFirstResponse
    }

    func fetchPendingApprovals() async throws -> [ApprovalItem] { [] }

    func fetchChallenge(
        approvalID: String,
        recordVersion: Int,
        intent: ApprovalIntent,
        actionDigest: String,
        idempotencyKey: String,
        deviceBindingID: String
    ) async throws -> ApprovalChallenge {
        challengeCount += 1
        return ApprovalChallenge(
            schemaVersion: BirdieTrustSchema.challenge,
            challengeID: "challenge-test-001",
            resourceType: "approval",
            approvalID: approvalID,
            recordVersion: recordVersion,
            idempotencyKey: idempotencyKey,
            actionDigest: actionDigest,
            oneTimeNonce: BirdieCanonicalJSON.base64URL(Data(repeating: 0xA5, count: 32)),
            deviceBindingID: deviceBindingID,
            issuedAt: now,
            expiresAt: now.addingTimeInterval(90),
            maxAttempts: 1,
            consumed: false
        )
    }

    func submitDecision(_ request: ApprovalDecisionRequest) async throws -> ApprovalReceipt {
        lastRequest = request
        submissionCount += 1
        if let acceptedReceipt {
            let retryDigest = try BirdieCanonicalJSON.sha256Digest(request)
            guard acceptedReceipt.requestDigest == retryDigest else {
                throw BirdieTrustError.replayDetected
            }
            return acceptedReceipt
        }
        let receipt = ApprovalReceipt(
            schemaVersion: BirdieTrustSchema.receipt,
            receiptID: "receipt-test-001",
            decisionID: request.decisionID,
            approvalID: request.approvalID,
            recordVersion: request.recordVersion + 1,
            decision: request.decision,
            outcome: .accepted,
            executionState: .pending,
            idempotencyKey: request.idempotencyKey,
            requestDigest: try BirdieCanonicalJSON.sha256Digest(request),
            recordedAt: now,
            auditEventID: "audit-test-20260828-001",
            auditSequence: 1,
            auditHeadHash: BirdieCanonicalJSON.sha256Digest(Data("audit".utf8)),
            serverSignature: ServerSignature(
                format: "raw-ed25519-jcs",
                algorithm: "EdDSA",
                keyID: "server-test-key",
                canonicalization: "RFC8785",
                signature: BirdieCanonicalJSON.base64URL(Data(repeating: 0x5A, count: 64)),
                signedAt: now
            )
        )
        acceptedReceipt = receipt
        if loseFirstResponse && submissionCount == 1 {
            throw BirdieTrustError.backendUnavailable
        }
        return receipt
    }

    func lookupDecisionReceipt(
        approvalID: String,
        decisionID: String
    ) async throws -> ApprovalReceipt? {
        guard let acceptedReceipt,
              acceptedReceipt.approvalID == approvalID,
              acceptedReceipt.decisionID == decisionID else { return nil }
        return acceptedReceipt
    }
}

private struct TestServerSignatureVerifier: BirdieServerSignatureVerifying {
    func verify(signature: ServerSignature, payload: Data) async throws {
        _ = (signature, payload)
    }
}

private actor RegistrationProviderSpy: BirdieAppAttestRegistering {
    private(set) var activation: (keyID: String, deviceBindingID: String)?
    private let keyID = "opaque.apple/key+id==20260828"

    func beginRegistration() async throws -> String {
        keyID
    }

    func createRegistrationAttestation(
        keyID: String,
        clientDataHash: Data
    ) async throws -> DeviceAttestation {
        let digest = BirdieCanonicalJSON.base64URL(clientDataHash)
        return DeviceAttestation(
            keyID: keyID,
            clientDataHash: digest,
            attestationObject: BirdieCanonicalJSON.base64URL(
                Data("mock-attestation:\(digest)".utf8)
            )
        )
    }

    func activateRegistration(
        afterBackendAcknowledgedKeyID keyID: String,
        deviceBindingID: String
    ) async throws {
        activation = (keyID, deviceBindingID)
    }

    func discardPendingRegistration(keyID: String) async {
        _ = keyID
    }
}

private actor SharedRegistrationKeyState {
    private let keyID = "opaque.apple/restart+key==20260828"
    private var pendingKeyID: String?
    private var activated: (keyID: String, deviceBindingID: String)?

    func begin() -> String {
        pendingKeyID = keyID
        return keyID
    }

    func isPending(_ candidate: String) -> Bool {
        pendingKeyID == candidate
    }

    func activate(keyID: String, deviceBindingID: String) throws {
        guard pendingKeyID == keyID else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        activated = (keyID, deviceBindingID)
        pendingKeyID = nil
    }

    func discard(keyID: String) {
        if pendingKeyID == keyID { pendingKeyID = nil }
    }

    func activation() -> (keyID: String, deviceBindingID: String)? {
        activated
    }
}

private struct RestartableRegistrationProviderSpy: BirdieAppAttestRegistering {
    let state: SharedRegistrationKeyState

    func beginRegistration() async throws -> String {
        await state.begin()
    }

    func createRegistrationAttestation(
        keyID: String,
        clientDataHash: Data
    ) async throws -> DeviceAttestation {
        guard await state.isPending(keyID) else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        let digest = BirdieCanonicalJSON.base64URL(clientDataHash)
        return DeviceAttestation(
            keyID: keyID,
            clientDataHash: digest,
            attestationObject: BirdieCanonicalJSON.base64URL(
                Data("mock-attestation:\(digest)".utf8)
            )
        )
    }

    func activateRegistration(
        afterBackendAcknowledgedKeyID keyID: String,
        deviceBindingID: String
    ) async throws {
        try await state.activate(keyID: keyID, deviceBindingID: deviceBindingID)
    }

    func discardPendingRegistration(keyID: String) async {
        await state.discard(keyID: keyID)
    }
}

private actor LocalAuthorizerSpy: BirdieLocalAuthorizing {
    private let now: Date
    private(set) var callCount = 0

    init(now: Date) {
        self.now = now
    }

    func authorize(reason: String, contextDigest: String) async throws -> LocalAuthorizationEvidence {
        callCount += 1
        return LocalAuthorizationEvidence(
            method: "face_id",
            policy: "biometrics_only",
            success: true,
            evaluatedAt: now,
            contextDigest: contextDigest
        )
    }
}

private actor DeviceAssertionSpy: BirdieDeviceAssertionProviding {
    func bindingID() async throws -> String {
        "device-test-20260828-001"
    }

    func assertion(for clientDataHash: Data) async throws -> DeviceAssertion {
        DeviceAssertion(
            provider: "test",
            keyID: "opaque-apple-key-test-20260828-001",
            clientDataHash: BirdieCanonicalJSON.base64URL(clientDataHash),
            assertionObject: BirdieCanonicalJSON.base64URL(Data(repeating: 0xC3, count: 32))
        )
    }
}
