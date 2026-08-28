import Foundation

enum LiveMissionContract {
    static let version = "birdie-trust-v1"
}

enum LiveMissionStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case queued
    case running
    case paused
    case blocked
    case succeeded
    case failed
    case cancelled
    case expired

    var isTerminal: Bool {
        switch self {
        case .succeeded, .failed, .cancelled, .expired:
            true
        case .queued, .running, .paused, .blocked:
            false
        }
    }

    var activityStatus: BirdieLiveMissionAttributes.Status {
        BirdieLiveMissionAttributes.Status(rawValue: rawValue) ?? .failed
    }
}

struct LiveMissionStep: Codable, Equatable, Hashable, Sendable {
    let index: Int
    let total: Int
    let title: String
    /// Phone-only detail. It must not be projected into the Live Activity.
    let detail: String?

    init(index: Int, total: Int, title: String, detail: String? = nil) throws {
        guard total > 0, index > 0, index <= total else {
            throw LiveMissionValidationError.invalidStep
        }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LiveMissionValidationError.missingStepTitle
        }
        guard title.count <= 100, (detail?.count ?? 0) <= 240 else {
            throw LiveMissionValidationError.fieldTooLong
        }

        self.index = index
        self.total = total
        self.title = title
        self.detail = detail
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            index: values.decode(Int.self, forKey: .index),
            total: values.decode(Int.self, forKey: .total),
            title: values.decode(String.self, forKey: .title),
            detail: values.decodeIfPresent(String.self, forKey: .detail)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case index
        case total
        case title
        case detail
    }
}

struct LiveMissionBlocker: Codable, Equatable, Hashable, Sendable {
    let code: String
    let message: String
    let since: Date

    init(code: String, message: String, since: Date) throws {
        guard !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LiveMissionValidationError.missingBlockerCode
        }
        guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LiveMissionValidationError.missingBlockerMessage
        }
        let allowedCodeCharacters = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
        )
        guard code.count <= 64,
              code.unicodeScalars.allSatisfy({ allowedCodeCharacters.contains($0) }),
              message.count <= 240 else {
            throw LiveMissionValidationError.invalidBlocker
        }

        self.code = code
        self.message = message
        self.since = since
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            code: values.decode(String.self, forKey: .code),
            message: values.decode(String.self, forKey: .message),
            since: values.decode(Date.self, forKey: .since)
        )
    }

    var activityCategory: BirdieLiveMissionAttributes.BlockerCategory {
        let normalized = code.lowercased()
        if normalized.contains("approval") || normalized.contains("confirm") {
            return .approvalRequired
        }
        if normalized.contains("network") || normalized.contains("connect") || normalized.contains("offline") {
            return .connectivity
        }
        if normalized.contains("policy") || normalized.contains("permission") {
            return .policy
        }
        if normalized.contains("depend") || normalized.contains("upstream") {
            return .dependency
        }
        return .unknown
    }

    private enum CodingKeys: String, CodingKey {
        case code
        case message
        case since
    }
}

struct LiveMissionScope: Codable, Equatable, Hashable, Sendable {
    let summary: String
    let boundary: String
    let maximumDurationSeconds: Int

    init(summary: String, boundary: String, maximumDurationSeconds: Int) throws {
        guard !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !boundary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              summary.count <= 500,
              boundary.count <= 500,
              (60 ... Int(BirdieLiveMissionAttributes.maximumDuration)).contains(maximumDurationSeconds) else {
            throw LiveMissionValidationError.invalidScope
        }

        self.summary = summary
        self.boundary = boundary
        self.maximumDurationSeconds = maximumDurationSeconds
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            summary: values.decode(String.self, forKey: .summary),
            boundary: values.decode(String.self, forKey: .boundary),
            maximumDurationSeconds: values.decode(Int.self, forKey: .maximumDurationSeconds)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case summary
        case boundary
        case maximumDurationSeconds
    }
}

struct LiveMissionRecord: Codable, Identifiable, Equatable, Hashable, Sendable {
    static let maximumDuration = BirdieLiveMissionAttributes.maximumDuration

