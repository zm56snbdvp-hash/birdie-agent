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
}
