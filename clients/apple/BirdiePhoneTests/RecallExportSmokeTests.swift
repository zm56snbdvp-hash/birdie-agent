import Foundation
import XCTest
@testable import Birdie

final class RecallExportSmokeTests: RecallTestCase {
    func testPortableExportIsOnlyCreatedOnExplicitCall() async throws {
        let repository = try repository(root: temporaryRoot())
        let item = try await repository.ingest(noteCapture(title: "Export Hotel"))

        let export = try await repository.makePortableExport()

        XCTAssertEqual(export.manifest.schemaVersion, 1)
        XCTAssertEqual(export.manifest.items.map(\.id), [item.id])
        XCTAssertTrue(export.attachments.isEmpty)
    }

    func testReproducibleSmokeHotelYesterdaySearchExportDelete() async throws {
        let repository = try repository(root: temporaryRoot())
        let hotelID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
        _ = try await repository.ingest(
            noteCapture(
                id: hotelID,
                title: "Hotel Speicherstadt",
                note: "Das Hotel war Am Sandtorkai 4 in Hamburg.",
                capturedAt: Self.fixedNow.addingTimeInterval(-86_400),
                channel: .birdieDrop
            )
        )

        let hits = try await repository.search(
            RecallSearchQueryV1(text: "Wo war das Hotel von gestern?")
        )
        XCTAssertEqual(hits.map(\.id), [hotelID])

        let export = try await repository.makePortableExport()
        XCTAssertEqual(export.manifest.items.map(\.id), [hotelID])

        _ = try await repository.forget(hotelID)
        let afterDeletion = try await repository.search(RecallSearchQueryV1(text: "Hotel"))
        XCTAssertTrue(afterDeletion.isEmpty)
        let remainsIndexed = await repository.containsInLocalIndex(hotelID)
        XCTAssertFalse(remainsIndexed)
    }
}
