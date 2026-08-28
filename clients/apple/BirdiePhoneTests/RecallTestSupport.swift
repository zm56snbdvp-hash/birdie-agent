import Foundation
import UIKit
import UniformTypeIdentifiers
import XCTest
@testable import Birdie

actor RecordingRecallExternalIndex: RecallExternalIndexing {
    struct ExpectedFailure: Error {}
    private var indexedIdentifiers: Set<UUID> = []
    private var removeAllCount = 0
    private var shouldFailNextRemoveAll = false

    func upsert(_ items: [RecallItemV1]) async throws {
        indexedIdentifiers.formUnion(items.map(\.id))
    }

    func remove(_ identifiers: [UUID]) async throws {
        indexedIdentifiers.subtract(identifiers)
    }

    func removeAll() async throws {
        if shouldFailNextRemoveAll {
            shouldFailNextRemoveAll = false
            throw ExpectedFailure()
        }
        indexedIdentifiers.removeAll()
        removeAllCount += 1
    }

    func snapshot() -> Set<UUID> { indexedIdentifiers }
    func resetCount() -> Int { removeAllCount }
    func failNextRemoveAll() { shouldFailNextRemoveAll = true }
    func seed(_ identifiers: Set<UUID>) { indexedIdentifiers = identifiers }
}

actor SuspendedRecallExternalIndex: RecallExternalIndexing {
    private var indexedIdentifiers: Set<UUID> = []
    private var isBlocked = true
    private var hasStarted = false
    private var removeAllCount = 0
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var secondStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []

    func upsert(_ items: [RecallItemV1]) async throws {
        indexedIdentifiers.formUnion(items.map(\.id))
    }

    func remove(_ identifiers: [UUID]) async throws {
        indexedIdentifiers.subtract(identifiers)
    }

    func removeAll() async throws {
        hasStarted = true
        removeAllCount += 1
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        if removeAllCount >= 2 {
            secondStartWaiters.forEach { $0.resume() }
            secondStartWaiters.removeAll()
        }
        if isBlocked {
            await withCheckedContinuation { continuation in
                operationWaiters.append(continuation)
            }
        }
        indexedIdentifiers.removeAll()
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func waitUntilSecondOperationStarted() async {
        if removeAllCount >= 2 { return }
        await withCheckedContinuation { continuation in
            secondStartWaiters.append(continuation)
        }
    }

    func release() {
        isBlocked = false
        operationWaiters.forEach { $0.resume() }
        operationWaiters.removeAll()
    }
}

actor SuspendedRecallTextExtractor: RecallTextExtracting {
    private var hasStarted = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    func extractText(from localFileURL: URL, kind: RecallItemKindV1) async throws -> String? {
        hasStarted = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        try await Task.sleep(for: .seconds(60))
        return "Darf nach Hintergrundwechsel nicht gespeichert werden"
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }
}

struct FailingRecallSemanticRanker: RecallSemanticRanking {
    struct ExpectedFailure: Error {}

    func rerank(
        query: RecallSearchQueryV1,
        deterministicResults: [RecallSearchResultV1]
    ) async throws -> [RecallSearchResultV1] {
        throw ExpectedFailure()
    }
}

actor SuspendedRecallSemanticRanker: RecallSemanticRanking {
    private var hasStarted = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var resultContinuation: CheckedContinuation<[RecallSearchResultV1], Never>?
    private var pendingResults: [RecallSearchResultV1] = []

    func rerank(
        query: RecallSearchQueryV1,
        deterministicResults: [RecallSearchResultV1]
    ) async throws -> [RecallSearchResultV1] {
        pendingResults = deterministicResults
        hasStarted = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        return await withCheckedContinuation { continuation in
            resultContinuation = continuation
        }
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func finish() {
        resultContinuation?.resume(returning: pendingResults)
        resultContinuation = nil
        pendingResults = []
    }
}

class RecallTestCase: XCTestCase {
    static let fixedKey = Data(repeating: 0x42, count: 32)
    static let fixedNow = ISO8601DateFormatter().date(from: "2026-08-28T12:00:00Z")!

    func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BirdieRecallTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    func repository(
        root: URL,
        now: Date = RecallTestCase.fixedNow,
        index: any RecallExternalIndexing = RecordingRecallExternalIndex(),
        semanticRanker: any RecallSemanticRanking = NoopRecallSemanticRanker(),
        textExtractor: any RecallTextExtracting = NoopRecallTextExtractor()
    ) throws -> RecallRepository {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return try RecallRepository(
            rootDirectory: root,
            keyProvider: FixedRecallVaultKeyProvider(keyData: Self.fixedKey),
            externalIndex: index,
            semanticRanker: semanticRanker,
            textExtractor: textExtractor,
            now: { now },
            calendar: calendar
        )
    }

    func noteCapture(
        id: UUID = UUID(),
        title: String = "Hotel am See",
        note: String = "Seestraße 7, Potsdam",
        capturedAt: Date = RecallTestCase.fixedNow,
        channel: RecallIntakeChannelV1 = .manualSelection,
        retention: RecallRetentionRequestV1 = .defaultPolicy
    ) -> CaptureItemV1 {
        CaptureItemV1(
            id: id,
            kind: .note,
            title: title,
            provenance: RecallProvenanceV1(
                channel: channel,
                sourceApplication: channel == .birdieDrop ? "Birdie Drop" : "Birdie iPhone",
                sourceItemIdentifier: id.uuidString,
                submittedAt: Self.fixedNow
            ),
            capturedAt: capturedAt,
            tags: ["Reise", "Hotel"],
            note: note,
            retention: retention
        )
    }

    func localImageCapture(id: UUID = UUID(), sourceURL: URL) -> CaptureItemV1 {
        CaptureItemV1(
            id: id,
            kind: .photo,
            title: "Ausgewähltes Hotelfoto",
            provenance: RecallProvenanceV1(
                channel: .manualSelection,
                sourceApplication: "Birdie iPhone",
                sourceItemIdentifier: id.uuidString,
                submittedAt: Self.fixedNow
            ),
            capturedAt: Self.fixedNow,
            tags: ["Foto"],
            localFileURL: sourceURL,
            contentTypeIdentifier: UTType.jpeg.identifier
        )
    }

    func validJPEGData() -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2))
        let image = renderer.image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
        return image.jpegData(compressionQuality: 0.9)!
    }
}
