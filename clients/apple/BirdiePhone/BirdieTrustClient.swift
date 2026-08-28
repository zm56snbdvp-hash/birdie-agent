import CryptoKit
import Foundation
import Security

protocol BirdieApprovalClient: Sendable {
    func fetchPendingApprovals() async throws -> [ApprovalItem]
    func fetchChallenge(
        approvalID: String,
        recordVersion: Int,
        intent: ApprovalIntent,
        actionDigest: String,
        idempotencyKey: String,
        deviceBindingID: String
    ) async throws -> ApprovalChallenge
    func submitDecision(_ request: ApprovalDecisionRequest) async throws -> ApprovalReceipt
    func lookupDecisionReceipt(
        approvalID: String,
        decisionID: String
    ) async throws -> ApprovalReceipt?
}

struct UnavailableApprovalClient: BirdieApprovalClient {
    func fetchPendingApprovals() async throws -> [ApprovalItem] {
        throw BirdieTrustError.backendUnavailable
    }

    func fetchChallenge(
        approvalID: String,
        recordVersion: Int,
        intent: ApprovalIntent,
        actionDigest: String,
        idempotencyKey: String,
        deviceBindingID: String
    ) async throws -> ApprovalChallenge {
        throw BirdieTrustError.backendUnavailable
    }

    func submitDecision(_ request: ApprovalDecisionRequest) async throws -> ApprovalReceipt {
        throw BirdieTrustError.backendUnavailable
    }

    func lookupDecisionReceipt(
        approvalID: String,
        decisionID: String
    ) async throws -> ApprovalReceipt? {
        throw BirdieTrustError.backendUnavailable
    }
}