    let contractVersion: String
    let missionID: String
    let recordVersion: Int
    let title: String
    let scope: LiveMissionScope
    let status: LiveMissionStatus
    let progress: Double
    let currentStep: LiveMissionStep
    let blocker: LiveMissionBlocker?
    let allowsPause: Bool
    let allowsCancel: Bool
    let startedAt: Date
    let updatedAt: Date
    let expiresAt: Date

    var id: String { missionID }

    init(
        contractVersion: String = LiveMissionContract.version,
        missionID: String,
        recordVersion: Int,
        title: String,
        scope: LiveMissionScope,
        status: LiveMissionStatus,
        progress: Double,
        currentStep: LiveMissionStep,
        blocker: LiveMissionBlocker?,
        allowsPause: Bool,
        allowsCancel: Bool,
        startedAt: Date,
        updatedAt: Date,
        expiresAt: Date
    ) throws {
        guard contractVersion == LiveMissionContract.version else {
            throw LiveMissionValidationError.invalidContractVersion
        }
        let allowedIdentifierCharacters = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        guard (16 ... 128).contains(missionID.count),
              missionID.unicodeScalars.allSatisfy({ allowedIdentifierCharacters.contains($0) }) else {
            throw LiveMissionValidationError.missingMissionID
        }
        guard recordVersion >= 1 else {
            throw LiveMissionValidationError.invalidRecordVersion
        }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.count <= 80 else {
            throw LiveMissionValidationError.missingTitle
        }
        guard progress.isFinite, (0 ... 1).contains(progress) else {
            throw LiveMissionValidationError.invalidProgress
        }

        let duration = expiresAt.timeIntervalSince(startedAt)
        guard duration > 0,
              duration <= Self.maximumDuration,
              duration <= TimeInterval(scope.maximumDurationSeconds) else {
            throw LiveMissionValidationError.invalidDuration
        }
        guard updatedAt >= startedAt else {
            throw LiveMissionValidationError.invalidUpdateDate
        }
        guard status.isTerminal || updatedAt < expiresAt else {
            throw LiveMissionValidationError.invalidUpdateDate
        }

        self.contractVersion = contractVersion
        self.missionID = missionID
        self.recordVersion = recordVersion
        self.title = title
        self.scope = scope
        self.status = status
        self.progress = progress
        self.currentStep = currentStep
        self.blocker = blocker
        self.allowsPause = allowsPause && !status.isTerminal
        self.allowsCancel = allowsCancel && !status.isTerminal
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            contractVersion: values.decode(String.self, forKey: .contractVersion),
            missionID: values.decode(String.self, forKey: .missionID),
            recordVersion: values.decode(Int.self, forKey: .recordVersion),
            title: values.decode(String.self, forKey: .title),
            scope: values.decode(LiveMissionScope.self, forKey: .scope),
            status: values.decode(LiveMissionStatus.self, forKey: .status),
            progress: values.decode(Double.self, forKey: .progress),
            currentStep: values.decode(LiveMissionStep.self, forKey: .currentStep),
            blocker: values.decodeIfPresent(LiveMissionBlocker.self, forKey: .blocker),
            allowsPause: values.decode(Bool.self, forKey: .allowsPause),
            allowsCancel: values.decode(Bool.self, forKey: .allowsCancel),
            startedAt: values.decode(Date.self, forKey: .startedAt),
            updatedAt: values.decode(Date.self, forKey: .updatedAt),
            expiresAt: values.decode(Date.self, forKey: .expiresAt)
        )
    }

    func isEligibleForLiveActivity(at date: Date = Date()) -> Bool {
        status != .queued && !status.isTerminal && date < expiresAt
    }

    func replacing(
        recordVersion: Int,
        status: LiveMissionStatus,
        progress: Double? = nil,
        updatedAt: Date,
        blocker: LiveMissionBlocker? = nil
    ) throws -> LiveMissionRecord {
        try LiveMissionRecord(
            contractVersion: contractVersion,
            missionID: missionID,
            recordVersion: recordVersion,
            title: title,
            scope: scope,
            status: status,
            progress: progress ?? self.progress,
            currentStep: currentStep,
            blocker: blocker,
            allowsPause: allowsPause,
            allowsCancel: allowsCancel,
            startedAt: startedAt,
            updatedAt: updatedAt,
            expiresAt: expiresAt
        )
    }

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case missionID = "missionId"
        case recordVersion
        case title
        case scope
        case status
        case progress
        case currentStep
        case blocker
        case allowsPause
        case allowsCancel
        case startedAt
        case updatedAt
        case expiresAt
    }
}

