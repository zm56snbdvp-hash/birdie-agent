import Foundation

enum BirdieTrustSchema {
    static let contract = "birdie-trust-v1"
    static let approval = contract
    static let challenge = contract
    static let decision = contract
    static let receipt = contract
    static let audit = "birdie.trust.local-audit/v1"
}

enum ApprovalActionKind: String, Codable, CaseIterable, Hashable, Sendable {
    case mail = "send_email"
    case publish
    case deploy
    case delete
    case other = "other_controlled"

    var title: String {
        switch self {
        case .mail: "Mail"
        case .publish: "Veröffentlichung"
        case .deploy: "Deployment"
        case .delete: "Löschung"
        case .other: "Kontrollierte Aktion"
        }
    }

    var systemImage: String {
        switch self {
        case .mail: "envelope"
        case .publish: "megaphone"
        case .deploy: "shippingbox"
        case .delete: "trash"
        case .other: "checkmark.shield"
        }
    }
}

enum ApprovalRisk: String, Codable, CaseIterable, Hashable, Sendable {
    case green
    case amber
    case red

    var title: String {
        switch self {
        case .green: "Grün"
        case .amber: "Gelb"
        case .red: "Rot"
        }
    }
}

enum ApprovalStatus: String, Codable, Hashable, Sendable {
    case pending
    case approved
    case rejected
    case changesRequested = "edited"
    case expired
}

enum ApprovalDecision: String, Codable, CaseIterable, Hashable, Sendable {
    case approve
    case reject
    case requestChanges = "edit"

    var title: String {
        switch self {
        case .approve: "Genehmigen"
        case .reject: "Ablehnen"
        case .requestChanges: "Änderung anfordern"
        }
    }
}

enum ApprovalTargetKind: String, Codable, Hashable, Sendable {
    case emailRecipient = "email_recipient"
    case publicationAccount = "publication_account"
    case deploymentEnvironment = "deployment_environment"
    case dataResource = "data_resource"
    case connectorResource = "connector_resource"
    case other
}

struct ApprovalTarget: Codable, Hashable, Sendable {
    let kind: ApprovalTargetKind
    let displayName: String
    let canonicalIdentifier: String
}

struct ApprovalChange: Codable, Hashable, Identifiable, Sendable {
    let field: String
    let before: String?
    var proposed: String
    let classification: String

    var id: String { field }
}

struct ApprovalSource: Codable, Hashable, Sendable {
    let system: String
    let workflowID: String
    let requestedBy: String
    let correlationID: String

    enum CodingKeys: String, CodingKey {
        case system
        case workflowID = "workflowId"
        case requestedBy
        case correlationID = "correlationId"
    }
}

struct ApprovalCapabilities: Codable, Hashable, Sendable {
    let canApprove: Bool
    let canReject: Bool
    let canEdit: Bool
}

struct ApprovalItem: Codable, Hashable, Identifiable, Sendable {
    let schemaVersion: String
    let approvalID: String
    let recordVersion: Int
    let actionKind: ApprovalActionKind
    let title: String
    let summary: String
    let payloadDigest: String
    let risk: ApprovalRisk
    let riskReasons: [String]
    let irreversible: Bool
    let requiresInteractiveAuthorization: Bool
    let target: ApprovalTarget
    var changes: [ApprovalChange]
    let source: ApprovalSource
    let capabilities: ApprovalCapabilities
    let createdAt: Date
    let updatedAt: Date
    let expiresAt: Date
    var status: ApprovalStatus

    var id: String { approvalID }

    var isExpired: Bool { expiresAt <= Date() }

    func requiresLocalAuthentication(for decision: ApprovalDecision) -> Bool {
        guard decision == .approve else { return false }
        return requiresInteractiveAuthorization
            || irreversible
            || risk != .green
            || [.publish, .deploy, .delete].contains(actionKind)
    }

