import Foundation
import WidgetKit

@MainActor
final class DayPilotViewModel: ObservableObject {
    @Published private(set) var snapshot: DayPilotSnapshot
    @Published private(set) var calendarAccess: DayPilotAccessState
    @Published private(set) var reminderAccess: DayPilotAccessState
    @Published private(set) var isRefreshing = false
    @Published var statusMessage: String?

    private let eventStore: any DayPilotEventProviding
    private let remoteProvider: (any DayPilotRemoteProviding)?
    private let snapshotStore: DayPilotSnapshotStore
    private let now: () -> Date
    private var lastRemoteSnapshot: DayPilotRemoteSnapshot?

    init(
        eventStore: (any DayPilotEventProviding)? = nil,
        remoteProvider: (any DayPilotRemoteProviding)? = nil,
        snapshotStore: DayPilotSnapshotStore = .shared,
        now: @escaping () -> Date = Date.init
    ) {
        let resolvedEventStore = eventStore ?? DayPilotEventStore()
        self.eventStore = resolvedEventStore
        self.remoteProvider = remoteProvider
        self.snapshotStore = snapshotStore
        self.now = now
        snapshot = snapshotStore.load(now: now())
        calendarAccess = resolvedEventStore.calendarAccess
        reminderAccess = resolvedEventStore.reminderAccess
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        calendarAccess = eventStore.calendarAccess
        reminderAccess = eventStore.reminderAccess
        let data = await eventStore.load(now: now())
        var remote = lastRemoteSnapshot
        if let remoteProvider {
            do {
                let loadedRemote = try await remoteProvider.load()
                lastRemoteSnapshot = loadedRemote
                remote = loadedRemote
            } catch BirdieAgentClientError.notAuthenticated {
                // EventKit remains useful without a configured remote token.
                lastRemoteSnapshot = nil
                remote = nil
            } catch {
                statusMessage = error.localizedDescription
                // A transient remote failure must never hide freshly loaded EventKit data.
                // Keep the last valid remote contribution when one exists and still publish
                // the current local calendar and reminder state below.
            }
        }
        snapshot = Self.makeSnapshot(
            events: data.events,
            reminders: data.reminders,
            now: now(),
            remote: remote
        )
        snapshotStore.save(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: DayPilotWidgetContract.kind)
    }

    func requestCalendarAccess() async {
        do {
            let granted = try await eventStore.requestCalendarAccess()
            statusMessage = granted ? "Kalender wurde freigegeben." : "Kalenderzugriff wurde nicht freigegeben."
        } catch {
            statusMessage = error.localizedDescription
        }
        await refresh()
    }

    func requestReminderAccess() async {
        do {
            let granted = try await eventStore.requestReminderAccess()
            statusMessage = granted ? "Erinnerungen wurden freigegeben." : "Erinnerungszugriff wurde nicht freigegeben."
        } catch {
            statusMessage = error.localizedDescription
        }
        await refresh()
    }

    func prepareProposal(
        kind: DayPilotProposal.Kind,
        title: String,
        date: Date
    ) throws -> DayPilotProposal {
        try eventStore.prepareProposal(kind: kind, title: title, date: date)
    }

    func applyConfirmed(_ proposal: DayPilotProposal) async -> Bool {
        do {
            try eventStore.applyConfirmed(proposal)
            statusMessage = "\(proposal.kind.title) wurde nach deiner Bestätigung angelegt."
            await refresh()
            return true
        } catch {
            statusMessage = error.localizedDescription
            return false
        }
    }

    static func makeSnapshot(
        events: [DayPilotItem],
        reminders: [DayPilotItem],
        now: Date,
        remote: DayPilotRemoteSnapshot? = nil
    ) -> DayPilotSnapshot {
        let remoteTask = remote?.nextTask.flatMap { task -> DayPilotItem? in
            guard let title = BirdieRoute.sanitizedDraft(task.title), !task.id.isEmpty else { return nil }
            return DayPilotItem(id: task.id, kind: .task, title: title, date: task.dueAt)
        }
        let remoteApprovals = (remote?.openApprovals ?? []).compactMap { approval -> DayPilotApproval? in
            guard
                !approval.id.isEmpty,
                let title = BirdieRoute.sanitizedDraft(approval.title),
                let detail = BirdieRoute.sanitizedDraft(approval.detail)
            else { return nil }
            return DayPilotApproval(id: approval.id, title: title, detail: detail)
        }
        let nextTask = remoteTask ?? reminders.first
        let nextEvent = events.first
        let briefing: String

        if let remoteBriefing = remote?.briefing,
           let cleanBriefing = BirdieRoute.sanitizedDraft(remoteBriefing) {
            briefing = cleanBriefing
        } else if nextTask == nil, nextEvent == nil {
            briefing = "Für die nächsten zwei Tage ist noch nichts Dringendes sichtbar."
        } else {
            var parts = [String]()
            if let nextTask { parts.append("Nächste Aufgabe: \(nextTask.title).") }
            if let nextEvent { parts.append("Nächster Termin: \(nextEvent.title).") }
            parts.append("\(reminders.count) offene Erinnerungen, keine ungeprüften Freigaben.")
            briefing = parts.joined(separator: " ")
        }

        return DayPilotSnapshot(
            generatedAt: now,
            nextTask: nextTask,
            nextEvent: nextEvent,
            openReminderCount: reminders.count,
            openApprovalCount: remoteApprovals.count,
            nextApproval: remoteApprovals.first,
            briefing: briefing
        )
    }
}
