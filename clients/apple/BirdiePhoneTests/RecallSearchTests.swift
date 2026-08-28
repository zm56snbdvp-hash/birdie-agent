import Foundation
import XCTest
@testable import Birdie

final class RecallSearchTests: RecallTestCase {
    func testNaturalLanguageYesterdayQueryFindsHotelDeterministically() async throws {
        let root = try temporaryRoot()
        let repository = try repository(root: root)
        let yesterday = Self.fixedNow.addingTimeInterval(-86_400)
        let hotelID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        _ = try await repository.ingest(
            noteCapture(
                id: hotelID,
                title: "Hotel Seeblick",
                note: "Das Hotel war in der Seestraße 7 in Potsdam.",
                capturedAt: yesterday
            )
        )
        _ = try await repository.ingest(
            noteCapture(title: "Café heute", note: "Marktplatz", capturedAt: Self.fixedNow)
        )

        let results = try await repository.search(
            RecallSearchQueryV1(text: "Wo war das Hotel von gestern?")
        )

        XCTAssertEqual(results.map(\.id), [hotelID])
        XCTAssertEqual(results.first?.matchedTerms, ["hotel"])
    }

    func testSourceDateAndTypeFiltersAreHardConstraints() async throws {
        let repository = try repository(root: temporaryRoot())
        let yesterday = Self.fixedNow.addingTimeInterval(-86_400)
        let dropID = UUID()
        _ = try await repository.ingest(
            noteCapture(id: dropID, title: "Drop Hotel", capturedAt: yesterday, channel: .birdieDrop)
        )
        _ = try await repository.ingest(
            noteCapture(title: "Manuelles Hotel", capturedAt: yesterday, channel: .manualSelection)
        )
        _ = try await repository.ingest(
            CaptureItemV1(
                kind: .link,
                title: "Drop Hotel Link",
                provenance: RecallProvenanceV1(channel: .birdieDrop, submittedAt: Self.fixedNow),
                capturedAt: Self.fixedNow,
                linkURL: URL(string: "https://example.com/hotel")
            )
        )

        let filters = RecallSearchFiltersV1(
            sourceChannels: [.birdieDrop],
            kinds: [.note],
            capturedFrom: yesterday.addingTimeInterval(-60),
            capturedBefore: Self.fixedNow
        )
        let results = try await repository.search(
            RecallSearchQueryV1(text: "Hotel", filters: filters)
        )
        XCTAssertEqual(results.map(\.id), [dropID])
    }

    func testTieBreakUsesDateThenStableIdentifier() async throws {
        let repository = try repository(root: temporaryRoot())
        let lowerID = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
        let higherID = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
        _ = try await repository.ingest(noteCapture(id: higherID, title: "Hotel", note: "Adresse"))
        _ = try await repository.ingest(noteCapture(id: lowerID, title: "Hotel", note: "Adresse"))

        let results = try await repository.search(RecallSearchQueryV1(text: "Hotel"))
        XCTAssertEqual(results.map(\.id), [lowerID, higherID])
    }

    func testUnavailableSemanticAdapterFallsBackToLocalResults() async throws {
        let repository = try repository(
            root: temporaryRoot(),
            semanticRanker: FailingRecallSemanticRanker()
        )
        let identifier = UUID()
        _ = try await repository.ingest(noteCapture(id: identifier, title: "Hotel lokal"))

        let results = try await repository.search(RecallSearchQueryV1(text: "Hotel"))

        XCTAssertEqual(results.map(\.id), [identifier])
    }

    func testSemanticRankingCannotReturnItemDeletedWhileAdapterWasSuspended() async throws {
        let ranker = SuspendedRecallSemanticRanker()
        let repository = try repository(
            root: temporaryRoot(),
            semanticRanker: ranker
        )
        let identifier = UUID()
        _ = try await repository.ingest(noteCapture(id: identifier, title: "Hotel im Rennen"))

        let search = Task {
            try await repository.search(RecallSearchQueryV1(text: "Hotel"))
        }
        await ranker.waitUntilStarted()
        _ = try await repository.forget(identifier)
        await ranker.finish()

        let results = try await search.value
        XCTAssertTrue(results.isEmpty)
    }

    func testSemanticRankingCannotReturnSnapshotAfterKillSwitch() async throws {
        let ranker = SuspendedRecallSemanticRanker()
        let repository = try repository(
            root: temporaryRoot(),
            semanticRanker: ranker
        )
        _ = try await repository.ingest(noteCapture(title: "Hotel vor Kill-Switch"))

        let search = Task {
            try await repository.search(RecallSearchQueryV1(text: "Hotel"))
        }
        await ranker.waitUntilStarted()
        _ = try await repository.engageKillSwitch()
        await ranker.finish()

        do {
            _ = try await search.value
            XCTFail("A pre-kill-switch search snapshot must never be returned")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .disabled)
        }
    }
}
