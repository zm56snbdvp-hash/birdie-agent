import XCTest
@testable import CaptureCore

final class CaptureCoreTests: XCTestCase {
    private var temporaryRoots: [URL] = []

    override func tearDownWithError() throws {
        for root in temporaryRoots where root.path.hasPrefix(FileManager.default.temporaryDirectory.path) {
            try? FileManager.default.removeItem(at: root)
        }
        temporaryRoots = []
    }

    func testCaptureItemRoundTripsWithStableContract() throws {
        let item = CaptureItem(
            id: UUID(uuidString: "4D36E967-E325-11CE-BFC1-08002BE10318")!,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            source: .shareExtension,
            intent: .summarize,
            status: .queued,
            payloads: [CapturePayload(
                kind: .url,
                displayName: "example.com",
                typeIdentifier: "public.url",
                inlineText: "https://example.com",
                byteCount: 19
            )],
            originalStorageConsent: .confirmed
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(CaptureItem.self, from: encoder.encode(item))

        XCTAssertEqual(decoded, item)
        XCTAssertEqual(decoded.schemaVersion, 1)
        XCTAssertEqual(decoded.idempotencyKey, "capture.v1.4d36e967-e325-11ce-bfc1-08002be10318")
    }

    func testWireContractUsesStableKeysAndNeverExportsLocalPath() throws {
        let item = CaptureItem(
            id: UUID(uuidString: "4D36E967-E325-11CE-BFC1-08002BE10318")!,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            source: .shareExtension,
            intent: .prepareTask,
            payloads: [CapturePayload(
                id: UUID(uuidString: "F47AC10B-58CC-4372-A567-0E02B2C3D479")!,
                kind: .url,
                displayName: "example.com",
                typeIdentifier: "public.url",
                inlineText: "https://example.com",
                byteCount: 19
            )],
            originalStorageConsent: .confirmed,
            originalPolicy: .includeOriginals
        )
        let request = try CaptureSubmissionRequest(item: item)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(request)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(Set(json.keys), Set([
            "contract", "captureID", "idempotencyKey", "createdAt", "source",
            "requestedIntent", "parts", "suggestions", "requiresUserReview",
            "originalsConfirmedForLocalStaging", "originalPolicy"
        ]))
        XCTAssertEqual(json["contract"] as? String, "birdie.capture.v1")
        XCTAssertEqual(json["source"] as? String, "shareExtension")
        XCTAssertEqual(json["requestedIntent"] as? String, "prepareTask")
        XCTAssertEqual(json["originalPolicy"] as? String, "includeOriginals")
        XCTAssertEqual(json["requiresUserReview"] as? Bool, true)
        let parts = try XCTUnwrap(json["parts"] as? [[String: Any]])
        XCTAssertEqual(parts.first?["kind"] as? String, "url")
        XCTAssertNil(parts.first?["relativeFilePath"])
        XCTAssertFalse(String(data: data, encoding: .utf8)!.contains("relativeFilePath"))
    }

    func testContractEnforcesPartAndSizeLimits() throws {
        let twenty = (0..<20).map { index in
            CapturePayload(kind: .text, displayName: "Text \(index)", inlineText: "x", byteCount: 1)
        }
        XCTAssertNoThrow(try CaptureSubmissionRequest(item: CaptureItem(
            source: .shareExtension,
            intent: .remember,
            payloads: twenty,
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )))

        let twentyOne = twenty + [CapturePayload(kind: .text, displayName: "zu viel", inlineText: "x")]
        XCTAssertThrowsError(try CaptureSubmissionRequest(item: CaptureItem(
            source: .shareExtension,
            intent: .remember,
            payloads: twentyOne,
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )))

        let oversizedText = String(repeating: "x", count: CaptureLimits.maximumTextBytes + 1)
        XCTAssertThrowsError(try CaptureSubmissionRequest(item: CaptureItem(
            source: .document,
            intent: .summarize,
            payloads: [CapturePayload(
                kind: .recognizedText,
                displayName: "OCR",
                inlineText: oversizedText
            )],
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )))

        let checksum = String(repeating: "a", count: 64)
        let tooLarge = CapturePayload(
            kind: .file,
            displayName: "large.bin",
            relativeFilePath: "Staging/id/large.bin",
            byteCount: CaptureLimits.maximumFileBytes + 1,
            sha256: checksum
        )
        XCTAssertThrowsError(try CaptureSubmissionRequest(item: CaptureItem(
            source: .shareExtension,
            intent: .sendToPC,
            payloads: [tooLarge],
            originalStorageConsent: .confirmed
        )))

        let ninetyMB: Int64 = 90 * 1_048_576
        let totalTooLarge = (0..<3).map { index in
            CapturePayload(
                kind: .file,
                displayName: "part-\(index).bin",
                relativeFilePath: "Staging/id/part-\(index).bin",
                byteCount: ninetyMB,
                sha256: checksum
            )
        }
        XCTAssertThrowsError(try CaptureSubmissionRequest(item: CaptureItem(
            source: .shareExtension,
            intent: .sendToPC,
            payloads: totalTooLarge,
            originalStorageConsent: .confirmed
        )))

        XCTAssertThrowsError(try CaptureSubmissionRequest(item: CaptureItem(
            source: .shareExtension,
            intent: .remember,
            payloads: [CapturePayload(kind: .text, displayName: "leer", inlineText: "")],
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )))
    }

    func testEnqueueIsIdempotentAndPersistsOneItemFile() throws {
        let store = try makeStore()
        let item = makeTextItem()

        let first = try store.enqueue(item)
        let second = try store.enqueue(item)

        XCTAssertEqual(first, second)
        XCTAssertEqual(try store.allItems(), [item])
        let manifests = try FileManager.default.contentsOfDirectory(
            at: store.locations.items,
            includingPropertiesForKeys: nil
        )
        XCTAssertEqual(manifests.filter { $0.pathExtension == "json" }.count, 1)
    }

    func testEnqueueRejectsDifferentImmutableContentForSameID() throws {
        let store = try makeStore()
        let original = makeTextItem()
        try store.enqueue(original)
        let conflicting = CaptureItem(
            id: original.id,
            createdAt: original.createdAt,
            source: original.source,
            intent: original.intent,
            status: .queued,
            payloads: [CapturePayload(
                kind: .text,
                displayName: "Text",
                inlineText: "anderer Inhalt",
                byteCount: 15
            )],
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )

        XCTAssertThrowsError(try store.enqueue(conflicting))
        XCTAssertEqual(try store.item(id: original.id), original)
    }

    func testDeleteRemovesManifestStagedFilesAndLocalOutbox() async throws {
        let store = try makeStore()
        let stager = CaptureFileStager(locations: store.locations)
        let itemID = UUID()
        let payload = try stager.stageData(
            Data("private".utf8),
            itemID: itemID,
            kind: .file,
            displayName: "private.txt",
            typeIdentifier: "public.text"
        )
        let item = CaptureItem(
            id: itemID,
            source: .shareExtension,
            intent: .remember,
            payloads: [payload],
            originalStorageConsent: .confirmed
        )
        try store.enqueue(item)
        let request = try CaptureSubmissionRequest(item: item)
        let adapter = LocalCaptureMockAdapter(locations: store.locations)
        _ = try await adapter.submit(request)
        let stagedURL = try store.resolvedStagedFile(relativePath: payload.relativeFilePath!)
        let outboxURL = store.locations.outbox.appendingPathComponent(
            "\(item.id.uuidString.lowercased()).json"
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: stagedURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outboxURL.path))

        try store.delete(id: item.id)

        XCTAssertFalse(FileManager.default.fileExists(atPath: stagedURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: outboxURL.path))
        XCTAssertNil(try store.item(id: item.id))
        do {
            _ = try await adapter.submit(request)
            XCTFail("A deleted item must not recreate a local outbox file")
        } catch {
            XCTAssertFalse(FileManager.default.fileExists(atPath: outboxURL.path))
        }
    }