    func replacing(
        recordVersion: Int,
        updatedAt: Date,
        status: ApprovalStatus
    ) -> ApprovalItem {
        ApprovalItem(
            schemaVersion: schemaVersion,
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

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case approvalID = "approvalId"
        case recordVersion
        case actionKind
        case title
        case summary
        case payloadDigest
        case risk
        case riskReasons
        case irreversible
        case requiresInteractiveAuthorization
        case target
        case changes
        case source
        case capabilities
        case createdAt
        case updatedAt
        case expiresAt
        case status
    }
}

struct ApprovalCanonicalPayload: Codable, Hashable, Sendable {
    let actionKind: ApprovalActionKind
    let target: ApprovalTarget
    let changes: [ApprovalChange]
}

struct ApprovalActionSnapshot: Codable, Hashable, Sendable {
    let approvalID: String
    let recordVersion: Int
    let actionKind: ApprovalActionKind
    let payloadDigest: String
    let target: ApprovalTarget
    let changes: [ApprovalChange]
    let decision: ApprovalDecision

    enum CodingKeys: String, CodingKey {
        case approvalID = "approvalId"
        case recordVersion
        case actionKind
        case payloadDigest
        case target
        case changes
        case decision
    }
}

enum BirdieApprovalCanonicalizer {
    static func payloadDigest(
        actionKind: ApprovalActionKind,
        target: ApprovalTarget,
        changes: [ApprovalChange]
    ) throws -> String {
        try BirdieCanonicalJSON.sha256Digest(
            ApprovalCanonicalPayload(
                actionKind: actionKind,
                target: target,
                changes: changes
            )
        )
    }

    static func actionDigest(
        approval: ApprovalItem,
        effectiveChanges: [ApprovalChange],
        decision: ApprovalDecision
    ) throws -> String {
        try BirdieCanonicalJSON.sha256Digest(
            ApprovalActionSnapshot(
                approvalID: approval.approvalID,
                recordVersion: approval.recordVersion,
                actionKind: approval.actionKind,
                payloadDigest: approval.payloadDigest,
                target: approval.target,
                changes: effectiveChanges,
                decision: decision
            )
        )
    }
}

enum BirdieApprovalValidation {
    static func validate(_ approval: ApprovalItem) throws {
        let expectedPayloadDigest = try BirdieApprovalCanonicalizer.payloadDigest(
            actionKind: approval.actionKind,
            target: approval.target,
            changes: approval.changes
        )
        let fields = approval.changes.map(\.field)
        let validClassifications = Set(["public", "internal", "personal", "sensitive"])

        guard approval.schemaVersion == BirdieTrustSchema.approval,
              isOpaqueIdentifier(approval.approvalID),
              approval.recordVersion >= 1,
              !approval.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              approval.title.count <= 160,
              !approval.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              approval.summary.count <= 500,
              approval.payloadDigest == expectedPayloadDigest,
              (1 ... 10).contains(approval.riskReasons.count),
              approval.riskReasons.allSatisfy({
                  !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 240
              }),
              approval.risk != .red || approval.requiresInteractiveAuthorization,
              !approval.irreversible || approval.requiresInteractiveAuthorization,
              !approval.target.displayName.isEmpty,
              approval.target.displayName.count <= 256,
              !approval.target.canonicalIdentifier.isEmpty,
              approval.target.canonicalIdentifier.count <= 1_024,
              (1 ... 100).contains(approval.changes.count),
              Set(fields).count == fields.count,
              approval.changes.allSatisfy({ change in
                  !change.field.isEmpty
                      && change.field.count <= 256
                      && (change.before?.count ?? 0) <= 20_000
                      && change.proposed.count <= 20_000
                      && validClassifications.contains(change.classification)
              }),
              !approval.source.system.isEmpty,
              approval.source.system.count <= 128,
              !approval.source.workflowID.isEmpty,
              approval.source.workflowID.count <= 256,
              !approval.source.requestedBy.isEmpty,
              approval.source.requestedBy.count <= 256,
              isOpaqueIdentifier(approval.source.correlationID),
              approval.createdAt <= approval.updatedAt,
              approval.updatedAt < approval.expiresAt
        else {
            throw BirdieTrustError.invalidContract(
                "Approval-Felder oder Payload-Digest entsprechen nicht Trust-v1."
            )
        }
    }

