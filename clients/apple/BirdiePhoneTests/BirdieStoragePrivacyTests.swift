import XCTest
@testable import BirdiePhone

final class BirdieStoragePrivacyTests: XCTestCase {
    func testSnapshotStorePurgesExpiredSnapshot() throws {
        let suite = "birdie.snapshot-expiry-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let generatedAt = Date(timeIntervalSince1970: 1_000)
        let now = generatedAt.addingTimeInterval(6 * 60 * 60 + 1)
        let store = DayPilotSnapshotStore(defaults: defaults, maxAge: 6 * 60 * 60)

        store.save(.placeholder(now: generatedAt))
        let loaded = store.load(now: now)

        XCTAssertEqual(loaded.generatedAt, now)
        XCTAssertNil(defaults.object(forKey: "birdie.day-pilot.snapshot.v1"))
    }

    func testSnapshotStorePurgesMalformedRecord() throws {
        let suite = "birdie.snapshot-malformed-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = DayPilotSnapshotStore(defaults: defaults)
        let key = "birdie.day-pilot.snapshot.v1"
        defaults.set(Data("not-json".utf8), forKey: key)

        _ = store.load(now: Date(timeIntervalSince1970: 2_000))

        XCTAssertNil(defaults.object(forKey: key))
    }

    func testConfirmedThoughtSanitizesUnsafeFormatting() throws {
        let suite = "birdie.thought-privacy-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = BirdieThoughtStore(defaults: defaults)

        store.saveConfirmed("\u{202E}  Sicher\u{0000}er Gedanke  \u{2069}")

        XCTAssertEqual(store.recent(limit: 1), ["Sicherer Gedanke"])

        defaults.set(["\u{202E}Alter\u{0000} Eintrag"], forKey: "birdie.confirmed-thoughts.v1")
        XCTAssertEqual(store.recent(limit: 1), ["Alter Eintrag"])
    }
}
