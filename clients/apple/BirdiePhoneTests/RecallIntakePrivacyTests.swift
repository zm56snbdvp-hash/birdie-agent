import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import Birdie

final class RecallIntakePrivacyTests: RecallTestCase {
    func testVersionedIntakeIsStableIdempotentAndRejectsConflicts() async throws {
        let repository = try repository(root: temporaryRoot())
        let identifier = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let capture = noteCapture(id: identifier)

        let first = try await repository.ingest(capture)
        let retry = try await repository.ingest(capture)

        XCTAssertEqual(first.id, identifier)
        XCTAssertEqual(retry, first)
        let storedItems = await repository.allItems()
        XCTAssertEqual(storedItems.count, 1)

        let conflicting = noteCapture(id: identifier, note: "Andere Adresse")
        do {
            _ = try await repository.ingest(conflicting)
            XCTFail("Conflicting stable IDs must fail closed")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .duplicateConflict(identifier))
        }
    }

    func testUnknownVersionAndNonHTTPLinkFailClosed() async throws {
        let repository = try repository(root: temporaryRoot())
        let wrongVersion = CaptureItemV1(
            contractVersion: 2,
            kind: .note,
            title: "Nicht unterstützt",
            provenance: RecallProvenanceV1(channel: .birdieDrop),
            note: "Text"
        )
        do {
            _ = try await repository.ingest(wrongVersion)
            XCTFail("Unknown versions must fail closed")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .invalidContractVersion(2))
        }

        let unsafeLink = CaptureItemV1(
            kind: .link,
            title: "Lokale Datei",
            provenance: RecallProvenanceV1(channel: .manualSelection),
            linkURL: URL(string: "file:///private/example")
        )
        do {
            _ = try await repository.ingest(unsafeLink)
            XCTFail("Only HTTP(S) links are allowed")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .unsupportedLinkScheme)
        }
    }

    func testVaultHidesPlaintextAndIsExcludedFromBackup() async throws {
        let root = try temporaryRoot()
        let repository = try repository(root: root)
        _ = try await repository.ingest(
            noteCapture(title: "Geheimes Hotel", note: "Sehr geheime Zimmernummer 407")
        )

        let vaultURL = root.appendingPathComponent("recall-store.v1.vault")
        let vault = try Data(contentsOf: vaultURL)
        XCTAssertEqual(String(data: vault.prefix(4), encoding: .utf8), "BRV1")
        XCTAssertNil(vault.range(of: Data("Geheimes Hotel".utf8)))
        XCTAssertNil(vault.range(of: Data("Zimmernummer 407".utf8)))
        XCTAssertEqual(try root.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)

        #if os(iOS) && !targetEnvironment(simulator)
        let attributes = try FileManager.default.attributesOfItem(atPath: vaultURL.path)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
        #endif
    }

    func testSelectedOriginalIsCopiedLocallyWithoutChangingSource() async throws {
        let root = try temporaryRoot()
        let source = root.deletingLastPathComponent().appendingPathComponent("selected-\(UUID().uuidString).jpg")
        let bytes = validJPEGData()
        try bytes.write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let repository = try repository(root: root)
        let identifier = UUID()

        let item = try await repository.ingest(localImageCapture(id: identifier, sourceURL: source))

        XCTAssertEqual(try Data(contentsOf: source), bytes)
        XCTAssertEqual(item.attachment?.byteCount, Int64(bytes.count))
        XCTAssertEqual(item.attachment?.contentTypeIdentifier, UTType.jpeg.identifier)
        let copiedDirectory = root
            .appendingPathComponent("attachments")
            .appendingPathComponent(identifier.uuidString.lowercased())
        XCTAssertTrue(FileManager.default.fileExists(atPath: copiedDirectory.path))
        XCTAssertEqual(try copiedDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    @MainActor
    func testBackgroundLockCancelsInFlightExtractionAndKeepsViewModelClear() async throws {
        let root = try temporaryRoot()
        let source = root.deletingLastPathComponent()
            .appendingPathComponent("background-\(UUID().uuidString).jpg")
        try validJPEGData().write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let extractor = SuspendedRecallTextExtractor()
        let repository = try repository(root: root, textExtractor: extractor)
        let model = RecallViewModel(repository: repository)
        let identifier = UUID()

        let intake = Task { @MainActor in
            await model.ingest(localImageCapture(id: identifier, sourceURL: source))
        }
        await extractor.waitUntilStarted()
        model.lockForBackground()

        let succeeded = await intake.value
        let storedItems = await repository.allItems()
        XCTAssertFalse(succeeded)
        XCTAssertTrue(storedItems.isEmpty)
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertTrue(model.searchResults.isEmpty)
    }

    func testClaimedImageAndPDFTypesRejectUndecodableContentWithoutOrphans() async throws {
        let root = try temporaryRoot()
        let repository = try repository(root: root)
        let fakeImage = root.deletingLastPathComponent()
            .appendingPathComponent("spoofed-\(UUID().uuidString).jpg")
        let truncatedImage = root.deletingLastPathComponent()
            .appendingPathComponent("truncated-\(UUID().uuidString).jpg")
        let fakePDF = root.deletingLastPathComponent()
            .appendingPathComponent("spoofed-\(UUID().uuidString).pdf")
        try Data("not an image".utf8).write(to: fakeImage)
        try Data(validJPEGData().prefix(48)).write(to: truncatedImage)
        try Data("%PDF-but-not-a-document".utf8).write(to: fakePDF)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: fakeImage)
            try? FileManager.default.removeItem(at: truncatedImage)
            try? FileManager.default.removeItem(at: fakePDF)
        }

        do {
            _ = try await repository.ingest(localImageCapture(sourceURL: fakeImage))
            XCTFail("A claimed image UTI must not bypass content decoding")
        } catch {
            guard let recallError = error as? BirdieRecallError,
                  case .invalidPayload = recallError
            else { return XCTFail("Unexpected image error: \(error)") }
        }

        do {
            _ = try await repository.ingest(localImageCapture(sourceURL: truncatedImage))
            XCTFail("A recognized but truncated image container must not bypass pixel decoding")
        } catch {
            guard let recallError = error as? BirdieRecallError,
                  case .invalidPayload = recallError
            else { return XCTFail("Unexpected truncated-image error: \(error)") }
        }

        do {
            _ = try await repository.ingest(
                CaptureItemV1(
                    kind: .pdf,
                    title: "Gefälschtes PDF",
                    provenance: RecallProvenanceV1(channel: .manualSelection),
                    localFileURL: fakePDF,
                    contentTypeIdentifier: UTType.pdf.identifier
                )
            )
            XCTFail("A claimed PDF UTI must not bypass PDF parsing")
        } catch {
            guard let recallError = error as? BirdieRecallError,
                  case .invalidPayload = recallError
            else { return XCTFail("Unexpected PDF error: \(error)") }
        }

        let attachmentChildren = try FileManager.default.contentsOfDirectory(
            at: root.appendingPathComponent("attachments"),
            includingPropertiesForKeys: nil
        )
        XCTAssertTrue(attachmentChildren.isEmpty)
    }
}