    static func isOpaqueIdentifier(_ value: String) -> Bool {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        )
        return (16 ... 128).contains(value.count)
            && value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    static func escapedJSONPointerToken(_ value: String) -> String {
        value
            .replacingOccurrences(of: "~", with: "~0")
            .replacingOccurrences(of: "/", with: "~1")
    }
}

struct BirdieApprovalDeepLink: Equatable, Hashable, Sendable {
    static let scheme = "birdie"
    static let host = "approvals"

    let approvalID: String

    var url: URL? {
        guard BirdieApprovalValidation.isOpaqueIdentifier(approvalID) else { return nil }
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = Self.host
        components.path = "/\(approvalID)"
        return components.url
    }

    init(approvalID: String) {
        self.approvalID = approvalID
    }

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == Self.scheme,
              components.host?.lowercased() == Self.host,
              components.user == nil,
              components.password == nil,
              components.port == nil,
              components.query == nil,
              components.fragment == nil else { return nil }
        let path = components.path.split(separator: "/", omittingEmptySubsequences: true)
        guard path.count == 1 else { return nil }
        let identifier = String(path[0])
        guard BirdieApprovalValidation.isOpaqueIdentifier(identifier) else { return nil }
        approvalID = identifier
    }
}

struct ApprovalChallenge: Codable, Hashable, Sendable {
    let schemaVersion: String
    let challengeID: String
    let resourceType: String
    let approvalID: String
    let recordVersion: Int
    let idempotencyKey: String
    let actionDigest: String
    let oneTimeNonce: String
    let deviceBindingID: String
    let issuedAt: Date
    let expiresAt: Date
    let maxAttempts: Int
    let consumed: Bool

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case challengeID = "challengeId"
        case resourceType
        case approvalID = "resourceId"
        case recordVersion
        case idempotencyKey
        case actionDigest
        case oneTimeNonce = "nonce"
        case deviceBindingID = "deviceBindingId"
        case issuedAt
        case expiresAt
        case maxAttempts
        case consumed
    }
}

struct LocalAuthorizationEvidence: Codable, Hashable, Sendable {
    let method: String
    let policy: String
    let success: Bool
    let evaluatedAt: Date
    let contextDigest: String
}

struct DeviceAssertion: Codable, Hashable, Sendable {
    let provider: String
    let keyID: String
    let clientDataHash: String
    let assertionObject: String

    enum CodingKeys: String, CodingKey {
        case provider
        case keyID = "keyId"
        case clientDataHash
        case assertionObject = "assertion"
    }
}

struct ApprovalEditOperation: Codable, Hashable, Sendable {
    let path: String
    let operation: String
    let before: String?
    let after: String
    let classification: String
}

struct ApprovalIntent: Codable, Hashable, Sendable {
    let decision: ApprovalDecision
    let editPatch: [ApprovalEditOperation]?
    let reason: String?
}

struct ApprovalDecisionRequest: Codable, Hashable, Sendable {
    let schemaVersion: String
    let decisionID: String
    let approvalID: String
    let recordVersion: Int
    let idempotencyKey: String
    let challengeID: String
    let oneTimeNonce: String
    let actionDigest: String
    let deviceBindingID: String
    let deviceAssertion: DeviceAssertion
    let localAuthorization: LocalAuthorizationEvidence
    let intent: ApprovalIntent
    let clientDecidedAt: Date

    var decision: ApprovalDecision { intent.decision }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case decisionID = "decisionId"
        case approvalID = "approvalId"
        case recordVersion
        case idempotencyKey
        case challengeID = "challengeId"
        case oneTimeNonce = "nonce"
        case actionDigest
        case deviceBindingID = "deviceBindingId"
        case deviceAssertion
        case localAuthorization
        case intent
        case clientDecidedAt
    }
}

struct ApprovalAssertionPayload: Codable, Hashable, Sendable {
    let schemaVersion: String
    let decisionID: String
    let approvalID: String
    let recordVersion: Int
    let idempotencyKey: String
    let challengeID: String
    let oneTimeNonce: String
    let actionDigest: String
    let deviceBindingID: String
    let localAuthorization: LocalAuthorizationEvidence
    let intent: ApprovalIntent
    let clientDecidedAt: Date

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case decisionID = "decisionId"
        case approvalID = "approvalId"
        case recordVersion
        case idempotencyKey
        case challengeID = "challengeId"
        case oneTimeNonce = "nonce"
        case actionDigest
        case deviceBindingID = "deviceBindingId"
        case localAuthorization
        case intent
        case clientDecidedAt
    }
}