enum LiveMissionCommand: String, Codable, CaseIterable, Hashable, Sendable {
    case pause
    case resume
    case cancel
}

struct MissionChallengeRequest: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let missionID: String
    let recordVersion: Int
    let idempotencyKey: String
    let deviceBindingID: String
    let actionDigest: String
    let command: LiveMissionCommand

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case missionID = "missionId"
        case recordVersion
        case idempotencyKey
        case deviceBindingID = "deviceBindingId"
        case actionDigest
        case command
    }
}

/// Trust-v1 ActionChallenge specialized for a Live Mission command. The nonce
/// is server-issued, one-time, and must contain at least 256 bits of entropy.
struct MissionActionChallenge: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let challengeID: String
    let resourceType: String
    let missionID: String
    let recordVersion: Int
    let idempotencyKey: String
    let deviceBindingID: String
    let oneTimeNonce: String
    let actionDigest: String
    let issuedAt: Date
    let expiresAt: Date
    let maxAttempts: Int
    let consumed: Bool

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case challengeID = "challengeId"
        case resourceType
        case missionID = "resourceId"
        case recordVersion
        case idempotencyKey
        case deviceBindingID = "deviceBindingId"
        case oneTimeNonce = "nonce"
        case actionDigest
        case issuedAt
        case expiresAt
        case maxAttempts
        case consumed
    }
}

/// Every field except `deviceAssertion` is included in the RFC-8785 client-data
/// hash supplied to App Attest, matching the OpenAPI assertion binding exactly.
struct MissionCommandAssertionPayload: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let commandID: String
    let missionID: String
    let recordVersion: Int
    let idempotencyKey: String
    let challengeID: String
    let oneTimeNonce: String
    let actionDigest: String
    let deviceBindingID: String
    let localAuthorization: LocalAuthorizationEvidence
    let command: LiveMissionCommand
    let reason: String?
    let clientIssuedAt: Date

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case commandID = "commandId"
        case missionID = "missionId"
        case recordVersion
        case idempotencyKey
        case challengeID = "challengeId"
        case oneTimeNonce = "nonce"
        case actionDigest
        case deviceBindingID = "deviceBindingId"
        case localAuthorization
        case command
        case reason
        case clientIssuedAt
    }
}

struct MissionCommandRequest: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let commandID: String
    let missionID: String
    let recordVersion: Int
    let idempotencyKey: String
    let challengeID: String
    let oneTimeNonce: String
    let actionDigest: String
    let deviceBindingID: String
    let deviceAssertion: DeviceAssertion
    let localAuthorization: LocalAuthorizationEvidence
    let command: LiveMissionCommand
    let reason: String?
    let clientIssuedAt: Date

    var assertionPayload: MissionCommandAssertionPayload {
        MissionCommandAssertionPayload(
            contractVersion: contractVersion,
            commandID: commandID,
            missionID: missionID,
            recordVersion: recordVersion,
            idempotencyKey: idempotencyKey,
            challengeID: challengeID,
            oneTimeNonce: oneTimeNonce,
            actionDigest: actionDigest,
            deviceBindingID: deviceBindingID,
            localAuthorization: localAuthorization,
            command: command,
            reason: reason,
            clientIssuedAt: clientIssuedAt
        )
    }

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case commandID = "commandId"
        case missionID = "missionId"
        case recordVersion
        case idempotencyKey
        case challengeID = "challengeId"
        case oneTimeNonce = "nonce"
        case actionDigest
        case deviceBindingID = "deviceBindingId"
        case deviceAssertion
        case localAuthorization
        case command
        case reason
        case clientIssuedAt
    }
}

enum MissionCommandOutcome: String, Codable, Equatable, Hashable, Sendable {
    case accepted
    case deniedByPolicy = "denied_by_policy"
}

