import CryptoKit
import Foundation
import XCTest
@testable import Birdie

final class RecallDeletionTests: RecallTestCase {
    func testSingleDeletionRemovesOriginalLocalIndexAndSpotlight() async throws {
        let root = try temporaryRoot()
        let source = root.deletingLastPathComponent().appendingPathComponent("delete-\(UUID().uuidString).jpg")
        try validJPEGData().write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let externalIndex = RecordingRecallExternalIndex()
        let repository = try repository(root: root, index: externalIndex)
        try await repository.setSpotlightEnabled(true)
        let identifier = UUID()
        _ = try await repository.ingest(localImageCapture(id: identifier, sourceURL: source))
        let initiallyIndexedLocally = await repository.containsInLocalIndex(identifier)
        let initiallyIndexedExternally = (await externalIndex.snapshot()).contains(identifier)
        XCTAssertTrue(initiallyIndexedLocally)
        XCTAssertTrue(initiallyIndexedExternally)

        let receipt = try await repository.forget(identifier)

        XCTAssertEqual(receipt.itemIdentifiers, [identifier])
        let remainsInLocalIndex = await repository.containsInLocalIndex(identifier)
        let remainsInExternalIndex = (await externalIndex.snapshot()).contains(identifier)
        let remainingItems = await repository.allItems()
        XCTAssertFalse(remainsInLocalIndex)
        XCTAssertFalse(remainsInExternalIndex)
        XCTAssertTrue(remainingItems.isEmpty)
        let itemDirectory = root.appendingPathComponent("attachments/\(identifier.uuidString.lowercased())")
        XCTAssertFalse(FileManager.default.fileExists(atPath: itemDirectory.path))
        let history = await repository.deletionHistory()
        XCTAssertEqual(history.first?.operationIdentifier, receipt.operationIdentifier)
    }

