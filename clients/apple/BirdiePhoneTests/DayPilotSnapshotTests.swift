import XCTest
@testable import BirdiePhone

@MainActor
final class DayPilotSnapshotTests: XCTestCase {
    func testSnapshotSelectsNextTaskAndEvent() {
        let now = Date(timeIntervalSince1970: 1_000)
        let task = DayPilotItem(id: "task", kind: .task, title: "Antworten", date: now.addingTimeInterval(60))
        let event = DayPilotItem(id: "event", kind: .calendar, title: "Termin", date: now.addingTimeInterval(120))

        let snapshot = DayPilotViewModel.makeSnapshot(events: [event], reminders: [task], now: now)

        XCTAssertEqual(snapshot.nextTask, task)
        XCTAssertEqual(snapshot.nextEvent, event)
        XCTAssertEqual(snapshot.openReminderCount, 1)
        XCTAssertEqual(snapshot.openApprovalCount, 0)
        XCTAssertNil(snapshot.nextApproval)
    }

    func testRestProfileRedactsSensitiveTitlesButDoesNotAuthorizeAnything() {
        let snapshot = DayPilotSnapshot(
            generatedAt: .now,
            nextTask: DayPilotItem(id: "t", kind: .task, title: "Geheime Aufgabe", date: nil),
            nextEvent: DayPilotItem(id: "e", kind: .calendar, title: "Privater Termin", date: nil),
            openReminderCount: 1,
            openApprovalCount: 1,
            nextApproval: DayPilotApproval(id: "a", title: "Mail freigeben", detail: "An Alex"),
            briefing: "Sensible Lage"
        )

        let rest = snapshot.displayed(for: .rest)
        XCTAssertEqual(rest.nextTask?.title, "Aufgabe für später")
        XCTAssertEqual(rest.nextEvent?.title, "Termin geplant")
        XCTAssertEqual(rest.nextApproval?.title, "Freigabe wartet")
        XCTAssertEqual(rest.openApprovalCount, snapshot.openApprovalCount)
        XCTAssertEqual(
            BirdieActionCatalog.contract(for: .captureThought).requiresInAppConfirmation,
            true
        )
    }

    func testSnapshotStoreRoundTrip() throws {
        let suite = "birdie.snapshot-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = DayPilotSnapshotStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 42)
        let snapshot = DayPilotSnapshot.placeholder(now: now)

        store.save(snapshot)

        XCTAssertEqual(store.load(now: now), snapshot)
    }

    func testRemoteDayPilotDataMergesIntoLocalSnapshot() {
        let now = Date(timeIntervalSince1970: 1_000)
        let remote = DayPilotRemoteSnapshot(
            generatedAt: now,
            nextTask: DayPilotRemoteTask(
                id: "remote-task",
                title: "Remote-Aufgabe",
                dueAt: now.addingTimeInterval(60)
            ),
            briefing: "Remote-Briefing",
            openApprovals: [
                DayPilotApproval(id: "approval-1", title: "Prüfen", detail: "Vor dem Senden"),
                DayPilotApproval(id: "approval-2", title: "\u{202E}", detail: "")
            ]
        )

        let snapshot = DayPilotViewModel.makeSnapshot(
            events: [],
            reminders: [DayPilotItem(id: "local", kind: .task, title: "Lokal", date: now)],
            now: now,
            remote: remote
        )

        XCTAssertEqual(snapshot.nextTask?.id, "remote-task")
        XCTAssertEqual(snapshot.briefing, "Remote-Briefing")
        XCTAssertEqual(snapshot.openApprovalCount, 1)
        XCTAssertEqual(snapshot.nextApproval?.id, "approval-1")
    }

    func testRemoteDayPilotContractDecodesServerEnvelopeWithFractionalSeconds() throws {
        let data = Data("""
        {
          "success": true,
          "data": {
            "contractVersion": 1,
            "generatedAt": "2026-08-28T08:00:00.123Z",
            "nextTask": {
              "id": "task-1",
              "title": "Prüfen",
              "dueAt": "2026-08-28T09:30:00.456Z"
            },
            "briefing": "Morgenbriefing",
            "openApprovals": [{ "id": "approval-1", "title": "Freigabe", "detail": "Prüfen" }]
          }
        }
        """.utf8)

        let snapshot = try DayPilotRemoteContract.decode(data)

        XCTAssertEqual(snapshot.contractVersion, 1)
        XCTAssertEqual(snapshot.nextTask?.id, "task-1")
        let dueAt = try XCTUnwrap(snapshot.nextTask?.dueAt)
        XCTAssertEqual(dueAt.timeIntervalSince1970, 1_787_909_400.456, accuracy: 0.001)
        XCTAssertEqual(snapshot.openApprovals.count, 1)
    }

    func testRemoteDayPilotContractAlsoAcceptsWholeSeconds() throws {
        let data = Data("""
        {
          "success": true,
          "data": {
            "contractVersion": 1,
            "generatedAt": "2026-08-28T08:00:00Z",
            "nextTask": null,
            "briefing": "Morgenbriefing",
            "openApprovals": []
          }
        }
        """.utf8)

        let snapshot = try DayPilotRemoteContract.decode(data)

        XCTAssertEqual(snapshot.contractVersion, 1)
        XCTAssertNil(snapshot.nextTask)
    }

