import XCTest
@testable import BirdiePhone

final class BirdieRoutingTests: XCTestCase {
    func testDeepLinkRoundTripPreservesNonSensitivePreviewContextOnly() throws {
        let route = BirdieRoute(
            action: .captureThought,
            source: .appIntent,
            focus: .personal,
            draft: "  Ein sicherer Entwurf  "
        )

        let parsed = try XCTUnwrap(BirdieRoute(url: route.url))
        XCTAssertEqual(parsed.action, .captureThought)
        XCTAssertEqual(parsed.focus, .personal)
        XCTAssertNil(parsed.draft)
        XCTAssertEqual(parsed.source, .externalDeepLink)
        let queryItems = try XCTUnwrap(
            URLComponents(url: route.url, resolvingAgainstBaseURL: false)?.queryItems
        )
        XCTAssertFalse(queryItems.contains(where: { $0.name == "draft" }))
    }

    func testDeepLinkRejectsUnknownOrMalformedActions() {
        XCTAssertNil(BirdieRoute(url: URL(string: "https://example.com/action/ask")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/delete-everything")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask/extra")!))
    }

    func testDeepLinkRejectsAuthorityAndFragmentAmbiguity() {
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://alice:secret@action/ask?source=app")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action:443/ask?source=app")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?source=app#preview")!))
    }

    func testDeepLinkRejectsUnknownDuplicateOrInvalidQueries() {
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?draft=secret")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?unexpected=value")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?source=app&source=widget")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?source=invalid")!))
        XCTAssertNil(BirdieRoute(url: URL(string: "birdie://action/ask?focus=invalid")!))
        XCTAssertNotNil(BirdieRoute(url: URL(string: "birdie://action/ask?source=widget&focus=work")!))
    }

    func testDraftStripsControlAndBidiFormattingCharacters() {
        let route = BirdieRoute(
            action: .captureThought,
            source: .app,
            draft: "\u{202E}  A\u{0000}B\u{2066}C  \u{202C}"
        )

        XCTAssertEqual(route.draft, "ABC")
    }

    func testDraftIsBoundedAndNeverExecutesWhenStaged() throws {
        let suite = "birdie.routing-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = BirdiePendingRouteStore(defaults: defaults)
        let longDraft = String(repeating: "x", count: BirdieRoute.maximumDraftLength + 10)

        store.stage(BirdieRoute(action: .ask, source: .appIntent, draft: longDraft))
        let consumed = try XCTUnwrap(store.consume())

        XCTAssertEqual(consumed.draft?.count, BirdieRoute.maximumDraftLength)
        XCTAssertNil(store.consume())
        XCTAssertFalse(BirdieActionCatalog.contract(for: consumed.action).allowsDirectIntentExecution)
    }

    func testPendingRouteStorePurgesExpiredAndMalformedRecords() throws {
        let suite = "birdie.routing-expiry-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let now = Date(timeIntervalSince1970: 10_000)
        let store = BirdiePendingRouteStore(
            defaults: defaults,
            maxAge: 300,
            now: { now }
        )

        store.stage(
            BirdieRoute(
                action: .ask,
                source: .appIntent,
                createdAt: now.addingTimeInterval(-301)
            )
        )
        XCTAssertNil(store.consume())
        XCTAssertNil(defaults.object(forKey: "birdie.pending-route.v1"))

        defaults.set(Data("not-json".utf8), forKey: "birdie.pending-route.v1")
        XCTAssertNil(store.consume())
        XCTAssertNil(defaults.object(forKey: "birdie.pending-route.v1"))
    }
}