#if DEBUG
actor MockApprovalClient: BirdieApprovalClient {
    private struct CachedReceipt {
        let requestDigest: String
        let receipt: ApprovalReceipt
    }

    private var approvals: [ApprovalItem]
    private var challenges: [String: ApprovalChallenge] = [:]
    private var nonceReservations: [String: String] = [:]
    private var receiptsByIdempotencyKey: [String: CachedReceipt] = [:]
    private var auditSequence = 0
    private let receiptSigningKey: Curve25519.Signing.PrivateKey
    private let receiptSigningKeyID: String

    init(now: Date = Date()) {
        let signingKey = Curve25519.Signing.PrivateKey()
        receiptSigningKey = signingKey
        receiptSigningKeyID = "debug-ed25519-\(BirdieCanonicalJSON.sha256Digest(signingKey.publicKey.rawRepresentation))"
        approvals = Self.fixtures(now: now)
    }

    func fetchPendingApprovals() async throws -> [ApprovalItem] {
        let now = Date()
        for index in approvals.indices where approvals[index].status == .pending {
            if approvals[index].expiresAt <= now {
                approvals[index].status = .expired
            }
        }
        return approvals
            .filter { $0.status == .pending }
            .sorted { lhs, rhs in
                if lhs.risk != rhs.risk {
                    return Self.riskRank(lhs.risk) > Self.riskRank(rhs.risk)
                }
                return lhs.expiresAt < rhs.expiresAt
            }
    }

    func fetchChallenge(
        approvalID: String,
        recordVersion: Int,
        intent: ApprovalIntent,
        actionDigest: String,
        idempotencyKey: String,
        deviceBindingID: String
    ) async throws -> ApprovalChallenge {
        guard let approval = approvals.first(where: { $0.approvalID == approvalID }) else {
            throw BirdieTrustError.requestRejected("Die Freigabe existiert nicht mehr.")
        }
        guard approval.recordVersion == recordVersion else {
            throw BirdieTrustError.approvalChanged
        }
        guard approval.status == .pending, approval.expiresAt > Date() else {
            throw BirdieTrustError.approvalExpired
        }
        try Self.validateCapability(for: intent.decision, approval: approval)
        let effectiveChanges = try Self.effectiveChanges(for: intent, approval: approval)
        let expectedActionDigest = try BirdieApprovalCanonicalizer.actionDigest(
            approval: approval,
            effectiveChanges: effectiveChanges,
            decision: intent.decision
        )
        guard expectedActionDigest == actionDigest else {
            throw BirdieTrustError.invalidContract("Aktions-Digest passt nicht zur sichtbaren Änderung.")
        }
        if let existing = challenges.values.first(where: { $0.idempotencyKey == idempotencyKey }) {
            guard existing.approvalID == approvalID,
                  existing.recordVersion == recordVersion,
                  existing.actionDigest == actionDigest,
                  existing.deviceBindingID == deviceBindingID else {
                throw BirdieTrustError.replayDetected
            }
            return existing
        }
        let issuedAt = Date()
        let challenge = ApprovalChallenge(
            schemaVersion: BirdieTrustSchema.challenge,
            challengeID: UUID().uuidString.lowercased(),
            resourceType: "approval",
            approvalID: approvalID,
            recordVersion: recordVersion,
            idempotencyKey: idempotencyKey,
            actionDigest: actionDigest,
            oneTimeNonce: Self.randomNonce(),
            deviceBindingID: deviceBindingID,
            issuedAt: issuedAt,
            expiresAt: min(approval.expiresAt, issuedAt.addingTimeInterval(90)),
            maxAttempts: 1,
            consumed: false
        )
        challenges[challenge.challengeID] = challenge
        return challenge
    }

    func submitDecision(_ request: ApprovalDecisionRequest) async throws -> ApprovalReceipt {
        let requestDigest = try BirdieCanonicalJSON.sha256Digest(request)
        if let cached = receiptsByIdempotencyKey[request.idempotencyKey] {
            guard cached.requestDigest == requestDigest else {
                throw BirdieTrustError.replayDetected
            }
            return cached.receipt
        }

        guard request.schemaVersion == BirdieTrustSchema.decision,
              let challenge = challenges[request.challengeID],
              challenge.approvalID == request.approvalID,
              challenge.recordVersion == request.recordVersion,
              challenge.idempotencyKey == request.idempotencyKey,
              challenge.actionDigest == request.actionDigest,
              challenge.oneTimeNonce == request.oneTimeNonce,
              challenge.deviceBindingID == request.deviceBindingID,
              challenge.maxAttempts == 1,
              challenge.consumed == false
        else {
            throw BirdieTrustError.invalidContract("Challenge und Entscheidung stimmen nicht überein.")
        }
        guard challenge.expiresAt > Date() else { throw BirdieTrustError.approvalExpired }

        if let existing = nonceReservations[request.oneTimeNonce], existing != requestDigest {
            throw BirdieTrustError.replayDetected
        }
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
        let expectedClientDataHash = SHA256.hash(data: try BirdieCanonicalJSON.data(assertionPayload))
        let expectedClientDigest = BirdieCanonicalJSON.base64URL(Data(expectedClientDataHash))
        guard request.deviceAssertion.clientDataHash == expectedClientDigest,
              request.deviceAssertion.provider == "local_mock_only",
              request.deviceBindingID == LocalMockDeviceIdentity.bindingID,
              request.deviceAssertion.keyID == LocalMockDeviceIdentity.keyID,
              request.deviceAssertion.assertionObject == BirdieCanonicalJSON.base64URL(
                  Data("mock:\(expectedClientDigest)".utf8)
              )
        else {
            throw BirdieTrustError.invalidContract("Geräteassertion ist nicht an die Entscheidung gebunden.")
        }

        guard let approvalIndex = approvals.firstIndex(where: { $0.approvalID == request.approvalID }),
              approvals[approvalIndex].recordVersion == request.recordVersion,
              approvals[approvalIndex].status == .pending
        else {
            throw BirdieTrustError.approvalChanged
        }
        let approval = approvals[approvalIndex]
        try Self.validateCapability(for: request.decision, approval: approval)
        let effectiveChanges = try Self.effectiveChanges(for: request.intent, approval: approval)
        let expectedActionDigest = try BirdieApprovalCanonicalizer.actionDigest(
            approval: approval,
            effectiveChanges: effectiveChanges,
            decision: request.decision
        )
        guard expectedActionDigest == request.actionDigest,
              request.localAuthorization.success,
              request.localAuthorization.contextDigest == request.actionDigest,
              request.localAuthorization.evaluatedAt >= challenge.issuedAt.addingTimeInterval(-5),
              request.localAuthorization.evaluatedAt <= Date().addingTimeInterval(5),
              Date().timeIntervalSince(request.localAuthorization.evaluatedAt) <= 120 else {
            throw BirdieTrustError.authenticationFailed
        }
        if approval.requiresLocalAuthentication(for: request.decision) {
            guard ["face_id", "touch_id"].contains(request.localAuthorization.method),
                  request.localAuthorization.policy == "biometrics_only" else {
                throw BirdieTrustError.authenticationFailed
            }
        } else {
            guard request.localAuthorization.method == "not_required",
                  request.localAuthorization.policy == "low_risk_only" else {
                throw BirdieTrustError.authenticationFailed
            }
        }

        let nextStatus: ApprovalStatus
        switch request.decision {
        case .approve:
            nextStatus = .approved
        case .reject:
            nextStatus = .rejected
        case .requestChanges:
            guard let edits = request.intent.editPatch, !edits.isEmpty else {
                throw BirdieTrustError.invalidContract("Bearbeitete Felder fehlen.")
            }
            nextStatus = .changesRequested
        }

        let nextAuditSequence = auditSequence + 1
        let decidedAt = Date()
        let receiptID = "debug-receipt-\(UUID().uuidString.lowercased())"
        let auditHeadHash = BirdieCanonicalJSON.sha256Digest(Data([
            requestDigest,
            receiptID,
            String(nextAuditSequence)
        ].joined(separator: ":").utf8))
        func makeReceipt(serverSignature: ServerSignature) -> ApprovalReceipt {
            ApprovalReceipt(
                schemaVersion: BirdieTrustSchema.receipt,
                receiptID: receiptID,
                decisionID: request.decisionID,
                approvalID: request.approvalID,
                recordVersion: request.recordVersion + 1,
                decision: request.decision,
                outcome: .accepted,
                executionState: request.decision == .approve ? .pending : .notApplicable,
                idempotencyKey: request.idempotencyKey,
                requestDigest: requestDigest,
                recordedAt: decidedAt,
                auditEventID: "debug-audit-event-\(nextAuditSequence)",
                auditSequence: nextAuditSequence,
                auditHeadHash: auditHeadHash,
                serverSignature: serverSignature
            )
        }
        let placeholder = ServerSignature(
            format: "raw-ed25519-jcs",
            algorithm: "EdDSA",
            keyID: receiptSigningKeyID,
            canonicalization: "RFC8785",
            signature: BirdieCanonicalJSON.base64URL(Data(repeating: 0, count: 64)),
            signedAt: decidedAt
        )
        let unsignedReceipt = makeReceipt(serverSignature: placeholder)
        let signingPayload = try BirdieCanonicalJSON.data(
            ApprovalReceiptSigningPayload(receipt: unsignedReceipt)
        )
        let signature = try receiptSigningKey.signature(for: signingPayload)
        let receipt = makeReceipt(
            serverSignature: ServerSignature(
                format: "raw-ed25519-jcs",
                algorithm: "EdDSA",
                keyID: receiptSigningKeyID,
                canonicalization: "RFC8785",
                signature: BirdieCanonicalJSON.base64URL(signature),
                signedAt: decidedAt
            )
        )
        let cachedReceipt = CachedReceipt(
            requestDigest: requestDigest,
            receipt: receipt
        )

        // Final actor-isolated commit. Every validation and fallible signing
        // operation above has completed, so state, nonce and receipt advance
        // together and exact retries remain recoverable.
        approvals[approvalIndex] = approval.replacing(
            recordVersion: request.recordVersion + 1,
            updatedAt: decidedAt,
            status: nextStatus
        )
        auditSequence = nextAuditSequence
        nonceReservations[request.oneTimeNonce] = requestDigest
        receiptsByIdempotencyKey[request.idempotencyKey] = cachedReceipt
        challenges.removeValue(forKey: request.challengeID)
        return receipt
    }

    func lookupDecisionReceipt(
        approvalID: String,
        decisionID: String
    ) async throws -> ApprovalReceipt? {
        receiptsByIdempotencyKey.values
            .map(\.receipt)
            .first {
                $0.approvalID == approvalID && $0.decisionID == decisionID
            }
    }

    func receiptVerificationKey() -> BirdieServerVerificationKey {
        BirdieServerVerificationKey(
            keyID: receiptSigningKeyID,
            rawRepresentation: receiptSigningKey.publicKey.rawRepresentation
        )
    }

    func debugApprovalRecord(approvalID: String) -> ApprovalItem? {
        approvals.first { $0.approvalID == approvalID }
    }

    private static func randomNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "Secure randomness unavailable")
        return BirdieCanonicalJSON.base64URL(Data(bytes))
    }

    private static func riskRank(_ risk: ApprovalRisk) -> Int {
        switch risk {
        case .green: 0
        case .amber: 1
        case .red: 2
        }
    }

    private static func fixture(
        approvalID: String,
        recordVersion: Int,
        actionKind: ApprovalActionKind,
        title: String,
        summary: String,
        risk: ApprovalRisk,
        riskReasons: [String],
        irreversible: Bool,
        requiresInteractiveAuthorization: Bool,
        target: ApprovalTarget,
        changes: [ApprovalChange],
        source: ApprovalSource,
        capabilities: ApprovalCapabilities,
        createdAt: Date,
        updatedAt: Date,
        expiresAt: Date,
        status: ApprovalStatus
    ) -> ApprovalItem {
        guard let payloadDigest = try? BirdieApprovalCanonicalizer.payloadDigest(
            actionKind: actionKind,
            target: target,
            changes: changes
        ) else {
            preconditionFailure("Trust-v1 DEBUG fixture cannot be canonicalized")
        }
        return ApprovalItem(
            schemaVersion: BirdieTrustSchema.approval,
            approvalID: approvalID,
            recordVersion: recordVersion,
            actionKind: actionKind,
            title: title,
            summary: summary,
            payloadDigest: payloadDigest,
            risk: risk,
            riskReasons: riskReasons,
            irreversible: irreversible,
            requiresInteractiveAuthorization: requiresInteractiveAuthorization,
            target: target,
            changes: changes,
            source: source,
            capabilities: capabilities,
            createdAt: createdAt,
            updatedAt: updatedAt,
            expiresAt: expiresAt,
            status: status
        )
    }

    private static func effectiveChanges(
        for intent: ApprovalIntent,
        approval: ApprovalItem
    ) throws -> [ApprovalChange] {
        switch intent.decision {
        case .approve, .reject:
            guard intent.editPatch == nil else {
                throw BirdieTrustError.invalidContract("Nur Edit darf einen Patch enthalten.")
            }
            return approval.changes
        case .requestChanges:
            guard let patches = intent.editPatch,
                  patches.count == approval.changes.count else {
                throw BirdieTrustError.invalidContract("Edit-Patch ist unvollständig.")
            }
            return try zip(approval.changes, patches).map { original, patch in
                let expectedPath = "/fields/\(BirdieApprovalValidation.escapedJSONPointerToken(original.field))"
                guard patch.path == expectedPath,
                      patch.operation == "replace",
                      patch.before == original.before,
                      patch.classification == original.classification,
                      patch.after.count <= 20_000 else {
                    throw BirdieTrustError.invalidContract("Edit-Patch verändert nicht erlaubte Felder.")
                }
                return ApprovalChange(
                    field: original.field,
                    before: original.before,
                    proposed: patch.after,
                    classification: original.classification
                )
            }
        }
    }

    private static func validateCapability(
        for decision: ApprovalDecision,
        approval: ApprovalItem
    ) throws {
        let allowed = switch decision {
        case .approve: approval.capabilities.canApprove
        case .reject: approval.capabilities.canReject
        case .requestChanges: approval.capabilities.canEdit
        }
        guard allowed else {
            throw BirdieTrustError.requestRejected(
                "Die serverseitige Policy erlaubt diese Entscheidung nicht."
            )
        }
    }

    private static func fixtures(now: Date) -> [ApprovalItem] {
        [
            fixture(
                approvalID: "apr-mail-20260828-001",
                recordVersion: 3,
                actionKind: .mail,
                title: "Partner-Mail senden",
                summary: "Eine externe Nachricht verlässt BirdieOS.",
                risk: .amber,
                riskReasons: ["Externe Kommunikation mit verbindlichem Inhalt"],
                irreversible: false,
                requiresInteractiveAuthorization: true,
                target: ApprovalTarget(
                    kind: .emailRecipient,
                    displayName: "Muster Partner GmbH",
                    canonicalIdentifier: "partner@example.invalid"
                ),
                changes: [
                    ApprovalChange(
                        field: "subject",
                        before: nil,
                        proposed: "Birdie & Breakfast – Freigabe der Kooperation",
                        classification: "internal"
                    ),
                    ApprovalChange(
                        field: "body",
                        before: nil,
                        proposed: "Vorschau: verbindliche Kooperationsbestätigung (Mock)",
                        classification: "sensitive"
                    )
                ],
                source: ApprovalSource(
                    system: "Birdie Mail",
                    workflowID: "wf-partnership-followup",
                    requestedBy: "Birdie Agent",
                    correlationID: "corr-mail-20260828-001"
                ),
                capabilities: ApprovalCapabilities(
                    canApprove: true,
                    canReject: true,
                    canEdit: true
                ),
                createdAt: now.addingTimeInterval(-180),
                updatedAt: now.addingTimeInterval(-60),
                expiresAt: now.addingTimeInterval(1_800),
                status: .pending
            ),
            fixture(
                approvalID: "apr-deploy-20260828-002",
                recordVersion: 7,
                actionKind: .deploy,
                title: "Produktions-Traffic aktivieren",
                summary: "Eine neue Revision würde öffentlich Traffic erhalten.",
                risk: .red,
                riskReasons: ["Ändert öffentlichen Produktions-Traffic"],
                irreversible: false,
                requiresInteractiveAuthorization: true,
                target: ApprovalTarget(
                    kind: .deploymentEnvironment,
                    displayName: "birdie-agent / europe-west3",
                    canonicalIdentifier: "projects/example/locations/europe-west3/services/birdie-agent"
                ),
                changes: [
                    ApprovalChange(
                        field: "traffic",
                        before: "stable=100%",
                        proposed: "candidate=10%, stable=90%",
                        classification: "internal"
                    ),
                    ApprovalChange(
                        field: "revisionDigest",
                        before: nil,
                        proposed: "sha256:debug-example-not-a-real-image",
                        classification: "internal"
                    )
                ],
                source: ApprovalSource(
                    system: "Birdie Deploy",
                    workflowID: "wf-canary-release",
                    requestedBy: "Release Controller",
                    correlationID: "corr-deploy-20260828-002"
                ),
                capabilities: ApprovalCapabilities(
                    canApprove: true,
                    canReject: true,
                    canEdit: true
                ),
                createdAt: now.addingTimeInterval(-60),
                updatedAt: now.addingTimeInterval(-20),
                expiresAt: now.addingTimeInterval(600),
                status: .pending
            ),
            fixture(
                approvalID: "apr-delete-20260828-003",
                recordVersion: 1,
                actionKind: .delete,
                title: "Datensatz dauerhaft löschen",
                summary: "Die Aktion ist nicht automatisch rückgängig zu machen.",
                risk: .red,
                riskReasons: ["Dauerhafte Löschung", "Kein automatischer Rollback"],
                irreversible: true,
                requiresInteractiveAuthorization: true,
                target: ApprovalTarget(
                    kind: .dataResource,
                    displayName: "Testdatensatz BIRDIE-DEMO",
                    canonicalIdentifier: "supporters/BIRDIE-DEMO"
                ),
                changes: [
                    ApprovalChange(
                        field: "retentionState",
                        before: "retained",
                        proposed: "permanently_deleted",
                        classification: "sensitive"
                    )
                ],
                source: ApprovalSource(
                    system: "Birdie Privacy",
                    workflowID: "wf-erasure-demo",
                    requestedBy: "Data Steward",
                    correlationID: "corr-delete-20260828-003"
                ),
                capabilities: ApprovalCapabilities(
                    canApprove: true,
                    canReject: true,
                    canEdit: false
                ),
                createdAt: now.addingTimeInterval(-30),
                updatedAt: now.addingTimeInterval(-10),
                expiresAt: now.addingTimeInterval(3_600),
                status: .pending
            )
        ]
    }
}
#endif
