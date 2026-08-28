import EventKit
import Foundation

enum DayPilotAccessState: Equatable {
    case notDetermined
    case granted
    case denied
    case restricted
    case writeOnly

    var title: String {
        switch self {
        case .notDetermined: "Noch nicht angefragt"
        case .granted: "Freigegeben"
        case .denied: "Abgelehnt"
        case .restricted: "Eingeschränkt"
        case .writeOnly: "Nur Schreiben erlaubt"
        }
    }
}

enum DayPilotEventStoreError: LocalizedError {
    case accessRequired(String)
    case missingCalendar
    case destinationUnavailable
    case invalidProposal

    var errorDescription: String? {
        switch self {
        case .accessRequired(let resource):
            "Für \(resource) fehlt die ausdrücklich erteilte Berechtigung."
        case .missingCalendar:
            "Es ist kein beschreibbarer Standardkalender verfügbar."
        case .destinationUnavailable:
            "Das in der Vorschau bestätigte Ziel ist nicht mehr verfügbar. Bitte erstelle eine neue Vorschau."
        case .invalidProposal:
            "Der Vorschlag ist unvollständig oder ungültig."
        }
    }
}

@MainActor
protocol DayPilotEventProviding: AnyObject {
    var calendarAccess: DayPilotAccessState { get }
    var reminderAccess: DayPilotAccessState { get }

    func requestCalendarAccess() async throws -> Bool
    func requestReminderAccess() async throws -> Bool
    func load(now: Date) async -> (events: [DayPilotItem], reminders: [DayPilotItem])
    func prepareProposal(kind: DayPilotProposal.Kind, title: String, date: Date) throws -> DayPilotProposal
    func applyConfirmed(_ proposal: DayPilotProposal) throws
}

@MainActor
final class DayPilotEventStore: DayPilotEventProviding {
    private let store: EKEventStore
    private let calendar: Calendar

    init(store: EKEventStore = EKEventStore(), calendar: Calendar = .current) {
        self.store = store
        self.calendar = calendar
    }

    var calendarAccess: DayPilotAccessState {
        Self.accessState(for: EKEventStore.authorizationStatus(for: .event))
    }

    var reminderAccess: DayPilotAccessState {
        Self.accessState(for: EKEventStore.authorizationStatus(for: .reminder))
    }

    func requestCalendarAccess() async throws -> Bool {
        try await store.requestFullAccessToEvents()
    }

    func requestReminderAccess() async throws -> Bool {
        try await store.requestFullAccessToReminders()
    }

    func load(now: Date = Date()) async -> (events: [DayPilotItem], reminders: [DayPilotItem]) {
        let events = calendarAccess == .granted ? loadEvents(now: now) : []
        let reminders = reminderAccess == .granted ? await loadReminders() : []
        return (events, reminders)
    }

    func prepareProposal(
        kind: DayPilotProposal.Kind,
        title: String,
        date: Date
    ) throws -> DayPilotProposal {
        guard let cleanTitle = BirdieRoute.sanitizedDraft(title) else {
            throw DayPilotEventStoreError.invalidProposal
        }

        let destination: EKCalendar
        let endDate: Date?

        switch kind {
        case .event:
            guard calendarAccess.allowsWrites else {
                throw DayPilotEventStoreError.accessRequired("Kalender")
            }
            guard let calendar = store.defaultCalendarForNewEvents else {
                throw DayPilotEventStoreError.missingCalendar
            }
            destination = calendar
            endDate = self.calendar.date(byAdding: .hour, value: 1, to: date)
                ?? date.addingTimeInterval(3_600)

        case .reminder:
            guard reminderAccess.allowsWrites else {
                throw DayPilotEventStoreError.accessRequired("Erinnerungen")
            }
            guard let calendar = store.defaultCalendarForNewReminders() else {
                throw DayPilotEventStoreError.missingCalendar
            }
            destination = calendar
            endDate = nil
        }

        guard destination.allowsContentModifications else {
            throw DayPilotEventStoreError.missingCalendar
        }

        return DayPilotProposal(
            kind: kind,
            title: cleanTitle,
            date: date,
            endDate: endDate,
            timeZoneIdentifier: calendar.timeZone.identifier,
            destinationCalendarIdentifier: destination.calendarIdentifier,
            destinationCalendarTitle: destination.title
        )
    }