struct ServerSignature: Codable, Hashable, Sendable {
    let format: String
    let algorithm: String
    let keyID: String
    let canonicalization: String
    let signature: String
    let signedAt: Date

    enum CodingKeys: String, CodingKey {
        case format
        case algorithm
        case keyID = "keyId"
        case canonicalization
        case signature
        case signedAt
    }
}

enum ApprovalReceiptOutcome: String, Codable, Hashable, Sendable {
    case accepted
    case deniedByPolicy = "denied_by_policy"
}

enum ApprovalExecutionState: String, Codable, Hashable, Sendable {
    case pending
    case executed
    case notApplicable = "not_applicable"
    case failed
}

struct AppAttestRegistrationChallengeRequest: Codable, Hashable, Sendable {
    let contractVersion: String
    let registrationID: String
    let idempotencyKey: String
    let keyID: String

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case registrationID = "registrationId"
        case idempotencyKey
        case keyID = "keyId"
    }
}

struct AppAttestRegistrationChallenge: Codable, Hashable, Sendable {
    let contractVersion: String
    let registrationID: String
    let challengeID: String
    let idempotencyKey: String
    let keyID: String
    let nonce: String
    let issuedAt: Date
    let expiresAt: Date
    let maxAttempts: Int
    let consumed: Bool

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case registrationID = "registrationId"
        case challengeID = "challengeId"
        case idempotencyKey
        case keyID = "keyId"
        case nonce
        case issuedAt
        case expiresAt
        case maxAttempts
        case consumed
    }
}

struct AppAttestRegistrationPayload: Codable, Hashable, Sendable {
    let contractVersion: String
    let registrationID: String
    let challengeID: String
    let idempotencyKey: String
    let keyID: String
    let nonce: String
    let clientIssuedAt: Date

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case registrationID = "registrationId"
        case challengeID = "challengeId"
        case idempotencyKey
        case keyID = "keyId"
        case nonce
        case clientIssuedAt
    }
}

struct AppAttestRegistrationRequest: Codable, Hashable, Sendable {
    let contractVersion: String
    let registrationID: String
    let challengeID: String
    let idempotencyKey: String
    let keyID: String
    let nonce: String
    let clientIssuedAt: Date
    let clientDataHash: String
    let attestation: String

    var assertionPayload: AppAttestRegistrationPayload {
        AppAttestRegistrationPayload(
            contractVersion: contractVersion,
            registrationID: registrationID,
            challengeID: challengeID,
            idempotencyKey: idempotencyKey,
            keyID: keyID,
            nonce: nonce,
            clientIssuedAt: clientIssuedAt
        )
    }

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case registrationID = "registrationId"
        case challengeID = "challengeId"
        case idempotencyKey
        case keyID = "keyId"
        case nonce
        case clientIssuedAt
        case clientDataHash
        case attestation
    }
}

struct AppAttestRegistrationAcknowledgement: Codable, Hashable, Sendable {
    let contractVersion: String
    let acknowledgementID: String
    let registrationID: String
    let deviceBindingID: String
    let keyID: String
    let registeredAt: Date
    let serverSignature: ServerSignature

    var signingPayload: AppAttestRegistrationAcknowledgementSigningPayload {
        AppAttestRegistrationAcknowledgementSigningPayload(
            contractVersion: contractVersion,
            acknowledgementID: acknowledgementID,
            registrationID: registrationID,
            deviceBindingID: deviceBindingID,
            keyID: keyID,
            registeredAt: registeredAt
        )
    }

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case acknowledgementID = "acknowledgementId"
        case registrationID = "registrationId"
        case deviceBindingID = "deviceBindingId"
        case keyID = "keyId"
        case registeredAt
        case serverSignature
    }
}

struct AppAttestRegistrationAcknowledgementSigningPayload: Codable, Hashable, Sendable {
    let contractVersion: String
    let acknowledgementID: String
    let registrationID: String
    let deviceBindingID: String
    let keyID: String
    let registeredAt: Date

