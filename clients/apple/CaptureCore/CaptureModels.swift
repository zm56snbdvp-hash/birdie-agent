import Foundation

public enum CaptureLimits {
    public static let maximumPartCount = 20
    public static let maximumTextBytes = 1_048_576
    public static let maximumFileBytes: Int64 = 100 * 1_048_576
    public static let maximumTotalBytes: Int64 = 250 * 1_048_576
}

public enum CaptureIntent: String, Codable, CaseIterable, Hashable, Sendable {
    case remember
    case summarize
    case prepareTask
    case sendToPC

    public var title: String {
        switch self {
        case .remember: "Merken"
        case .summarize: "Zusammenfassen"
        case .prepareTask: "Aufgabe vorbereiten"
        case .sendToPC: "An PC senden"
        }
    }
}

public enum CaptureSource: String, Codable, Hashable, Sendable {
    case shareExtension
    case document
    case receipt
    case businessCard
    case whiteboard
    case errorMessage
}

public enum CapturePayloadKind: String, Codable, Hashable, Sendable {
    case url
    case text
    case image
    case pdf
    case file
    case recognizedText
}

public enum CaptureStatus: String, Codable, Hashable, Sendable {
    case staged
    case queued
    case processing
    case retryScheduled
    case readyForReview
    case failed
}

public enum CaptureConsent: String, Codable, Hashable, Sendable {
    case notRequested
    case confirmed
}

public enum CaptureOriginalPolicy: String, Codable, Hashable, Sendable {
    case derivedTextOnly
    case includeOriginals
}

public struct CapturePayload: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: CapturePayloadKind
    public let displayName: String
    public let typeIdentifier: String?
    public let relativeFilePath: String?
    public let inlineText: String?
    public let byteCount: Int64?
    public let sha256: String?

    public init(
        id: UUID = UUID(),
        kind: CapturePayloadKind,
        displayName: String,
        typeIdentifier: String? = nil,
        relativeFilePath: String? = nil,
        inlineText: String? = nil,
        byteCount: Int64? = nil,
        sha256: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.typeIdentifier = typeIdentifier
        self.relativeFilePath = relativeFilePath
        self.inlineText = inlineText
        self.byteCount = byteCount
        self.sha256 = sha256
    }
}

public struct CaptureSuggestion: Codable, Equatable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case title
        case summary
        case amount
        case dueDate
        case contact
        case task
        case errorCode
    }

    public let id: UUID
    public let kind: Kind
    public let label: String
    public let value: String

    public init(id: UUID = UUID(), kind: Kind, label: String, value: String) {
        self.id = id
        self.kind = kind
        self.label = label
        self.value = value
    }
}

public struct CaptureFailure: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let isRetryable: Bool

    public init(code: String, message: String, isRetryable: Bool) {
        self.code = code
        self.message = message
        self.isRetryable = isRetryable
    }
}

public struct CaptureItem: Codable, Equatable, Identifiable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let id: UUID
    public let idempotencyKey: String
    public let createdAt: Date
    public var updatedAt: Date
    public let source: CaptureSource
    public var intent: CaptureIntent
    public var status: CaptureStatus
    public var payloads: [CapturePayload]
    public var suggestions: [CaptureSuggestion]
    public var originalStorageConsent: CaptureConsent
    public var originalPolicy: CaptureOriginalPolicy
    public var containsSensitiveData: Bool
    public var attemptCount: Int
    public var nextRetryAt: Date?
    public var lastFailure: CaptureFailure?

    public init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        source: CaptureSource,
        intent: CaptureIntent,
        status: CaptureStatus = .staged,
        payloads: [CapturePayload],
        suggestions: [CaptureSuggestion] = [],
        originalStorageConsent: CaptureConsent,
        originalPolicy: CaptureOriginalPolicy = .includeOriginals,
        containsSensitiveData: Bool = false
    ) {
        let canonicalCreatedAt = Date(
            timeIntervalSince1970: floor(createdAt.timeIntervalSince1970)
        )
        self.schemaVersion = Self.currentSchemaVersion
        self.id = id
        self.idempotencyKey = "capture.v1.\(id.uuidString.lowercased())"
        self.createdAt = canonicalCreatedAt
        self.updatedAt = canonicalCreatedAt
        self.source = source
        self.intent = intent
        self.status = status
        self.payloads = payloads
        self.suggestions = suggestions
        self.originalStorageConsent = originalStorageConsent
        self.originalPolicy = originalPolicy
        self.containsSensitiveData = containsSensitiveData
        self.attemptCount = 0
        self.nextRetryAt = nil
        self.lastFailure = nil
    }

    public var deepLink: URL {
        URL(string: "birdie://capture/\(id.uuidString.lowercased())")!
    }
}

public enum CaptureCoreError: LocalizedError, Equatable {
    case appGroupUnavailable(String)
    case invalidPayload(String)
    case itemNotFound(UUID)
    case unsafeRelativePath(String)
    case unsupportedSchema(Int)
    case idempotencyConflict(UUID)
    case itemCancelled(UUID)

    public var errorDescription: String? {
        switch self {
        case .appGroupUnavailable(let identifier):
            "Der gemeinsame Birdie-Speicher ist nicht verfügbar (\(identifier))."
        case .invalidPayload(let reason):
            "Der Inhalt konnte nicht übernommen werden: \(reason)"
        case .itemNotFound:
            "Der Capture-Eintrag wurde nicht gefunden."
        case .unsafeRelativePath:
            "Ein unsicherer Dateipfad wurde abgelehnt."
        case .unsupportedSchema(let version):
            "Capture-Schema \(version) wird nicht unterstützt."
        case .idempotencyConflict:
            "Ein Capture-Eintrag mit derselben ID hat einen anderen Idempotenzschlüssel."
        case .itemCancelled:
            "Dieser Capture-Eintrag wurde gelöscht."
        }
    }
}