    func applyConfirmed(_ proposal: DayPilotProposal) throws {
        guard
            !proposal.title.isEmpty,
            !proposal.destinationCalendarIdentifier.isEmpty,
            TimeZone(identifier: proposal.timeZoneIdentifier) != nil,
            let destination = store.calendar(withIdentifier: proposal.destinationCalendarIdentifier),
            destination.allowsContentModifications
        else { throw DayPilotEventStoreError.destinationUnavailable }

        switch proposal.kind {
        case .event:
            guard calendarAccess.allowsWrites else {
                throw DayPilotEventStoreError.accessRequired("Kalender")
            }
            guard let endDate = proposal.endDate, endDate > proposal.date else {
                throw DayPilotEventStoreError.invalidProposal
            }
            let event = EKEvent(eventStore: store)
            event.title = proposal.title
            event.startDate = proposal.date
            event.endDate = endDate
            event.timeZone = TimeZone(identifier: proposal.timeZoneIdentifier)
            event.calendar = destination
            try store.save(event, span: .thisEvent, commit: true)

        case .reminder:
            guard reminderAccess.allowsWrites else {
                throw DayPilotEventStoreError.accessRequired("Erinnerungen")
            }
            guard proposal.endDate == nil else { throw DayPilotEventStoreError.invalidProposal }
            let reminder = EKReminder(eventStore: store)
            reminder.title = proposal.title
            reminder.calendar = destination
            var executionCalendar = calendar
            executionCalendar.timeZone = TimeZone(identifier: proposal.timeZoneIdentifier)!
            reminder.dueDateComponents = executionCalendar.dateComponents(
                [.calendar, .timeZone, .year, .month, .day, .hour, .minute],
                from: proposal.date
            )
            try store.save(reminder, commit: true)
        }
    }

    private func loadEvents(now: Date) -> [DayPilotItem] {
        let end = calendar.date(byAdding: .day, value: 2, to: now) ?? now.addingTimeInterval(172_800)
        let predicate = store.predicateForEvents(withStart: now, end: end, calendars: nil)
        return store.events(matching: predicate)
            .filter { !$0.isAllDay || $0.endDate >= now }
            .sorted { $0.startDate < $1.startDate }
            .map {
                DayPilotItem(
                    id: $0.eventIdentifier ?? UUID().uuidString,
                    kind: .calendar,
                    title: $0.title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                        ?? "Termin",
                    date: $0.startDate
                )
            }
    }

    private func loadReminders() async -> [DayPilotItem] {
        let predicate = store.predicateForIncompleteReminders(
            withDueDateStarting: nil,
            ending: nil,
            calendars: nil
        )
        let reminders: [EKReminder] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { values in
                continuation.resume(returning: values ?? [])
            }
        }
        return reminders
            .map { reminder in
                DayPilotItem(
                    id: reminder.calendarItemIdentifier,
                    kind: .task,
                    title: reminder.title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                        ?? "Erinnerung",
                    date: reminder.dueDateComponents.flatMap { calendar.date(from: $0) }
                )
            }
            .sorted {
                switch ($0.date, $1.date) {
                case let (left?, right?): left < right
                case (_?, nil): true
                case (nil, _?): false
                case (nil, nil): $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
            }
    }

    private static func accessState(for status: EKAuthorizationStatus) -> DayPilotAccessState {
        switch status {
        case .notDetermined: .notDetermined
        case .fullAccess, .authorized: .granted
        case .writeOnly: .writeOnly
        case .denied: .denied
        case .restricted: .restricted
        @unknown default: .denied
        }
    }
}

private extension DayPilotAccessState {
    var allowsWrites: Bool {
        self == .granted || self == .writeOnly
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