    func testMassDeletionAndKillSwitchAreAuditedAndBlockAccess() async throws {
        let repository = try repository(root: temporaryRoot())
        _ = try await repository.ingest(noteCapture(title: "Hotel eins"))
        _ = try await repository.ingest(noteCapture(title: "Hotel zwei"))

        let receipt = try await repository.engageKillSwitch()

        XCTAssertEqual(receipt.scope, .killSwitch)
        XCTAssertEqual(receipt.deletedItemCount, 2)
        let settings = await repository.currentSettings()
        let remainingItems = await repository.allItems()
        XCTAssertFalse(settings.isEnabled)
        XCTAssertTrue(remainingItems.isEmpty)

        do {
            _ = try await repository.ingest(noteCapture())
            XCTFail("Kill switch must block intake")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .disabled)
        }
        do {
            _ = try await repository.search(RecallSearchQueryV1(text: "Hotel"))
            XCTFail("Kill switch must block search")
        } catch {
            XCTAssertEqual(error as? BirdieRecallError, .disabled)
        }
    }

    func testExpiredItemsUseTheSameAuditedDeletionPathAfterRestart() async throws {
        let root = try temporaryRoot()
        let expiresAt = Self.fixedNow.addingTimeInterval(3_600)
        let original = try repository(root: root)
        let identifier = UUID()
        _ = try await original.ingest(
            noteCapture(id: identifier, retention: .until(expiresAt))
        )

        let later = Self.fixedNow.addingTimeInterval(7_200)
        let reopened = try repository(root: root, now: later)
        try await reopened.prepareForUse()

        let remainingItems = await reopened.allItems()
        let remainsIndexed = await reopened.containsInLocalIndex(identifier)
        let history = await reopened.deletionHistory()
        XCTAssertTrue(remainingItems.isEmpty)
        XCTAssertFalse(remainsIndexed)
        let receipt = try XCTUnwrap(history.first)
        XCTAssertEqual(receipt.scope, .expiredItems)
        XCTAssertEqual(receipt.itemIdentifiers, [identifier])
    }

    func testInterruptedSpotlightCleanupIsRetriedFromEncryptedState() async throws {
        let root = try temporaryRoot()
        let externalIndex = RecordingRecallExternalIndex()
        let original = try repository(root: root, index: externalIndex)
        try await original.setSpotlightEnabled(true)
        let identifier = UUID()
        _ = try await original.ingest(noteCapture(id: identifier))
        await externalIndex.failNextRemoveAll()

        do {
            _ = try await original.forget(identifier)
            XCTFail("The injected Spotlight failure should be surfaced")
        } catch {
            guard let recallError = error as? BirdieRecallError,
                  case .externalIndexCleanup = recallError
            else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
        let locallyDeleted = await original.allItems()
        let staleExternalSnapshot = await externalIndex.snapshot()
        XCTAssertTrue(locallyDeleted.isEmpty)
        XCTAssertTrue(staleExternalSnapshot.contains(identifier))

        let reopened = try repository(root: root, index: externalIndex)
        try await reopened.prepareForUse()
        let repairedSnapshot = await externalIndex.snapshot()
        XCTAssertFalse(repairedSnapshot.contains(identifier))
    }

    func testStartupRemovesOrphanedOriginalButPreservesReferencedAttachment() async throws {
        let root = try temporaryRoot()
        let source = root.deletingLastPathComponent().appendingPathComponent("kept-\(UUID().uuidString).jpg")
        let expectedBytes = validJPEGData()
        try expectedBytes.write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let identifier = UUID()
        let original = try repository(root: root)
        _ = try await original.ingest(localImageCapture(id: identifier, sourceURL: source))

        let orphanDirectory = root.appendingPathComponent("attachments/orphaned-after-crash")
        try FileManager.default.createDirectory(at: orphanDirectory, withIntermediateDirectories: true)
        try Data("orphaned secret".utf8).write(to: orphanDirectory.appendingPathComponent("payload.jpg"))

        let reopened = try repository(root: root)
        try await reopened.prepareForUse()

        let referencedPayload = root.appendingPathComponent(
            "attachments/\(identifier.uuidString.lowercased())/payload.jpg"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphanDirectory.path))
        XCTAssertEqual(try Data(contentsOf: referencedPayload), expectedBytes)
    }

    func testInterruptedKillSwitchStateIsRecoveredAndRemovesEveryOriginal() async throws {
        let root = try temporaryRoot()
        let source = root.deletingLastPathComponent().appendingPathComponent("kill-crash-\(UUID().uuidString).jpg")
        try validJPEGData().write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let identifier = UUID()
        let original = try repository(root: root)
        _ = try await original.ingest(localImageCapture(id: identifier, sourceURL: source))

        // Simulate termination from an older build after persisting "disabled" but before
        // marking items pending deletion. Startup must fail closed and finish the deletion.
        let disk = RecallProtectedDisk(
            rootDirectory: root,
            encryptionKey: SymmetricKey(data: Self.fixedKey)
        )
        var interruptedState = try disk.loadState(now: Self.fixedNow)
        interruptedState.settings.isEnabled = false
        interruptedState.settings.isSpotlightEnabled = false
        interruptedState.requiresExternalIndexSync = true
        try disk.saveState(interruptedState)

        let reopened = try repository(root: root)
        try await reopened.prepareForUse()

        let settings = await reopened.currentSettings()
        let remaining = await reopened.allItems()
        let history = await reopened.deletionHistory()
        let attachments = root.appendingPathComponent("attachments")
        let attachmentChildren = try FileManager.default.contentsOfDirectory(
            at: attachments,
            includingPropertiesForKeys: nil
        )
        XCTAssertFalse(settings.isEnabled)
        XCTAssertTrue(remaining.isEmpty)
        XCTAssertTrue(attachmentChildren.isEmpty)
        XCTAssertEqual(history.first?.scope, .killSwitch)
        XCTAssertEqual(history.first?.itemIdentifiers, [identifier])
    }

    func testLocalIndexRepairPreservesPendingSpotlightCleanupMarker() async throws {
        let root = try temporaryRoot()
        let identifier = UUID()
        let original = try repository(root: root)
        _ = try await original.ingest(noteCapture(id: identifier))

        let disk = RecallProtectedDisk(
            rootDirectory: root,
            encryptionKey: SymmetricKey(data: Self.fixedKey)
        )
        var interruptedState = try disk.loadState(now: Self.fixedNow)
        interruptedState.settings.isSpotlightEnabled = false
        interruptedState.requiresExternalIndexSync = true
        interruptedState.localIndex.remove([identifier])
        try disk.saveState(interruptedState)

        let externalIndex = RecordingRecallExternalIndex()
        await externalIndex.seed([identifier])
        let reopened = try repository(root: root, index: externalIndex)
        try await reopened.prepareForUse()

        let externalSnapshot = await externalIndex.snapshot()
        let localItems = await reopened.allItems()
        XCTAssertFalse(externalSnapshot.contains(identifier))
        XCTAssertEqual(localItems.map(\.id), [identifier])
    }

    func testBlockedExternalSyncCannotOverwriteNewerIntakeRevision() async throws {
        let root = try temporaryRoot()
        let externalIndex = SuspendedRecallExternalIndex()
        let activeRepository = try repository(root: root, index: externalIndex)
        let firstIdentifier = UUID()
        let secondIdentifier = UUID()
        _ = try await activeRepository.ingest(noteCapture(id: firstIdentifier, title: "Hotel vorher"))

        let enabling = Task { try await activeRepository.setSpotlightEnabled(true) }
        await externalIndex.waitUntilStarted()
        await activeRepository.suspendAccess()
        let concurrentIntake = Task {
            try await activeRepository.ingest(noteCapture(id: secondIdentifier, title: "Hotel nach Vordergrund"))
        }

        await externalIndex.waitUntilSecondOperationStarted()
        let identifiersDuringBlockedSync = (await activeRepository.allItems()).map(\.id)
        XCTAssertTrue(identifiersDuringBlockedSync.contains(secondIdentifier))
        await externalIndex.release()
        try await enabling.value
        _ = try await concurrentIntake.value

        let reopened = try repository(root: root)
        let persistedIdentifiers = Set((await reopened.allItems()).map(\.id))
        XCTAssertEqual(persistedIdentifiers, Set([firstIdentifier, secondIdentifier]))
    }

    func testStaleRepositoryInstanceCannotOverwriteNewerVaultRevision() async throws {
        let root = try temporaryRoot()
        let first = try repository(root: root)
        let stale = try repository(root: root)
        let preservedIdentifier = UUID()
        _ = try await first.ingest(noteCapture(id: preservedIdentifier, title: "Muss erhalten bleiben"))

        do {
            _ = try await stale.ingest(noteCapture(title: "Veralteter Schreibversuch"))
            XCTFail("A stale repository must not overwrite a newer encrypted revision")
        } catch {
            guard let recallError = error as? BirdieRecallError,
                  case .persistence = recallError
            else { return XCTFail("Unexpected stale-write error: \(error)") }
        }

        let reopened = try repository(root: root)
        let persistedIdentifiers = (await reopened.allItems()).map(\.id)
        XCTAssertEqual(persistedIdentifiers, [preservedIdentifier])
    }
}
