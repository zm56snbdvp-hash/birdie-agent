import Foundation

// MARK: - Versioned Birdie Drop intake contract

/// The only origins accepted by Birdie Recall V1. Both require an explicit user action.
public enum RecallIntakeChannelV1: String, Codable, CaseIterable, Hashable, Sendable {
    case manualSelection
    case birdieDrop

    public var displayName: String {
        switch self {
        case .manualSelection: "Manuell ausgewählt"
        case .birdieDrop: "Birdie Drop"
        }
    }
}

public enum RecallItemKindV1: String, Codable, CaseIterable, Hashable, Sendable {
    case link
    case screenshot
    case photo
    case pdf
    case note

    public var displayName: String {
        switch self {
        case .link: "Link"
        case .screenshot: "Screenshot"
        case .photo: "Foto"
        case .pdf: "PDF"
        case .note: "Notiz"
        }
    }

    public var systemImage: String {
        switch self {
        case .link: "link"
        case .screenshot: "rectangle.inset.filled.and.person.filled"
        case .photo: "photo"
        case .pdf: "doc.richtext"
        case .note: "note.text"
        }
    }
}

public struct RecallProvenanceV1: Codable, Hashable, Sendable {
    public let channel: RecallIntakeChannelV1
    public let sourceApplication: String?
    public let sourceItemIdentifier: String?
    public let submittedAt: Date

    public init(
        channel: RecallIntakeChannelV1,
        sourceApplication: String? = nil,
        sourceItemIdentifier: String? = nil,
        submittedAt: Date = Date()
    ) {
        self.channel = channel
        self.sourceApplication = sourceApplication
        self.sourceItemIdentifier = sourceItemIdentifier
        self.submittedAt = submittedAt
    }
}

public enum RecallRetentionRequestV1: Codable, Hashable, Sendable {
    case defaultPolicy
    case keepForever
    case until(Date)
}

/// A deliberately small hand-off object. `localFileURL` must point to a user-selected local file.
/// Birdie Recall copies it into protected app storage and never uploads it.
public struct CaptureItemV1: Codable, Hashable, Identifiable, Sendable {
    public static let currentContractVersion = 1

    public let contractVersion: Int
    public let id: UUID
    public let kind: RecallItemKindV1
    public let title: String
    public let provenance: RecallProvenanceV1
    public let capturedAt: Date
    public let tags: [String]
    public let note: String?
    public let linkURL: URL?
    public let localFileURL: URL?
    public let contentTypeIdentifier: String?
    public let extractedText: String?
    public let summary: String?
    public let retention: RecallRetentionRequestV1

    public init(
        contractVersion: Int = CaptureItemV1.currentContractVersion,
        id: UUID = UUID(),
        kind: RecallItemKindV1,
        title: String,
        provenance: RecallProvenanceV1,
        capturedAt: Date = Date(),
        tags: [String] = [],
        note: String? = nil,
        linkURL: URL? = nil,
        localFileURL: URL? = nil,
        contentTypeIdentifier: String? = nil,
        extractedText: String? = nil,
        summary: String? = nil,
        retention: RecallRetentionRequestV1 = .defaultPolicy
    ) {
        self.contractVersion = contractVersion
        self.id = id
        self.kind = kind
        self.title = title
        self.provenance = provenance
        self.capturedAt = capturedAt
        self.tags = tags
        self.note = note
        self.linkURL = linkURL
        self.localFileURL = localFileURL
        self.contentTypeIdentifier = contentTypeIdentifier
        self.extractedText = extractedText
        self.summary = summary
        self.retention = retention
    }
}

public protocol BirdieRecallIntakeV1: Sendable {
    @discardableResult
    func ingest(_ capture: CaptureItemV1) async throws -> RecallItemV1
}

// MARK: - Stored item and privacy metadata

public enum RecallRetentionStatusV1: String, Codable, Hashable, Sendable {
    case kept
    case expires
    case pendingDeletion
}

public struct RecallRetentionV1: Codable, Hashable, Sendable {
    public let status: RecallRetentionStatusV1
    public let expiresAt: Date?

    public init(status: RecallRetentionStatusV1, expiresAt: Date?) {
        self.status = status
        self.expiresAt = expiresAt
    }
}

public struct RecallAttachmentMetadataV1: Codable, Hashable, Sendable {
    public let originalFilename: String
    public let contentTypeIdentifier: String
    public let byteCount: Int64
    public let sha256: String

    public init(
        originalFilename: String,
        contentTypeIdentifier: String,
        byteCount: Int64,
        sha256: String
    ) {
        self.originalFilename = originalFilename
        self.contentTypeIdentifier = contentTypeIdentifier
        self.byteCount = byteCount
        self.sha256 = sha256
    }
}

public struct RecallItemV1: Codable, Hashable, Identifiable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let id: UUID
    public let kind: RecallItemKindV1
    public let title: String
    public let provenance: RecallProvenanceV1
    public let capturedAt: Date
    public let createdAt: Date
    public let tags: [String]
    public let note: String?
    public let linkURL: URL?
    public let extractedText: String?
    public let summary: String?
    public var retention: RecallRetentionV1
    public let attachment: RecallAttachmentMetadataV1?

    public var deepLinkURL: URL {
        URL(string: "birdie://recall/item/\(id.uuidString.lowercased())")!
    }
}

public struct RecallSettingsV1: Codable, Hashable, Sendable {
    public static let defaultRetentionDays = 30