struct MissionCommandReceipt: Codable, Equatable, Hashable, Identifiable, Sendable {
    let contractVersion: String
    let receiptID: String
    let commandID: String
    let missionID: String
    let recordVersion: Int
    let command: LiveMissionCommand
    let outcome: MissionCommandOutcome
    let idempotencyKey: String
    let requestDigest: String
    let recordedAt: Date
    let auditEventID: String
    let auditSequence: Int
    let auditHeadHash: String
    let serverSignature: ServerSignature

    var id: String { receiptID }

    var signingPayload: MissionCommandReceiptSigningPayload {
        MissionCommandReceiptSigningPayload(
            contractVersion: contractVersion,
            receiptID: receiptID,
            commandID: commandID,
            missionID: missionID,
            recordVersion: recordVersion,
            command: command,
            outcome: outcome,
            idempotencyKey: idempotencyKey,
            requestDigest: requestDigest,
            recordedAt: recordedAt,
            auditEventID: auditEventID,
            auditSequence: auditSequence,
            auditHeadHash: auditHeadHash
        )
    }

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case receiptID = "receiptId"
        case commandID = "commandId"
        case missionID = "missionId"
        case recordVersion
        case command
        case outcome
        case idempotencyKey
        case requestDigest
        case recordedAt
        case auditEventID = "auditEventId"
        case auditSequence
        case auditHeadHash
        case serverSignature
    }
}

/// Raw Ed25519/JCS signing payload: every receipt field except `serverSignature`.
struct MissionCommandReceiptSigningPayload: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let receiptID: String
    let commandID: String
    let missionID: String
    let recordVersion: Int
    let command: LiveMissionCommand
    let outcome: MissionCommandOutcome
    let idempotencyKey: String
    let requestDigest: String
    let recordedAt: Date
    let auditEventID: String
    let auditSequence: Int
    let auditHeadHash: String

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case receiptID = "receiptId"
        case commandID = "commandId"
        case missionID = "missionId"
        case recordVersion
        case command
        case outcome
        case idempotencyKey
        case requestDigest
        case recordedAt
        case auditEventID = "auditEventId"
        case auditSequence
        case auditHeadHash
    }
}

struct MissionCommandResponse: Codable, Equatable, Hashable, Sendable {
    let contractVersion: String
    let receipt: MissionCommandReceipt
    let mission: LiveMissionRecord
}


enum LiveMissionValidationError: LocalizedError, Equatable, Sendable {
    case invalidContractVersion
    case missingMissionID
    case invalidRecordVersion
    case missingTitle
    case invalidScope
    case invalidProgress
    case invalidStep
    case missingStepTitle
    case missingBlockerCode
    case missingBlockerMessage
    case invalidBlocker
    case fieldTooLong
    case invalidDuration
    case invalidUpdateDate

    var errorDescription: String? {
        switch self {
        case .invalidContractVersion:
            "Die Vertragsversion der Mission wird nicht unterstützt."
        case .missingMissionID:
            "Die Mission-ID fehlt."
        case .invalidRecordVersion:
            "Die Versionsnummer der Mission ist ungültig."
        case .missingTitle:
            "Der Missionstitel fehlt."
        case .invalidScope:
            "Der klar begrenzte Umfang der Mission ist ungültig."
        case .invalidProgress:
            "Der Missionsfortschritt muss zwischen 0 und 1 liegen."
        case .invalidStep:
            "Der aktuelle Missionsschritt ist ungültig."
        case .missingStepTitle:
            "Die Bezeichnung des aktuellen Schritts fehlt."
        case .missingBlockerCode:
            "Der Blocker-Code fehlt."
        case .missingBlockerMessage:
            "Die Blocker-Beschreibung fehlt."
        case .invalidBlocker:
            "Der Blocker entspricht nicht dem Trust-v1-Vertrag."
        case .fieldTooLong:
            "Ein Missionsfeld überschreitet die zulässige Länge."
        case .invalidDuration:
            "Eine Live Mission muss positiv und auf höchstens acht Stunden begrenzt sein."
        case .invalidUpdateDate:
            "Der Aktualisierungszeitpunkt liegt vor dem Missionsstart."
        }
    }
}
