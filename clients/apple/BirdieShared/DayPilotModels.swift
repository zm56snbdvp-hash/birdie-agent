import AppIntents
import Foundation

public enum BirdieFocusContext: String, Codable, CaseIterable, Hashable, Sendable, AppEnum {
    case work
    case personal
    case rest

    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Birdie Kontext")
    public static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .work: DisplayRepresentation(title: "Arbeit"),
        .personal: DisplayRepresentation(title: "Privat"),
        .rest: DisplayRepresentation(title: "Ruhe")
    ]

    public var title: String {
        switch self {
        case .work: "Arbeit"
        case .personal: "Privat"
        case .rest: "Ruhe"
        }
    }

    public var systemImageName: String {
        switch self {
        case .work: "briefcase"
        case .personal: "house"
        case .rest: "moon.zzz"
        }
    }
}

public enum BirdieFocusStore {
    public static let key = "birdie.focus-context"

    public static var current: BirdieFocusContext {
        get {
            BirdieSharedContainer.defaults.string(forKey: key)
                .flatMap(BirdieFocusContext.init(rawValue:)) ?? .work
        }
        set {
            BirdieSharedContainer.defaults.set(newValue.rawValue, forKey: key)
        }
    }
}

public struct DayPilotItem: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Hashable, Sendable {
        case task
        case calendar
    }

    public let id: String
    public let kind: Kind
    public let title: String
    public let date: Date?

    public init(id: String, kind: Kind, title: String, date: Date?) {
        self.id = id
        self.kind = kind
        self.title = title
        self.date = date
    }
}

public struct DayPilotSnapshot: Codable, Hashable, Sendable {
    public static let contractVersion = 1

    public let generatedAt: Date
    public let nextTask: DayPilotItem?
    public let nextEvent: DayPilotItem?
    public let openReminderCount: Int
    public let openApprovalCount: Int
    public let nextApproval: DayPilotApproval?
    public let briefing: String

    public init(
        generatedAt: Date,
        nextTask: DayPilotItem?,
        nextEvent: DayPilotItem?,
        openReminderCount: Int,
        openApprovalCount: Int,
        nextApproval: DayPilotApproval? = nil,
        briefing: String
    ) {
        self.generatedAt = generatedAt
        self.nextTask = nextTask
        self.nextEvent = nextEvent
        self.openReminderCount = max(0, openReminderCount)
        self.openApprovalCount = max(0, openApprovalCount)
        self.nextApproval = nextApproval
        self.briefing = briefing
    }

    public static func placeholder(now: Date = Date()) -> DayPilotSnapshot {
        DayPilotSnapshot(
            generatedAt: now,
            nextTask: nil,
            nextEvent: nil,
            openReminderCount: 0,
            openApprovalCount: 0,
            nextApproval: nil,
            briefing: "Verbinde Kalender und Erinnerungen einzeln, wenn du sie im Day Pilot sehen möchtest."
        )
    }

    public func displayed(for focus: BirdieFocusContext) -> DayPilotSnapshot {
        if focus == .work { return self }
        if focus == .personal {
            return DayPilotSnapshot(
                generatedAt: generatedAt,
                nextTask: nextTask,
                nextEvent: nextEvent,
                openReminderCount: openReminderCount,
                openApprovalCount: openApprovalCount,
                nextApproval: nextApproval,
                briefing: "Privater Überblick: \(briefing)"
            )
        }
        let task = nextTask.map {
            DayPilotItem(id: $0.id, kind: $0.kind, title: "Aufgabe für später", date: $0.date)
        }
        let event = nextEvent.map {
            DayPilotItem(id: $0.id, kind: $0.kind, title: "Termin geplant", date: $0.date)
        }
        return DayPilotSnapshot(
            generatedAt: generatedAt,
            nextTask: task,
            nextEvent: event,
            openReminderCount: openReminderCount,
            openApprovalCount: openApprovalCount,
            nextApproval: nextApproval.map {
                DayPilotApproval(id: $0.id, title: "Freigabe wartet", detail: "Details in Birdie prüfen")
            },
            briefing: "Ruhemodus: Details bleiben zurückhaltend. Nichts wird dadurch autorisiert."
        )
    }
}

public struct DayPilotApproval: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let detail: String

    public init(id: String, title: String, detail: String) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

public struct DayPilotProposal: Hashable, Identifiable, Sendable {
    public enum Kind: String, CaseIterable, Identifiable, Sendable {
        case event
        case reminder

        public var id: String { rawValue }

        public var title: String {
            switch self {
            case .event: "Termin"
            case .reminder: "Erinnerung"
            }
        }
    }

    public let id: UUID
    public let kind: Kind
    public let title: String
    public let date: Date
    public let endDate: Date?
    public let timeZoneIdentifier: String
    public let destinationCalendarIdentifier: String
    public let destinationCalendarTitle: String

    public init(
        id: UUID = UUID(),
        kind: Kind,
        title: String,
        date: Date,
        endDate: Date?,
        timeZoneIdentifier: String,
        destinationCalendarIdentifier: String,
        destinationCalendarTitle: String
    ) {
        self.id = id
        self.kind = kind
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.date = date
        self.endDate = endDate
        self.timeZoneIdentifier = timeZoneIdentifier
        self.destinationCalendarIdentifier = destinationCalendarIdentifier
        self.destinationCalendarTitle = destinationCalendarTitle
    }
}

public enum DayPilotWidgetContract {
    public static let kind = "de.birdieandbreakfast.birdie.daypilot"
}