    public var isEnabled: Bool
    /// Core Spotlight is private/local but remains an explicit opt-in surface.
    public var isSpotlightEnabled: Bool
    /// `nil` means keep forever; otherwise the value is constrained to 1...3650 days.
    public var defaultRetentionDays: Int?
    public var changedAt: Date

    public init(
        isEnabled: Bool = true,
        isSpotlightEnabled: Bool = false,
        defaultRetentionDays: Int? = RecallSettingsV1.defaultRetentionDays,
        changedAt: Date = Date()
    ) {
        self.isEnabled = isEnabled
        self.isSpotlightEnabled = isSpotlightEnabled
        self.defaultRetentionDays = defaultRetentionDays
        self.changedAt = changedAt
    }
}

// MARK: - Search contract

public struct RecallSearchFiltersV1: Codable, Hashable, Sendable {
    public var sourceChannels: Set<RecallIntakeChannelV1>
    public var kinds: Set<RecallItemKindV1>
    public var capturedFrom: Date?
    /// Exclusive upper date bound.
    public var capturedBefore: Date?

    public init(
        sourceChannels: Set<RecallIntakeChannelV1> = [],
        kinds: Set<RecallItemKindV1> = [],
        capturedFrom: Date? = nil,
        capturedBefore: Date? = nil
    ) {
        self.sourceChannels = sourceChannels
        self.kinds = kinds
        self.capturedFrom = capturedFrom
        self.capturedBefore = capturedBefore
    }
}

public struct RecallSearchQueryV1: Codable, Hashable, Sendable {
    public static let currentContractVersion = 1

    public let contractVersion: Int
    public var text: String
    public var filters: RecallSearchFiltersV1
    public var limit: Int

    public init(
        contractVersion: Int = RecallSearchQueryV1.currentContractVersion,
        text: String,
        filters: RecallSearchFiltersV1 = RecallSearchFiltersV1(),
        limit: Int = 50
    ) {
        self.contractVersion = contractVersion
        self.text = text
        self.filters = filters
        self.limit = limit
    }
}

public struct RecallSearchResultV1: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID { item.id }
    public let item: RecallItemV1
    public let score: Double
    public let matchedTerms: [String]

    public init(item: RecallItemV1, score: Double, matchedTerms: [String]) {
        self.item = item
        self.score = score
        self.matchedTerms = matchedTerms
    }
}

public protocol BirdieRecallSearchV1: Sendable {
    func search(_ query: RecallSearchQueryV1) async throws -> [RecallSearchResultV1]
}

// MARK: - Deletion and export contracts

public enum RecallDeletionScopeV1: String, Codable, Hashable, Sendable {
    case singleItem
    case selectedItems
    case expiredItems
    case allItems
    case killSwitch
}

public struct RecallDeletionReceiptV1: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let operationIdentifier: UUID
    public let scope: RecallDeletionScopeV1
    public let reason: String
    public let requestedAt: Date
    public let completedAt: Date
    public let itemIdentifiers: [UUID]

    public var deletedItemCount: Int { itemIdentifiers.count }
}

public struct RecallExportManifestV1: Codable, Hashable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let exportedAt: Date
    public let settings: RecallSettingsV1
    public let items: [RecallItemV1]
    public let deletionReceipts: [RecallDeletionReceiptV1]
    /// Item ID to attachment key in `RecallPortableExportV1.attachments`.
    public let attachmentKeys: [String: String]
}

/// User-initiated, portable JSON export. Attachment values are base64 encoded by JSONEncoder.
public struct RecallPortableExportV1: Codable, Hashable, Sendable {
    public let manifest: RecallExportManifestV1
    public let attachments: [String: Data]
}

public enum BirdieRecallError: LocalizedError, Equatable, Sendable {
    case invalidContractVersion(Int)
    case disabled
    case invalidPayload(String)
    case unsupportedLinkScheme
    case sourceFileUnavailable
    case attachmentTooLarge(Int64)
    case duplicateConflict(UUID)
    case itemNotFound(UUID)
    case invalidRetention
    case intakeInterrupted
    case persistence(String)
    case externalIndexCleanup(String)

    public var errorDescription: String? {
        switch self {
        case .invalidContractVersion(let version):
            "Nicht unterstützte Recall-Vertragsversion: \(version)."
        case .disabled:
            "Birdie Recall ist vollständig ausgeschaltet."
        case .invalidPayload(let message):
            "Ungültiger Recall-Inhalt: \(message)"
        case .unsupportedLinkScheme:
            "Recall akzeptiert für Links nur http oder https."
        case .sourceFileUnavailable:
            "Die bewusst ausgewählte Datei ist nicht mehr verfügbar."
        case .attachmentTooLarge(let bytes):
            "Die Datei ist mit \(bytes) Bytes größer als das lokale 100-MB-Limit."
        case .duplicateConflict(let id):
            "Die stabile Recall-ID \(id.uuidString) gehört bereits zu einem anderen Inhalt."
        case .itemNotFound(let id):
            "Das Recall-Element \(id.uuidString) wurde nicht gefunden."
        case .invalidRetention:
            "Die Aufbewahrungsdauer muss zwischen 1 und 3650 Tagen liegen."
        case .intakeInterrupted:
            "Recall wurde während der lokalen Übernahme geändert. Bitte den bewusst ausgewählten Inhalt erneut übergeben."
        case .persistence(let message):
            "Recall konnte lokal nicht sicher gespeichert werden: \(message)"
        case .externalIndexCleanup(let message):
            "Der lokale Systemindex konnte noch nicht vollständig bereinigt werden: \(message)"
        }
    }
}
