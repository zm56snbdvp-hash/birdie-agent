import XCTest
@testable import BirdiePhone

@MainActor
final class DayPilotPermissionTests: XCTestCase {
    func testCalendarAndReminderPermissionsAreRequestedSeparately() async throws {
        let provider = EventProviderSpy()
        let fixture = try makeModel(provider: provider)
        defer { fixture.cleanup() }

        await fixture.model.requestCalendarAccess()
        XCTAssertEqual(provider.calendarRequests, 1)
        XCTAssertEqual(provider.reminderRequests, 0)

        await fixture.model.requestReminderAccess()
        XCTAssertEqual(provider.calendarRequests, 1)
        XCTAssertEqual(provider.reminderRequests, 1)
    }

    func testProposalOnlyWritesThroughExplicitConfirmedEntryPoint() async throws {
        let provider = EventProviderSpy()
        provider.calendarAccess = .granted
        let fixture = try makeModel(provider: provider)
        defer { fixture.cleanup() }
        let proposal = try provider.prepareProposal(
            kind: .event,
            title: "Bestätigter Termin",
            date: Date(timeIntervalSince1970: 100)
        )

        XCTAssertEqual(provider.appliedProposals.count, 0)
        let applied = await fixture.model.applyConfirmed(proposal)
        XCTAssertTrue(applied)
        XCTAssertEqual(provider.appliedProposals, [proposal])
    }

    private func makeModel(provider: EventProviderSpy) throws -> (
        model: DayPilotViewModel,
        cleanup: () -> Void
    ) {
        let suite = "birdie.permission-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = DayPilotSnapshotStore(defaults: defaults)
        return (
            DayPilotViewModel(eventStore: provider, snapshotStore: store),
            { defaults.removePersistentDomain(forName: suite) }
        )
    }
}

@MainActor
private final class EventProviderSpy: DayPilotEventProviding {
    var calendarAccess: DayPilotAccessState = .notDetermined
    var reminderAccess: DayPilotAccessState = .notDetermined
    var calendarRequests = 0
    var reminderRequests = 0
    var appliedProposals = [DayPilotProposal]()

    func prepareProposal(
        kind: DayPilotProposal.Kind,
        title: String,
        date: Date
    ) throws -> DayPilotProposal {
        DayPilotProposal(
            kind: kind,
            title: title,
            date: date,
            endDate: kind == .event ? date.addingTimeInterval(3_600) : nil,
            timeZoneIdentifier: "UTC",
            destinationCalendarIdentifier: "test-calendar",
            destinationCalendarTitle: "Testkalender"
        )
    }

    func requestCalendarAccess() async throws -> Bool {
        calendarRequests += 1
        calendarAccess = .granted
        return true
    }

    func requestReminderAccess() async throws -> Bool {
        reminderRequests += 1
        reminderAccess = .granted
        return true
    }

    func load(now: Date) async -> (events: [DayPilotItem], reminders: [DayPilotItem]) {
        ([], [])
    }

    func applyConfirmed(_ proposal: DayPilotProposal) throws {
        appliedProposals.append(proposal)
    }
}
