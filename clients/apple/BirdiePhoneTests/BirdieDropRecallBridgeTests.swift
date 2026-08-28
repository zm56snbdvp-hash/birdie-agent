import CaptureCore
import Foundation
import XCTest
@testable import Birdie

final class BirdieDropRecallBridgeTests: XCTestCase {
    func testMapsOneReviewedURLToRecallV1() throws {
        let root = try temporaryRoot()
        let store = try CaptureQueueStore(locations: CaptureStoreLocations(root: root))
        let itemID = UUID()
        let item = CaptureItem(
            id: itemID,
            source: .shareExtension,
            intent: .remember,
            status: .readyForReview,
            payloads: [CapturePayload(
                kind: .url,
                displayName: "Hotel Speicherstadt",
                typeIdentifier: "public.url",
                inlineText: "https://example.com/hotel"
            )],
            originalStorageConsent: .confirmed
        )
        _ = try store.enqueue(item)

        let capture = try BirdieDropRecallBridgeV1.makeCapture(from: item, store: store)

        XCTAssertEqual(capture.id, itemID)
        XCTAssertEqual(capture.kind, .link)
        XCTAssertEqual(capture.provenance.channel, .birdieDrop)
        XCTAssertEqual(capture.linkURL?.absoluteString, "https://example.com/hotel")
    }

    func testRejectsMultiPartDropInsteadOfGuessingRecallContent() throws {
        let root = try temporaryRoot()
        let store = try CaptureQueueStore(locations: CaptureStoreLocations(root: root))
        let item = CaptureItem(
            source: .shareExtension,
            intent: .remember,
            status: .readyForReview,
            payloads: [
                CapturePayload(kind: .text, displayName: "Text", inlineText: "Hotel"),
                CapturePayload(kind: .url, displayName: "Link", inlineText: "https://example.com")
            ],
            originalStorageConsent: .confirmed
        )

        XCTAssertThrowsError(try BirdieDropRecallBridgeV1.makeCapture(from: item, store: store)) { error in
            XCTAssertEqual(error as? BirdieDropRecallBridgeError, .requiresSinglePayload)
        }
    }

    private func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BirdieDropRecallBridge-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
}