    enum CodingKeys: String, CodingKey {
        case contractVersion
        case acknowledgementID = "acknowledgementId"
        case registrationID = "registrationId"
        case deviceBindingID = "deviceBindingId"
        case keyID = "keyId"
        case registeredAt
    }
}

struct ApprovalReceipt: Codable, Hashable, Identifiable, Sendable {
    let schemaVersion: String
    let receiptID: String
    let decisionID: String
    let approvalID: String
    let recordVersion: Int
    let decision: ApprovalDecision
    let outcome: ApprovalReceiptOutcome
    let executionState: ApprovalExecutionState
    let idempotencyKey: String
    let requestDigest: String
    let recordedAt: Date
    let auditEventID: String
    let auditSequence: Int
    let auditHeadHash: String
    let serverSignature: ServerSignature

    var id: String { receiptID }
    var result: String { "\(outcome.rawValue) · \(executionState.rawValue)" }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case receiptID = "receiptId"
        case decisionID = "decisionId"
        case approvalID = "approvalId"
        case recordVersion
        case decision
        case outcome
        case executionState
        case idempotencyKey
        case requestDigest
        case recordedAt
        case auditEventID = "auditEventId"
        case auditSequence
        case auditHeadHash
        case serverSignature
    }
}

struct ApprovalReceiptSigningPayload: Codable, Hashable, Sendable {
    let schemaVersion: String
    let receiptID: String
    let decisionID: String
    let approvalID: String
    let recordVersion: Int
    let decision: ApprovalDecision
    let outcome: ApprovalReceiptOutcome
    let executionState: ApprovalExecutionState
    let idempotencyKey: String
    let requestDigest: String
    let recordedAt: Date
    let auditEventID: String
    let auditSequence: Int
    let auditHeadHash: String

    init(receipt: ApprovalReceipt) {
        schemaVersion = receipt.schemaVersion
        receiptID = receipt.receiptID
        decisionID = receipt.decisionID
        approvalID = receipt.approvalID
        recordVersion = receipt.recordVersion
        decision = receipt.decision
        outcome = receipt.outcome
        executionState = receipt.executionState
        idempotencyKey = receipt.idempotencyKey
        requestDigest = receipt.requestDigest
        recordedAt = receipt.recordedAt
        auditEventID = receipt.auditEventID
        auditSequence = receipt.auditSequence
        auditHeadHash = receipt.auditHeadHash
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "contractVersion"
        case receiptID = "receiptId"
        case decisionID = "decisionId"
        case approvalID = "approvalId"
        case recordVersion
        case decision
        case outcome
        case executionState
        case idempotencyKey
        case requestDigest
        case recordedAt
        case auditEventID = "auditEventId"
        case auditSequence
        case auditHeadHash
    }
}

enum BirdieTrustError: LocalizedError, Equatable {
    case backendUnavailable
    case invalidContract(String)
    case approvalExpired
    case approvalChanged
    case authenticationUnavailable
    case authenticationFailed
    case deviceBindingUnavailable
    case replayDetected
    case requestRejected(String)

    var errorDescription: String? {
        switch self {
        case .backendUnavailable:
            "Birdie Trust ist noch nicht mit einem Produktions-Backend verbunden."
        case .invalidContract(let detail):
            "Ungültiger Birdie-Trust-Vertrag: \(detail)"
        case .approvalExpired:
            "Die Freigabe ist abgelaufen. Bitte den aktuellen Stand neu laden."
        case .approvalChanged:
            "Die Freigabe wurde inzwischen geändert. Bitte erneut prüfen."
        case .authenticationUnavailable:
            "Face ID oder eine andere Geräteauthentifizierung ist nicht verfügbar."
        case .authenticationFailed:
            "Die Geräteauthentifizierung wurde nicht bestätigt."
        case .deviceBindingUnavailable:
            "Diese App-Installation ist noch nicht sicher an Birdie Trust gebunden."
        case .replayDetected:
            "Die Einmal-Nonce wurde bereits für eine andere Anfrage verwendet."
        case .requestRejected(let message):
            message
        }
    }
}
