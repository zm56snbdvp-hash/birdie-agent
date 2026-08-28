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

    func testRemoteDayPilotContractDecodesVersionedISO8601Payload() throws {
        let data = Data("""
        {
          "contractVersion": 1,
          "generatedAt": "2026-08-28T08:00:00Z",
          "nextTask": { "id": "task-1", "title": "Prüfen", "dueAt": "2026-08-28T09:30:00Z" },
          "briefing": "Morgenbriefing",
          "openApprovals": [{ "id": "approval-1", "title": "Freigabe", "detail": "Prüfen" }]
        }
        """.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let snapshot = try decoder.decode(DayPilotRemoteSnapshot.self, from: data)

        XCTAssertEqual(snapshot.contractVersion, 1)
        XCTAssertEqual(snapshot.nextTask?.id, "task-1")
        XCTAssertEqual(snapshot.openApprovals.count, 1)
    }
}