    func testRefreshPublishesLocalDataWhenRemoteLoadFails() async throws {
        let suite = "birdie.remote-failure-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = DayPilotSnapshotStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 2_000)
        let localTask = DayPilotItem(
            id: "local-task",
            kind: .task,
            title: "Lokale Erinnerung",
            date: now.addingTimeInterval(60)
        )
        let localEvent = DayPilotItem(
            id: "local-event",
            kind: .calendar,
            title: "Lokaler Termin",
            date: now.addingTimeInterval(120)
        )
        let eventStore = StubDayPilotEventStore(events: [localEvent], reminders: [localTask])
        let remote = SequencedRemoteProvider(snapshot: nil)
        let viewModel = DayPilotViewModel(
            eventStore: eventStore,
            remoteProvider: remote,
            snapshotStore: store,
            now: { now }
        )

        await viewModel.refresh()

        XCTAssertEqual(viewModel.snapshot.nextTask, localTask)
        XCTAssertEqual(viewModel.snapshot.nextEvent, localEvent)
        XCTAssertEqual(viewModel.snapshot.openReminderCount, 1)
        XCTAssertEqual(viewModel.statusMessage, RemoteFailure.unavailable.localizedDescription)
        XCTAssertEqual(store.load(now: now), viewModel.snapshot)
    }

    func testRefreshRetainsLastRemoteContributionAfterTransientFailure() async throws {
        let suite = "birdie.remote-retention-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = DayPilotSnapshotStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 3_000)
        let remoteSnapshot = DayPilotRemoteSnapshot(
            generatedAt: now,
            nextTask: DayPilotRemoteTask(id: "remote-task", title: "Remote-Aufgabe", dueAt: nil),
            briefing: "Remote-Briefing",
            openApprovals: [DayPilotApproval(id: "approval", title: "Prüfen", detail: "Vor Freigabe")]
        )
        let eventStore = StubDayPilotEventStore(
            events: [],
            reminders: [DayPilotItem(id: "local-1", kind: .task, title: "Lokal eins", date: nil)]
        )
        let remote = SequencedRemoteProvider(snapshot: remoteSnapshot)
        let viewModel = DayPilotViewModel(
            eventStore: eventStore,
            remoteProvider: remote,
            snapshotStore: store,
            now: { now }
        )

        await viewModel.refresh()
        eventStore.events = [
            DayPilotItem(id: "local-event", kind: .calendar, title: "Neuer Termin", date: now)
        ]
        eventStore.reminders = [
            DayPilotItem(id: "local-2", kind: .task, title: "Lokal zwei", date: nil),
            DayPilotItem(id: "local-3", kind: .task, title: "Lokal drei", date: nil)
        ]

        await viewModel.refresh()

        XCTAssertEqual(viewModel.snapshot.nextTask?.id, "remote-task")
        XCTAssertEqual(viewModel.snapshot.nextEvent?.id, "local-event")
        XCTAssertEqual(viewModel.snapshot.openReminderCount, 2)
        XCTAssertEqual(viewModel.snapshot.nextApproval?.id, "approval")
        XCTAssertEqual(viewModel.snapshot.briefing, "Remote-Briefing")
        XCTAssertEqual(viewModel.statusMessage, RemoteFailure.unavailable.localizedDescription)
    }
}

private enum RemoteFailure: LocalizedError {
    case unavailable

    var errorDescription: String? { "Remote vorübergehend nicht erreichbar." }
}

private actor SequencedRemoteProvider: DayPilotRemoteProviding {
    private let snapshot: DayPilotRemoteSnapshot?
    private var requestCount = 0

    init(snapshot: DayPilotRemoteSnapshot?) {
        self.snapshot = snapshot
    }

    func load() async throws -> DayPilotRemoteSnapshot {
        requestCount += 1
        guard requestCount == 1, let snapshot else {
            throw RemoteFailure.unavailable
        }
        return snapshot
    }
}

@MainActor
private final class StubDayPilotEventStore: DayPilotEventProviding {
    var calendarAccess: DayPilotAccessState = .granted
    var reminderAccess: DayPilotAccessState = .granted
    var events: [DayPilotItem]
    var reminders: [DayPilotItem]

    init(events: [DayPilotItem], reminders: [DayPilotItem]) {
        self.events = events
        self.reminders = reminders
    }

    func requestCalendarAccess() async throws -> Bool { true }
    func requestReminderAccess() async throws -> Bool { true }

    func load(now: Date) async -> (events: [DayPilotItem], reminders: [DayPilotItem]) {
        (events, reminders)
    }

    func prepareProposal(
        kind: DayPilotProposal.Kind,
        title: String,
        date: Date
    ) throws -> DayPilotProposal {
        throw DayPilotEventStoreError.invalidProposal
    }

    func applyConfirmed(_ proposal: DayPilotProposal) throws {
        throw DayPilotEventStoreError.invalidProposal
    }
}
