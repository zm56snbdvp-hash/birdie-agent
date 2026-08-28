import AppIntents
import Foundation

/// Stable public identifiers used by Siri, Shortcuts, controls, widgets, and deep links.
public enum BirdieActionKind: String, Codable, CaseIterable, Hashable, Sendable {
    case ask
    case captureThought = "capture-thought"
    case briefing
    case nextStep = "next-step"

    public static let contractVersion = 1
}

public enum BirdieActionRisk: String, Codable, Hashable, Sendable {
    case readOnly
    case stagedExternalAction
    case stagedWrite
}

public struct BirdieActionContract: Codable, Hashable, Sendable {
    public let kind: BirdieActionKind
    public let title: String
    public let subtitle: String
    public let systemImageName: String
    public let risk: BirdieActionRisk
    public let requiresInAppConfirmation: Bool
    public let allowsDirectIntentExecution: Bool

    public init(
        kind: BirdieActionKind,
        title: String,
        subtitle: String,
        systemImageName: String,
        risk: BirdieActionRisk,
        requiresInAppConfirmation: Bool,
        allowsDirectIntentExecution: Bool = false
    ) {
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.systemImageName = systemImageName
        self.risk = risk
        self.requiresInAppConfirmation = requiresInAppConfirmation
        self.allowsDirectIntentExecution = allowsDirectIntentExecution
    }
}

public enum BirdieActionCatalog {
    public static let contracts: [BirdieActionContract] = [
        BirdieActionContract(
            kind: .ask,
            title: "Birdie fragen",
            subtitle: "Frage prüfen und erst in der App senden",
            systemImageName: "bubble.left.and.text.bubble.right",
            risk: .stagedExternalAction,
            requiresInAppConfirmation: true
        ),
        BirdieActionContract(
            kind: .captureThought,
            title: "Gedanke merken",
            subtitle: "Entwurf prüfen und erst in der App speichern",
            systemImageName: "square.and.pencil",
            risk: .stagedWrite,
            requiresInAppConfirmation: true
        ),
        BirdieActionContract(
            kind: .briefing,
            title: "Briefing",
            subtitle: "Day Pilot schreibgeschützt öffnen",
            systemImageName: "sun.horizon",
            risk: .readOnly,
            requiresInAppConfirmation: false
        ),
        BirdieActionContract(
            kind: .nextStep,
            title: "Nächster Schritt",
            subtitle: "Den aktuell wichtigsten Schritt anzeigen",
            systemImageName: "arrow.forward.circle",
            risk: .readOnly,
            requiresInAppConfirmation: false
        )
    ]

    public static func contract(for kind: BirdieActionKind) -> BirdieActionContract {
        guard let contract = contracts.first(where: { $0.kind == kind }) else {
            preconditionFailure("Every public Birdie action requires a contract")
        }
        return contract
    }
}

/// The discoverable entity contract intentionally exposes only shipping actions.
public struct BirdieActionEntity: AppEntity, Hashable, Sendable {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Birdie Aktion")
    public static let defaultQuery = BirdieActionEntityQuery()

    public let id: String
    public let kind: BirdieActionKind

    public init(kind: BirdieActionKind) {
        self.id = kind.rawValue
        self.kind = kind
    }

    public var displayRepresentation: DisplayRepresentation {
        switch kind {
        case .ask:
            DisplayRepresentation(title: "Birdie fragen", subtitle: "Sichere Vorschau in der App")
        case .captureThought:
            DisplayRepresentation(title: "Gedanke merken", subtitle: "Erst nach Bestätigung speichern")
        case .briefing:
            DisplayRepresentation(title: "Briefing", subtitle: "Day Pilot öffnen")
        case .nextStep:
            DisplayRepresentation(title: "Nächster Schritt", subtitle: "Priorität anzeigen")
        }
    }
}

public struct BirdieActionEntityQuery: EntityQuery, Sendable {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [BirdieActionEntity] {
        identifiers.compactMap(BirdieActionKind.init(rawValue:)).map(BirdieActionEntity.init)
    }

    public func suggestedEntities() async throws -> [BirdieActionEntity] {
        BirdieActionKind.allCases.map(BirdieActionEntity.init)
    }
}