    func testDeleteStillRemovesItemWhenAStagedPayloadIsAlreadyMissing() async throws {
        let store = try makeStore()
        let stager = CaptureFileStager(locations: store.locations)
        let itemID = UUID()
        let payload = try stager.stageData(
            Data("private".utf8),
            itemID: itemID,
            kind: .file,
            displayName: "private.txt",
            typeIdentifier: "public.text"
        )
        let item = CaptureItem(
            id: itemID,
            source: .shareExtension,
            intent: .remember,
            payloads: [payload],
            originalStorageConsent: .confirmed
        )
        try store.enqueue(item)
        let request = try CaptureSubmissionRequest(item: item)
        _ = try await LocalCaptureMockAdapter(locations: store.locations).submit(request)
        let stagedURL = try store.resolvedStagedFile(
            relativePath: XCTUnwrap(payload.relativeFilePath),
            itemID: itemID
        )
        try FileManager.default.removeItem(at: stagedURL)

        try store.delete(id: itemID)

        XCTAssertNil(try store.item(id: itemID))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.locations.staging
            .appendingPathComponent(itemID.uuidString.lowercased()).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.locations.outbox
            .appendingPathComponent("\(itemID.uuidString.lowercased()).json").path))
    }

    func testEnqueueRejectsAttachmentOwnedByAnotherCapture() throws {
        let store = try makeStore()
        let stager = CaptureFileStager(locations: store.locations)
        let ownerID = UUID()
        let foreignPayload = try stager.stageData(
            Data("owner".utf8),
            itemID: ownerID,
            kind: .file,
            displayName: "owner.txt",
            typeIdentifier: "public.text"
        )
        let maliciousItem = CaptureItem(
            source: .shareExtension,
            intent: .remember,
            payloads: [foreignPayload],
            originalStorageConsent: .confirmed
        )

        XCTAssertThrowsError(try store.enqueue(maliciousItem))
        let foreignURL = try store.resolvedStagedFile(
            relativePath: foreignPayload.relativeFilePath!,
            itemID: ownerID
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: foreignURL.path))
    }

    func testUnsafeStagedPathsAreRejected() throws {
        let store = try makeStore()
        XCTAssertThrowsError(try store.resolvedStagedFile(relativePath: "../outside"))
        XCTAssertThrowsError(try store.resolvedStagedFile(relativePath: "/absolute"))
    }

    func testStaleProtectedWriterPartialIsRemovedWithoutTouchingItems() throws {
        let store = try makeStore()
        let item = makeTextItem()
        try store.enqueue(item)
        let partial = store.locations.items.appendingPathComponent(".queue.json.test.partial")
        try Data("sensitive partial".utf8).write(to: partial)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 1)],
            ofItemAtPath: partial.path
        )

        try store.cleanupStalePartials(olderThan: Date(timeIntervalSince1970: 2))

        XCTAssertFalse(FileManager.default.fileExists(atPath: partial.path))
        XCTAssertEqual(try store.item(id: item.id), item)
    }

    func testCorruptManifestIsIsolatedSoValidQueueWorkAndDeletionContinue() async throws {
        let store = try makeStore()
        let valid = makeTextItem()
        try store.enqueue(valid)
        let corruptID = UUID()
        let corruptManifest = store.locations.items.appendingPathComponent(
            "\(corruptID.uuidString.lowercased()).json"
        )
        try Data("not-json".utf8).write(to: corruptManifest)
        let corruptStaging = store.locations.staging.appendingPathComponent(
            corruptID.uuidString.lowercased(),
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: corruptStaging,
            withIntermediateDirectories: true
        )
        try Data("private".utf8).write(
            to: corruptStaging.appendingPathComponent("orphan.bin")
        )

        let before = try store.allItems()
        XCTAssertEqual(before.count, 2)
        let recovery = try XCTUnwrap(before.first { $0.id == corruptID })
        XCTAssertEqual(recovery.status, .failed)
        XCTAssertEqual(recovery.lastFailure?.code, "corrupt_manifest")
        let processor = CaptureQueueProcessor(
            store: store,
            adapter: LocalCaptureMockAdapter(locations: store.locations)
        )

        await processor.processDueItems()

        XCTAssertEqual(try store.item(id: valid.id)?.status, .readyForReview)
        try store.delete(id: corruptID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: corruptManifest.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: corruptStaging.path))
        XCTAssertEqual(try store.allItems().map(\.id), [valid.id])
    }

    func testManifestStoredUnderDifferentIDBecomesExactRecoveryItem() throws {
        let store = try makeStore()
        let embeddedItem = makeTextItem()
        let fileID = UUID()
        let mismatchedManifest = store.locations.items.appendingPathComponent(
            "\(fileID.uuidString.lowercased()).json"
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(embeddedItem).write(to: mismatchedManifest)
        let exactStaging = store.locations.staging.appendingPathComponent(
            fileID.uuidString.lowercased(),
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: exactStaging,
            withIntermediateDirectories: true
        )
        try Data("private".utf8).write(to: exactStaging.appendingPathComponent("orphan.bin"))

        let recovery = try XCTUnwrap(store.allItems().first)

        XCTAssertEqual(recovery.id, fileID)
        XCTAssertEqual(recovery.lastFailure?.code, "corrupt_manifest")
        XCTAssertThrowsError(try store.item(id: fileID))
        try store.delete(id: fileID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: mismatchedManifest.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: exactStaging.path))
    }

    func testDerivedTextPolicyRejectsOriginalFiles() throws {
        let item = CaptureItem(
            source: .document,
            intent: .summarize,
            payloads: [CapturePayload(
                kind: .image,
                displayName: "original.jpg",
                relativeFilePath: "Staging/item/original.jpg"
            )],
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )

        XCTAssertThrowsError(try CaptureSubmissionRequest(item: item))
    }

    func testUnconfirmedItemCannotEnterTransportContract() throws {
        let item = CaptureItem(
            source: .document,
            intent: .remember,
            payloads: [CapturePayload(
                kind: .recognizedText,
                displayName: "OCR",
                inlineText: "Text"
            )],
            originalStorageConsent: .notRequested,
            originalPolicy: .derivedTextOnly
        )
        XCTAssertThrowsError(try CaptureSubmissionRequest(item: item))
    }

    func testOfflineFailureSchedulesDeterministicRetry() async throws {
        let store = try makeStore()
        let item = makeTextItem(status: .queued)
        try store.enqueue(item)
        let instant = Date(timeIntervalSince1970: 2_000_000_000)
        let processor = CaptureQueueProcessor(
            store: store,
            adapter: OfflineAdapter(),
            retryDelays: [30],
            now: { instant }
        )

        await processor.processDueItems()

        let updated = try XCTUnwrap(store.item(id: item.id))
        XCTAssertEqual(updated.status, .retryScheduled)
        XCTAssertEqual(updated.attemptCount, 1)
        XCTAssertEqual(updated.nextRetryAt, instant.addingTimeInterval(30))
        XCTAssertEqual(updated.lastFailure?.code, "offline")
    }

    func testInvalidLocalContractFailsPermanentlyWithoutRetry() async throws {
        let store = try makeStore()
        let item = CaptureItem(
            source: .document,
            intent: .summarize,
            status: .queued,
            payloads: [CapturePayload(
                kind: .recognizedText,
                displayName: "OCR",
                inlineText: "not confirmed"
            )],
            originalStorageConsent: .notRequested,
            originalPolicy: .derivedTextOnly
        )
        try store.enqueue(item)
        let processor = CaptureQueueProcessor(store: store, adapter: OfflineAdapter())

        await processor.processDueItems()

        let updated = try XCTUnwrap(store.item(id: item.id))
        XCTAssertEqual(updated.status, .failed)
        XCTAssertNil(updated.nextRetryAt)
        XCTAssertEqual(updated.lastFailure?.code, "invalid_contract")
        XCTAssertEqual(updated.attemptCount, 1)
    }

    func testChangedStagedFileFailsIntegrityCheckWithoutOutboxWrite() async throws {
        let store = try makeStore()
        let stager = CaptureFileStager(locations: store.locations)
        let itemID = UUID()
        let payload = try stager.stageData(
            Data("original".utf8),
            itemID: itemID,
            kind: .file,
            displayName: "private.bin",
            typeIdentifier: "public.data"
        )
        let item = CaptureItem(
            id: itemID,
            source: .shareExtension,
            intent: .remember,
            status: .queued,
            payloads: [payload],
            originalStorageConsent: .confirmed
        )
        try store.enqueue(item)
        let fileURL = try store.resolvedStagedFile(
            relativePath: XCTUnwrap(payload.relativeFilePath),
            itemID: itemID
        )
        try Data("modified".utf8).write(to: fileURL)
        let processor = CaptureQueueProcessor(
            store: store,
            adapter: LocalCaptureMockAdapter(locations: store.locations)
        )

        await processor.processDueItems()

        let updated = try XCTUnwrap(store.item(id: itemID))
        XCTAssertEqual(updated.status, .failed)
        XCTAssertEqual(updated.lastFailure?.code, "invalid_contract")
        let outbox = store.locations.outbox.appendingPathComponent(
            "\(itemID.uuidString.lowercased()).json"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: outbox.path))
    }

    func testFutureRetryIsNotProcessedEarly() async throws {
        let store = try makeStore()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        var item = makeTextItem(status: .retryScheduled)
        item.nextRetryAt = now.addingTimeInterval(60)
        try store.enqueue(item)
        let processor = CaptureQueueProcessor(
            store: store,
            adapter: OfflineAdapter(),
            now: { now }
        )

        await processor.processDueItems()

        let unchanged = try XCTUnwrap(store.item(id: item.id))
        XCTAssertEqual(unchanged.attemptCount, 0)
        XCTAssertEqual(unchanged.status, .retryScheduled)
    }

    func testStaleProcessingItemRecoversAfterFiveMinutes() async throws {
        let store = try makeStore()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        var item = makeTextItem(status: .processing)
        item.updatedAt = now.addingTimeInterval(-301)
        try store.enqueue(item)
        let processor = CaptureQueueProcessor(
            store: store,
            adapter: LocalCaptureMockAdapter(locations: store.locations),
            now: { now }
        )

        await processor.processDueItems()

        let recovered = try XCTUnwrap(store.item(id: item.id))
        XCTAssertEqual(recovered.status, .readyForReview)
        XCTAssertEqual(recovered.attemptCount, 1)
    }

    func testPendingOpenMarkerIsOpaqueAndConsumedOnce() throws {
        let store = try makeStore()
        let item = makeTextItem()
        try store.enqueue(item)

        try store.markForOpening(id: item.id)

        XCTAssertEqual(try store.consumePendingOpen(), item.id)
        XCTAssertNil(try store.consumePendingOpen())
    }

    func testLocalAdapterIsIdempotentAndOnlyWritesManifest() async throws {
        let store = try makeStore()
        let request = try CaptureSubmissionRequest(item: makeTextItem())
        let adapter = LocalCaptureMockAdapter(locations: store.locations)

        let first = try await adapter.submit(request)
        let second = try await adapter.submit(request)

        XCTAssertEqual(first.captureID, second.captureID)
        XCTAssertEqual(first.disposition, .localPreviewOnly)
        let files = try FileManager.default.contentsOfDirectory(
            at: store.locations.outbox,
            includingPropertiesForKeys: nil
        )
        XCTAssertEqual(files.count, 1)
    }

    func testDeepLinkParserAcceptsOnlyOpaqueLocalIdentifierShape() {
        let id = UUID(uuidString: "4D36E967-E325-11CE-BFC1-08002BE10318")!
        XCTAssertEqual(CaptureDeepLink.itemID(from: URL(string: "birdie://capture/\(id)")!), id)
        XCTAssertEqual(
            CaptureDeepLink.itemID(
                from: URL(string: "birdie-personal://capture/\(id)")!,
                scheme: "birdie-personal"
            ),
            id
        )
        XCTAssertNil(CaptureDeepLink.itemID(from: URL(string: "https://capture/\(id)")!))
        XCTAssertNil(CaptureDeepLink.itemID(from: URL(string: "birdie://capture/\(id)?text=secret")!))
        XCTAssertNil(CaptureDeepLink.itemID(from: URL(string: "birdie://capture/not-a-uuid")!))
    }

    func testLensAnalysisBuildsSuggestionsAndRedactsSensitiveData() {
        let receipt = LensAnalyzer.analyze(
            text: "Musterladen\nGesamt: 42,50 EUR\n28.08.2026",
            profile: .receipt
        )
        XCTAssertTrue(receipt.suggestions.contains { $0.kind == .amount && $0.value == "42,50" })
        XCTAssertTrue(receipt.suggestions.contains { $0.kind == .dueDate })

        let card = LensAnalyzer.analyze(
            text: "Kevin Birdie\nkevin@example.com\n+49 170 1234567",
            profile: .businessCard
        )
        XCTAssertTrue(card.containsSensitiveData)
        XCTAssertFalse(card.redactedText.contains("kevin@example.com"))
        XCTAssertTrue(card.suggestions.contains { $0.kind == .contact })

        let error = LensAnalyzer.analyze(text: "ERROR 503: unavailable", profile: .errorMessage)
        XCTAssertTrue(error.suggestions.contains { $0.kind == .errorCode })
    }

    private func makeStore() throws -> CaptureQueueStore {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BirdieCaptureTests-\(UUID().uuidString)", isDirectory: true)
        temporaryRoots.append(root)
        return try CaptureQueueStore(locations: CaptureStoreLocations(root: root))
    }

    private func makeTextItem(status: CaptureStatus = .queued) -> CaptureItem {
        CaptureItem(
            source: .shareExtension,
            intent: .remember,
            status: status,
            payloads: [CapturePayload(
                kind: .text,
                displayName: "Text",
                typeIdentifier: "public.plain-text",
                inlineText: "lokal",
                byteCount: 5
            )],
            originalStorageConsent: .confirmed,
            originalPolicy: .derivedTextOnly
        )
    }
}

private struct OfflineAdapter: CaptureTransportAdapter {
    func submit(_ request: CaptureSubmissionRequest) async throws -> CaptureSubmissionReceipt {
        throw CaptureAdapterError.offline
    }
}
