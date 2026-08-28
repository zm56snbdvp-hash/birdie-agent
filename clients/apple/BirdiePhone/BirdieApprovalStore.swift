import Combine
import CryptoKit
import Foundation

struct BirdieLocalAuditEntry: Codable, Hashable, Identifiable, Sendable {
    let schemaVersion: String
    let entryID: String
    let occurredAt: Date
    let event: String
    let approvalID: String
    let recordVersion: Int
    let decision: ApprovalDecision
    let actionDigest: String
    let nonceDigest: String
    let idempotencyKey: String
    let receiptID: String
    let serverAuditEventID: String
    let previousEntryHash: String?
    let entryHash: String

    var id: String { entryID }

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case entryID = "entryId"
        case occurredAt
        case event
        case approvalID = "approvalId"
        case recordVersion
        case decision
        case actionDigest
        case nonceDigest
        case idempotencyKey
        case receiptID = "receiptId"
        case serverAuditEventID = "serverAuditEventId"
        case previousEntryHash
        case entryHash
    }
}

actor BirdieLocalAuditTrail {
    private struct UnsignedEntry: Codable {
        let schemaVersion: String
        let entryID: String
        let occurredAt: Date
        let event: String
        let approvalID: String
        let recordVersion: Int
        let decision: ApprovalDecision
        let actionDigest: String
        let nonceDigest: String
        let idempotencyKey: String
        let receiptID: String
        let serverAuditEventID: String
        let previousEntryHash: String?
    }

    private let fileURL: URL?
    private var entries: [BirdieLocalAuditEntry]

    init() {
        let fileURL = BirdieLocalAuditTrail.defaultURL()
        self.fileURL = fileURL
        entries = BirdieLocalAuditTrail.loadEntries(from: fileURL)
    }

    init(fileURL: URL?) {
        self.fileURL = fileURL
        entries = BirdieLocalAuditTrail.loadEntries(from: fileURL)
    }

    func append(receipt: ApprovalReceipt, request: ApprovalDecisionRequest) throws {
        if let existing = entries.first(where: { $0.idempotencyKey == receipt.idempotencyKey }) {
            guard existing.receiptID == receipt.receiptID,
                  existing.approvalID == receipt.approvalID,
                  existing.decision == receipt.decision,
                  existing.actionDigest == request.actionDigest else {
                throw BirdieTrustError.replayDetected
            }
            try persist(entries)
            return
        }
        let previousHash = entries.last?.entryHash
        let unsigned = UnsignedEntry(
            schemaVersion: BirdieTrustSchema.audit,
            entryID: UUID().uuidString.lowercased(),
            occurredAt: Date(),
            event: "approval_decision_receipt_recorded",
            approvalID: receipt.approvalID,
            recordVersion: receipt.recordVersion,
            decision: receipt.decision,
            actionDigest: request.actionDigest,
            nonceDigest: BirdieCanonicalJSON.sha256Digest(Data(request.oneTimeNonce.utf8)),
            idempotencyKey: receipt.idempotencyKey,
            receiptID: receipt.receiptID,
            serverAuditEventID: receipt.auditEventID,
            previousEntryHash: previousHash
        )
        let entry = BirdieLocalAuditEntry(
            schemaVersion: unsigned.schemaVersion,
            entryID: unsigned.entryID,
            occurredAt: unsigned.occurredAt,
            event: unsigned.event,
            approvalID: unsigned.approvalID,
            recordVersion: unsigned.recordVersion,
            decision: unsigned.decision,
            actionDigest: unsigned.actionDigest,
            nonceDigest: unsigned.nonceDigest,
            idempotencyKey: unsigned.idempotencyKey,
            receiptID: unsigned.receiptID,
            serverAuditEventID: unsigned.serverAuditEventID,
            previousEntryHash: unsigned.previousEntryHash,
            entryHash: try BirdieCanonicalJSON.sha256Hex(unsigned)
        )
        let nextEntries = entries + [entry]
        try persist(nextEntries)
        entries = nextEntries
    }

    func snapshot() -> [BirdieLocalAuditEntry] { entries }

    private func persist(_ entries: [BirdieLocalAuditEntry]) throws {
        guard let fileURL else { return }
        let manager = FileManager.default
        try manager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(entries)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func defaultURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("BirdieTrust", isDirectory: true)
            .appendingPathComponent("approval-audit-v1.json", isDirectory: false)
    }

    private static func loadEntries(from fileURL: URL?) -> [BirdieLocalAuditEntry] {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? makeDecoder().decode([BirdieLocalAuditEntry].self, from: data)
        else { return [] }
        return decoded
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

actor BirdiePendingDecisionCache {
    struct PendingDecision: Codable, Sendable {
        let intentKey: String
        let request: ApprovalDecisionRequest
        let expiresAt: Date
        let storedAt: Date
    }

    private let fileURL: URL?
    private var requests: [String: PendingDecision]

    init() {
        let fileURL = Self.defaultURL()
        self.fileURL = fileURL
        requests = Self.load(from: fileURL)
    }

    init(fileURL: URL?) {
        self.fileURL = fileURL
        requests = Self.load(from: fileURL)
    }

    func request(for intentKey: String) -> PendingDecision? {
        requests[intentKey]
    }

    func snapshot() -> [PendingDecision] {
        Array(requests.values)
    }

    func store(
        _ request: ApprovalDecisionRequest,
        intentKey: String,
        expiresAt: Date,
        storedAt: Date
    ) throws {
        var nextRequests = requests
        nextRequests[intentKey] = PendingDecision(
            intentKey: intentKey,
            request: request,
            expiresAt: expiresAt,
            storedAt: storedAt
        )
        try persist(nextRequests)
        requests = nextRequests
    }

    func clear(intentKey: String) throws {
        var nextRequests = requests
        nextRequests.removeValue(forKey: intentKey)
        try persist(nextRequests)
        requests = nextRequests
    }

    private func persist(_ requests: [String: PendingDecision]) throws {
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
            .appendingPathComponent("pending-approval-decisions-v1.json", isDirectory: false)
    }

    private static func load(from fileURL: URL?) -> [String: PendingDecision] {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let values = try? makeDecoder().decode([PendingDecision].self, from: data)
        else { return [:] }
        return Dictionary(values.map { ($0.intentKey, $0) }, uniquingKeysWith: { first, _ in first })
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

final class BirdieApprovalDecisionCoordinator {
    private let client: any BirdieApprovalClient
    private let authorizer: any BirdieLocalAuthorizing
    private let deviceAssertionProvider: any BirdieDeviceAssertionProviding
    private let replayProtector: BirdieReplayProtector
    private let pendingCache: BirdiePendingDecisionCache
    private let auditTrail: BirdieLocalAuditTrail
    private let serverSignatureVerifier: any BirdieServerSignatureVerifying
    private let now: @Sendable () -> Date

    init(
        client: any BirdieApprovalClient,
        authorizer: any BirdieLocalAuthorizing,
        deviceAssertionProvider: any BirdieDeviceAssertionProviding,
        replayProtector: BirdieReplayProtector = BirdieReplayProtector(),
        pendingCache: BirdiePendingDecisionCache = BirdiePendingDecisionCache(fileURL: nil),
        auditTrail: BirdieLocalAuditTrail = BirdieLocalAuditTrail(),
        serverSignatureVerifier: any BirdieServerSignatureVerifying =
            UnconfiguredServerSignatureVerifier(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.client = client
        self.authorizer = authorizer
        self.deviceAssertionProvider = deviceAssertionProvider
        self.replayProtector = replayProtector
        self.pendingCache = pendingCache
        self.auditTrail = auditTrail
        self.serverSignatureVerifier = serverSignatureVerifier
        self.now = now
    }

    func decide(
        approval: ApprovalItem,
        decision: ApprovalDecision,
        editedChanges: [ApprovalChange]? = nil
    ) async throws -> ApprovalReceipt {
        try BirdieApprovalValidation.validate(approval)
        guard approval.status == .pending else {
            throw BirdieTrustError.invalidContract("Approval ist nicht im erwarteten Zustand.")
        }
        guard approval.expiresAt > now() else { throw BirdieTrustError.approvalExpired }
        let decisionAllowed = switch decision {
        case .approve: approval.capabilities.canApprove
        case .reject: approval.capabilities.canReject
        case .requestChanges: approval.capabilities.canEdit
        }
        guard decisionAllowed else {
            throw BirdieTrustError.requestRejected("Diese Entscheidung ist für die Freigabe nicht erlaubt.")
        }

        let effectiveChanges: [ApprovalChange]
        if decision == .requestChanges {
            guard let editedChanges,
                  !editedChanges.isEmpty,
                  editedChanges != approval.changes,
                  editedChanges.count == approval.changes.count,
                  zip(editedChanges, approval.changes).allSatisfy({ edited, original in
                      edited.field == original.field
                          && edited.before == original.before
                          && edited.classification == original.classification
                          && edited.proposed.count <= 20_000
                  })
            else {
                throw BirdieTrustError.invalidContract(
                    "Nur die angezeigten neuen Feldwerte dürfen geändert werden."
                )
            }
            effectiveChanges = editedChanges
        } else {
            guard editedChanges == nil else {
                throw BirdieTrustError.invalidContract(
                    "Bearbeitete Daten müssen zuerst als Änderungswunsch zurückgesendet werden."
                )
            }
            effectiveChanges = approval.changes
        }

        let editPatch: [ApprovalEditOperation]? = decision == .requestChanges
            ? effectiveChanges.map {
                ApprovalEditOperation(
                    path: "/fields/\(BirdieApprovalValidation.escapedJSONPointerToken($0.field))",
                    operation: "replace",
                    before: $0.before,
                    after: $0.proposed,
                    classification: $0.classification
                )
            }
            : nil
        let intent = ApprovalIntent(
            decision: decision,
            editPatch: editPatch,
            reason: decision == .requestChanges ? "edited_in_birdie_approve" : nil
        )
        let actionDigest = try BirdieApprovalCanonicalizer.actionDigest(
            approval: approval,
            effectiveChanges: effectiveChanges,
            decision: decision
        )
        let intentKey = actionDigest
        let cachedDecision = await pendingCache.request(for: intentKey)
        let idempotencyKey = cachedDecision?.request.idempotencyKey
            ?? "approval-\(UUID().uuidString.lowercased())"

        let request: ApprovalDecisionRequest
        if let cached = cachedDecision {
            request = cached.request
        } else {
            let deviceBindingID = try await deviceAssertionProvider.bindingID()
            let challenge = try await client.fetchChallenge(
                approvalID: approval.approvalID,
                recordVersion: approval.recordVersion,
                intent: intent,
                actionDigest: actionDigest,
                idempotencyKey: idempotencyKey,
                deviceBindingID: deviceBindingID
            )
            try validate(
                challenge: challenge,
                approval: approval,
                actionDigest: actionDigest,
                idempotencyKey: idempotencyKey,
                deviceBindingID: deviceBindingID
            )

            let authorizationContext = actionDigest
            let localAuthorization: LocalAuthorizationEvidence
            if approval.requiresLocalAuthentication(for: decision) {
                localAuthorization = try await authorizer.authorize(
                    reason: "\(approval.actionKind.title) für \(approval.target.displayName) genehmigen",
                    contextDigest: authorizationContext
                )
            } else {
                localAuthorization = LocalAuthorizationEvidence(
                    method: "not_required",
                    policy: "low_risk_only",
                    success: true,
                    evaluatedAt: now(),
                    contextDigest: authorizationContext
                )
            }
            guard challenge.expiresAt > now() else { throw BirdieTrustError.approvalExpired }

            let decisionID = UUID().uuidString.lowercased()
            let clientDecidedAt = now()
            let assertionPayload = ApprovalAssertionPayload(
                schemaVersion: BirdieTrustSchema.decision,
                decisionID: decisionID,
                approvalID: approval.approvalID,
                recordVersion: approval.recordVersion,
                idempotencyKey: idempotencyKey,
                challengeID: challenge.challengeID,
                oneTimeNonce: challenge.oneTimeNonce,
                actionDigest: actionDigest,
                deviceBindingID: deviceBindingID,
                localAuthorization: localAuthorization,
                intent: intent,
                clientDecidedAt: clientDecidedAt
            )
            let assertionPayloadData = try BirdieCanonicalJSON.data(assertionPayload)
            let clientDataHash = Data(SHA256.hash(data: assertionPayloadData))
            let deviceAssertion = try await deviceAssertionProvider.assertion(for: clientDataHash)
            guard deviceAssertion.clientDataHash == BirdieCanonicalJSON.base64URL(clientDataHash),
                  !deviceAssertion.keyID.isEmpty,
                  deviceAssertion.keyID.count <= 1_024
            else {
                throw BirdieTrustError.invalidContract("Geräteassertion enthält den falschen Payload-Hash.")
            }

            request = ApprovalDecisionRequest(
                schemaVersion: assertionPayload.schemaVersion,
                decisionID: assertionPayload.decisionID,
                approvalID: assertionPayload.approvalID,
                recordVersion: assertionPayload.recordVersion,
                idempotencyKey: assertionPayload.idempotencyKey,
                challengeID: assertionPayload.challengeID,
                oneTimeNonce: assertionPayload.oneTimeNonce,
                actionDigest: assertionPayload.actionDigest,
                deviceBindingID: assertionPayload.deviceBindingID,
                deviceAssertion: deviceAssertion,
                localAuthorization: assertionPayload.localAuthorization,
                intent: assertionPayload.intent,
                clientDecidedAt: assertionPayload.clientDecidedAt
            )
            try await pendingCache.store(
                request,
                intentKey: intentKey,
                expiresAt: challenge.expiresAt,
                storedAt: now()
            )
        }

        try validateAssertionBinding(request: request)
        let outboundRequestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        try await replayProtector.reserve(
            nonce: request.oneTimeNonce,
            requestDigest: outboundRequestDigest
        )

        do {
            let receipt = try await client.submitDecision(request)
            try await validate(receipt: receipt, request: request)
            try await auditTrail.append(receipt: receipt, request: request)
            try await pendingCache.clear(intentKey: intentKey)
            return receipt
        } catch let error as BirdieTrustError {
            if error == .approvalExpired || error == .approvalChanged {
                try? await pendingCache.clear(intentKey: intentKey)
            }
            throw error
        }
    }

    /// Reconciles signed requests whose server response may have been lost. The
    /// backend lookup is authoritative; an unreachable backend leaves the local
    /// request intact so the exact assertion/idempotency tuple can be retried.
    func recoverPendingReceipts() async throws -> [ApprovalReceipt] {
        var recovered: [ApprovalReceipt] = []
        for pending in await pendingCache.snapshot() {
            if let receipt = try await client.lookupDecisionReceipt(
                approvalID: pending.request.approvalID,
                decisionID: pending.request.decisionID
            ) {
                try await validate(receipt: receipt, request: pending.request)
                try await auditTrail.append(receipt: receipt, request: pending.request)
                try await pendingCache.clear(intentKey: pending.intentKey)
                recovered.append(receipt)
            } else if pending.expiresAt <= now() {
                // A definitive 404 after challenge expiry means the mutation was
                // never committed. A new foreground decision gets a new key.
                try await pendingCache.clear(intentKey: pending.intentKey)
            }
        }
        return recovered
    }

    private func validateAssertionBinding(request: ApprovalDecisionRequest) throws {
        let assertionPayload = ApprovalAssertionPayload(
            schemaVersion: request.schemaVersion,
            decisionID: request.decisionID,
            approvalID: request.approvalID,
            recordVersion: request.recordVersion,
            idempotencyKey: request.idempotencyKey,
            challengeID: request.challengeID,
            oneTimeNonce: request.oneTimeNonce,
            actionDigest: request.actionDigest,
            deviceBindingID: request.deviceBindingID,
            localAuthorization: request.localAuthorization,
            intent: request.intent,
            clientDecidedAt: request.clientDecidedAt
        )
        let expectedHash = Data(
            SHA256.hash(data: try BirdieCanonicalJSON.data(assertionPayload))
        )
        let allowedProvider: Bool = {
            #if DEBUG
            ["app_attest", "local_mock_only", "test"].contains(request.deviceAssertion.provider)
            #else
            request.deviceAssertion.provider == "app_attest"
            #endif
        }()
        guard request.schemaVersion == BirdieTrustSchema.decision,
              BirdieApprovalValidation.isOpaqueIdentifier(request.decisionID),
              BirdieApprovalValidation.isOpaqueIdentifier(request.approvalID),
              request.recordVersion >= 1,
              BirdieApprovalValidation.isOpaqueIdentifier(request.challengeID),
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
              !request.deviceAssertion.keyID.isEmpty,
              request.deviceAssertion.keyID.count <= 1_024,
              request.deviceAssertion.clientDataHash == BirdieCanonicalJSON.base64URL(expectedHash),
              BirdieCanonicalJSON.validBase64URL(
                  request.deviceAssertion.assertionObject,
                  minimumDecodedBytes: 16,
                  encodedLength: 16 ... 8_192
              ),
              request.localAuthorization.success,
              ["biometrics_only", "device_owner_authentication", "low_risk_only"]
                  .contains(request.localAuthorization.policy)
        else {
            throw BirdieTrustError.invalidContract(
                "Persistierter Request oder Geräteassertion ist nicht exakt gebunden."
            )
        }
    }

    private func validate(
        challenge: ApprovalChallenge,
        approval: ApprovalItem,
        actionDigest: String,
        idempotencyKey: String,
        deviceBindingID: String
    ) throws {
        let current = now()
        guard challenge.schemaVersion == BirdieTrustSchema.challenge,
              challenge.approvalID == approval.approvalID,
              challenge.recordVersion == approval.recordVersion,
              challenge.resourceType == "approval",
              challenge.idempotencyKey == idempotencyKey,
              challenge.actionDigest == actionDigest,
              challenge.deviceBindingID == deviceBindingID,
              !challenge.challengeID.isEmpty,
              BirdieCanonicalJSON.validBase64URL(
                  challenge.oneTimeNonce,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 128
              ),
              challenge.maxAttempts == 1,
              challenge.consumed == false
        else {
            throw BirdieTrustError.invalidContract("Challenge ist nicht exakt an die Freigabe gebunden.")
        }
        guard challenge.issuedAt <= current.addingTimeInterval(5),
              challenge.expiresAt > current,
              challenge.expiresAt <= challenge.issuedAt.addingTimeInterval(120),
              challenge.expiresAt <= approval.expiresAt
        else {
            throw BirdieTrustError.approvalExpired
        }
    }

    private func validate(
        receipt: ApprovalReceipt,
        request: ApprovalDecisionRequest
    ) async throws {
        let expectedRequestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        guard receipt.schemaVersion == BirdieTrustSchema.receipt,
              receipt.decisionID == request.decisionID,
              receipt.approvalID == request.approvalID,
              receipt.recordVersion == request.recordVersion + 1,
              receipt.decision == request.decision,
              receipt.idempotencyKey == request.idempotencyKey,
              receipt.requestDigest == expectedRequestDigest,
              BirdieApprovalValidation.isOpaqueIdentifier(receipt.receiptID),
              BirdieApprovalValidation.isOpaqueIdentifier(receipt.decisionID),
              BirdieApprovalValidation.isOpaqueIdentifier(receipt.approvalID),
              BirdieApprovalValidation.isOpaqueIdentifier(receipt.auditEventID),
              receipt.auditSequence > 0,
              BirdieCanonicalJSON.validBase64URL(
                  receipt.auditHeadHash,
                  minimumDecodedBytes: 32,
                  encodedLength: 43 ... 43
              ),
              receipt.serverSignature.format == "raw-ed25519-jcs",
              receipt.serverSignature.algorithm == "EdDSA",
              !receipt.serverSignature.keyID.isEmpty,
              receipt.serverSignature.canonicalization == "RFC8785",
              BirdieCanonicalJSON.validBase64URL(
                  receipt.serverSignature.signature,
                  minimumDecodedBytes: 64,
                  encodedLength: 86 ... 86
              ),
              receipt.recordedAt >= request.clientDecidedAt.addingTimeInterval(-5),
              receipt.serverSignature.signedAt >= receipt.recordedAt.addingTimeInterval(-5)
        else {
            throw BirdieTrustError.invalidContract("Receipt ist unvollständig oder anders gebunden.")
        }
        try await serverSignatureVerifier.verify(
            signature: receipt.serverSignature,
            payload: BirdieCanonicalJSON.data(ApprovalReceiptSigningPayload(receipt: receipt))
        )
    }
}

@MainActor
final class BirdieApprovalStore: ObservableObject {
    @Published private(set) var approvals: [ApprovalItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var activeApprovalIDs: Set<String> = []
    @Published private(set) var lastReceipt: ApprovalReceipt?
    @Published var errorMessage: String?

    private let client: any BirdieApprovalClient
    private let coordinator: BirdieApprovalDecisionCoordinator

    init(
        client: (any BirdieApprovalClient)? = nil,
        coordinator: BirdieApprovalDecisionCoordinator? = nil
    ) {
        let resolvedClient = client ?? BirdieApprovalDependencies.makeClient()
        self.client = resolvedClient
        self.coordinator = coordinator ?? BirdieApprovalDependencies.makeCoordinator(
            client: resolvedClient
        )
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            if let recovered = try await coordinator.recoverPendingReceipts().last {
                lastReceipt = recovered
            }
            let fetched = try await client.fetchPendingApprovals()
            try fetched.forEach(BirdieApprovalValidation.validate)
            approvals = fetched
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func decide(
        approval: ApprovalItem,
        decision: ApprovalDecision,
        editedChanges: [ApprovalChange]? = nil
    ) async -> ApprovalReceipt? {
        guard !activeApprovalIDs.contains(approval.id) else { return nil }
        activeApprovalIDs.insert(approval.id)
        defer { activeApprovalIDs.remove(approval.id) }
        do {
            let receipt = try await coordinator.decide(
                approval: approval,
                decision: decision,
                editedChanges: editedChanges
            )
            lastReceipt = receipt
            errorMessage = nil
            await refresh()
            return receipt
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}

private enum BirdieApprovalDependencies {
    static func makeClient() -> any BirdieApprovalClient {
        #if DEBUG
        MockApprovalClient()
        #else
        UnavailableApprovalClient()
        #endif
    }

    static func makeCoordinator(
        client: any BirdieApprovalClient
    ) -> BirdieApprovalDecisionCoordinator {
        #if DEBUG
        let assertionProvider: any BirdieDeviceAssertionProviding = LocalMockDeviceAssertionProvider()
        let pendingCache = BirdiePendingDecisionCache(fileURL: nil)
        let signatureVerifier: any BirdieServerSignatureVerifying
        if let mockClient = client as? MockApprovalClient {
            signatureVerifier = DynamicDebugEd25519ServerSignatureVerifier {
                await mockClient.receiptVerificationKey()
            }
        } else {
            signatureVerifier = UnconfiguredServerSignatureVerifier()
        }
        #else
        let assertionProvider: any BirdieDeviceAssertionProviding = AppAttestDeviceAssertionProvider()
        let pendingCache = BirdiePendingDecisionCache()
        let signatureVerifier: any BirdieServerSignatureVerifying =
            UnconfiguredServerSignatureVerifier()
        #endif
        return BirdieApprovalDecisionCoordinator(
            client: client,
            authorizer: BiometricLocalAuthorizer(),
            deviceAssertionProvider: assertionProvider,
            pendingCache: pendingCache,
            serverSignatureVerifier: signatureVerifier
        )
    }
}
