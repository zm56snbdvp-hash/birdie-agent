import CryptoKit
import Foundation

public struct CaptureStoreLocations: Sendable {
    public let root: URL
    public let staging: URL
    public let items: URL
    public let outbox: URL
    public let tombstones: URL

    public init(root: URL) {
        self.root = root
        self.staging = root.appendingPathComponent("Staging", isDirectory: true)
        self.items = root.appendingPathComponent("Items", isDirectory: true)
        self.outbox = root.appendingPathComponent("MockOutbox", isDirectory: true)
        self.tombstones = root.appendingPathComponent("Tombstones", isDirectory: true)
    }

    public static func appGroup(_ identifier: String) throws -> Self {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: identifier
        ) else {
            throw CaptureCoreError.appGroupUnavailable(identifier)
        }
        return Self(root: container.appendingPathComponent("BirdieCapture", isDirectory: true))
    }
}

public final class CaptureQueueStore: @unchecked Sendable {
    public let locations: CaptureStoreLocations

    private let fileManager: FileManager
    private let lock = NSLock()
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(locations: CaptureStoreLocations, fileManager: FileManager = .default) throws {
        self.locations = locations
        self.fileManager = fileManager
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        try prepareDirectories()
        try cleanupStalePartials(olderThan: Date().addingTimeInterval(-3_600))
    }

    @discardableResult
    public func enqueue(_ item: CaptureItem) throws -> CaptureItem {
        try locked {
            let itemFile = itemFileURL(id: item.id)
            if fileManager.fileExists(atPath: tombstoneFileURL(id: item.id).path) {
                throw CaptureCoreError.itemCancelled(item.id)
            }
            if fileManager.fileExists(atPath: itemFile.path) {
                let existing = try readItemUnlocked(at: itemFile)
                guard existing.idempotencyKey == item.idempotencyKey,
                      hasSameImmutableContent(existing, item) else {
                    throw CaptureCoreError.idempotencyConflict(item.id)
                }
                return existing
            }
            try validateFileOwnership(of: item)
            try writeItemUnlocked(item)
            return item
        }
    }

    public func allItems() throws -> [CaptureItem] {
        try locked {
            let files = try fileManager.contentsOfDirectory(
                at: locations.items,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )
            return files
                .filter { $0.pathExtension == "json" }
                .compactMap(readQueueEntryUnlocked(at:))
                .sorted { $0.createdAt > $1.createdAt }
        }
    }

    public func item(id: UUID) throws -> CaptureItem? {
        try locked {
            let itemFile = itemFileURL(id: id)
            guard fileManager.fileExists(atPath: itemFile.path) else { return nil }
            return try readItemUnlocked(at: itemFile)
        }
    }

    public func validateIntegrity(of item: CaptureItem) throws {
        try locked {
            try validateFileOwnership(of: item)
            for payload in item.payloads {
                guard let relativePath = payload.relativeFilePath else { continue }
                let fileURL = try resolvedStagedFile(relativePath: relativePath, itemID: item.id)
                let values = try fileURL.resourceValues(forKeys: [
                    .fileSizeKey,
                    .isRegularFileKey,
                    .isSymbolicLinkKey
                ])
                guard values.isRegularFile == true,
                      values.isSymbolicLink != true,
                      let expectedSize = payload.byteCount,
                      values.fileSize.map(Int64.init) == expectedSize,
                      let expectedHash = payload.sha256,
                      try hashFile(at: fileURL) == expectedHash else {
                    throw CaptureCoreError.invalidPayload(
                        "Eine lokale Capture-Datei wurde nach der Übernahme verändert."
                    )
                }
            }
        }
    }

    @discardableResult
    public func update(id: UUID, mutate: (inout CaptureItem) throws -> Void) throws -> CaptureItem {
        try locked {
            let itemFile = itemFileURL(id: id)
            guard fileManager.fileExists(atPath: itemFile.path) else {
                throw CaptureCoreError.itemNotFound(id)
            }
            var item = try readItemUnlocked(at: itemFile)
            try mutate(&item)
            item.updatedAt = Date()
            try writeItemUnlocked(item)
            return item
        }
    }

    public func delete(id: UUID) throws {
        try locked {
            let itemFile = itemFileURL(id: id)
            guard fileManager.fileExists(atPath: itemFile.path) else {
                throw CaptureCoreError.itemNotFound(id)
            }
            let tombstone = tombstoneFileURL(id: id)
            try ProtectedFileWriter.write(
                Data(id.uuidString.lowercased().utf8),
                to: tombstone,
                fileManager: fileManager
            )
            let itemDirectory = locations.staging.appendingPathComponent(
                id.uuidString.lowercased(),
                isDirectory: true
            ).standardizedFileURL
            let stagingComponents = locations.staging.standardizedFileURL.pathComponents
            let itemComponents = itemDirectory.pathComponents
            guard itemComponents.count == stagingComponents.count + 1,
                  Array(itemComponents.prefix(stagingComponents.count)) == stagingComponents else {
                throw CaptureCoreError.unsafeRelativePath(itemDirectory.path)
            }
            if fileManager.fileExists(atPath: itemDirectory.path) {
                try fileManager.removeItem(at: itemDirectory)
            }
            let outboxFile = locations.outbox.appendingPathComponent(
                "\(id.uuidString.lowercased()).json"
            )
            if fileManager.fileExists(atPath: outboxFile.path) {
                try fileManager.removeItem(at: outboxFile)
            }
            if fileManager.fileExists(atPath: pendingOpenFile.path),
               let pendingID = try? String(contentsOf: pendingOpenFile, encoding: .utf8),
               pendingID.trimmingCharacters(in: .whitespacesAndNewlines) == id.uuidString.lowercased() {
                try fileManager.removeItem(at: pendingOpenFile)
            }
            try fileManager.removeItem(at: itemFile)
        }
    }

    public func markForOpening(id: UUID) throws {
        try locked {
            guard fileManager.fileExists(atPath: itemFileURL(id: id).path) else {
                throw CaptureCoreError.itemNotFound(id)
            }
            let data = Data(id.uuidString.lowercased().utf8)
            try ProtectedFileWriter.write(data, to: pendingOpenFile, fileManager: fileManager)
        }
    }

    public func consumePendingOpen() throws -> UUID? {
        try locked {
            guard fileManager.fileExists(atPath: pendingOpenFile.path) else { return nil }
            let value = try String(contentsOf: pendingOpenFile, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            try fileManager.removeItem(at: pendingOpenFile)
            guard let id = UUID(uuidString: value),
                  fileManager.fileExists(atPath: itemFileURL(id: id).path) else { return nil }
            return id
        }
    }

    public func resolvedStagedFile(relativePath: String) throws -> URL {
        guard !relativePath.isEmpty, !relativePath.hasPrefix("/"), !relativePath.contains("..") else {
            throw CaptureCoreError.unsafeRelativePath(relativePath)
        }
        let candidate = locations.root.appendingPathComponent(relativePath).standardizedFileURL
        guard isDescendant(candidate, of: locations.staging) else {
            throw CaptureCoreError.unsafeRelativePath(relativePath)
        }
        return candidate
    }

    public func resolvedStagedFile(relativePath: String, itemID: UUID) throws -> URL {
        let candidate = try resolvedStagedFile(relativePath: relativePath)
        let itemDirectory = locations.staging.appendingPathComponent(
            itemID.uuidString.lowercased(),
            isDirectory: true
        )
        guard isDescendant(candidate, of: itemDirectory) else {
            throw CaptureCoreError.unsafeRelativePath(relativePath)
        }
        return candidate
    }

    public func cleanupOrphanedStaging(olderThan cutoff: Date) throws {
        try locked {
            let directories = try fileManager.contentsOfDirectory(
                at: locations.staging,
                includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
                options: [.skipsHiddenFiles]
            )
            for directory in directories {
                let values = try directory.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
                guard values.isDirectory == true,
                      let itemID = UUID(uuidString: directory.lastPathComponent),
                      values.contentModificationDate.map({ $0 < cutoff }) ?? false,
                      !fileManager.fileExists(atPath: itemFileURL(id: itemID).path),
                      isDescendant(directory, of: locations.staging) else { continue }
                try fileManager.removeItem(at: directory)
            }
        }
    }

    public func cleanupStalePartials(olderThan cutoff: Date) throws {
        try locked {
            guard let enumerator = fileManager.enumerator(
                at: locations.root,
                includingPropertiesForKeys: [
                    .contentModificationDateKey,
                    .isRegularFileKey,
                    .isSymbolicLinkKey
                ],
                options: [.skipsPackageDescendants]
            ) else { return }
            for case let fileURL as URL in enumerator {
                guard fileURL.lastPathComponent.hasPrefix("."),
                      fileURL.lastPathComponent.hasSuffix(".partial"),
                      isDescendant(fileURL, of: locations.root) else { continue }
                let values = try fileURL.resourceValues(forKeys: [
                    .contentModificationDateKey,
                    .isRegularFileKey,
                    .isSymbolicLinkKey
                ])
                guard values.isRegularFile == true,
                      values.isSymbolicLink != true,
                      values.contentModificationDate.map({ $0 < cutoff }) ?? false else { continue }
                try fileManager.removeItem(at: fileURL)
            }
        }
    }

    private func prepareDirectories() throws {
        for directory in [
            locations.root,
            locations.staging,
            locations.items,
            locations.outbox,
            locations.tombstones
        ] {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try ProtectedFileWriter.applySensitiveAttributes(to: directory, fileManager: fileManager)
        }
    }

    private func readItemUnlocked(at url: URL) throws -> CaptureItem {
        let data = try Data(contentsOf: url)
        let item = try decoder.decode(CaptureItem.self, from: data)
        guard item.schemaVersion == CaptureItem.currentSchemaVersion else {
            throw CaptureCoreError.unsupportedSchema(item.schemaVersion)
        }
        guard let fileID = UUID(uuidString: url.deletingPathExtension().lastPathComponent),
              item.id == fileID,
              item.idempotencyKey == "capture.v1.\(fileID.uuidString.lowercased())" else {
            throw CaptureCoreError.invalidPayload(
                "Manifest-ID und lokaler Dateiname stimmen nicht überein."
            )
        }
        return item
    }

    private func readQueueEntryUnlocked(at url: URL) -> CaptureItem? {
        do {
            return try readItemUnlocked(at: url)
        } catch {
            guard let id = UUID(uuidString: url.deletingPathExtension().lastPathComponent) else {
                return nil
            }
            let modifiedAt = (try? url.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate) ?? Date.distantPast
            var recoveryItem = CaptureItem(
                id: id,
                createdAt: modifiedAt,
                source: .shareExtension,
                intent: .remember,
                status: .failed,
                payloads: [],
                originalStorageConsent: .confirmed,
                originalPolicy: .derivedTextOnly,
                containsSensitiveData: true
            )
            recoveryItem.lastFailure = CaptureFailure(
                code: "corrupt_manifest",
                message: "Der lokale Eintrag ist nicht lesbar. Er wurde nicht verarbeitet und kann sicher gelöscht werden.",
                isRetryable: false
            )
            return recoveryItem
        }
    }

    private func validateFileOwnership(of item: CaptureItem) throws {
        try validateFilePaths(of: item)
        for payload in item.payloads {
            guard let relativePath = payload.relativeFilePath else { continue }
            let fileURL = try resolvedStagedFile(relativePath: relativePath, itemID: item.id)
            guard fileManager.fileExists(atPath: fileURL.path) else {
                throw CaptureCoreError.invalidPayload("Eine lokale Capture-Datei fehlt.")
            }
        }
    }

    private func validateFilePaths(of item: CaptureItem) throws {
        for payload in item.payloads {
            guard let relativePath = payload.relativeFilePath else { continue }
            _ = try resolvedStagedFile(relativePath: relativePath, itemID: item.id)
        }
    }

    private func writeItemUnlocked(_ item: CaptureItem) throws {
        let itemFile = itemFileURL(id: item.id)
        let data = try encoder.encode(item)
        try ProtectedFileWriter.write(data, to: itemFile, fileManager: fileManager)
    }

    private func hasSameImmutableContent(_ lhs: CaptureItem, _ rhs: CaptureItem) -> Bool {
        lhs.schemaVersion == rhs.schemaVersion
            && lhs.id == rhs.id
            && lhs.idempotencyKey == rhs.idempotencyKey
            && lhs.createdAt == rhs.createdAt
            && lhs.source == rhs.source
            && lhs.intent == rhs.intent
            && lhs.payloads == rhs.payloads
            && lhs.suggestions == rhs.suggestions
            && lhs.originalStorageConsent == rhs.originalStorageConsent
            && lhs.originalPolicy == rhs.originalPolicy
            && lhs.containsSensitiveData == rhs.containsSensitiveData
    }

    private func hashFile(at url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            guard let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty else { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func itemFileURL(id: UUID) -> URL {
        locations.items.appendingPathComponent("\(id.uuidString.lowercased()).json")
    }

    private func tombstoneFileURL(id: UUID) -> URL {
        locations.tombstones.appendingPathComponent("\(id.uuidString.lowercased()).deleted")
    }

    private var pendingOpenFile: URL {
        locations.root.appendingPathComponent("pending-open-id.txt")
    }

    private func locked<T>(_ operation: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try operation()
    }

    private func isDescendant(_ candidate: URL, of directory: URL) -> Bool {
        let base = directory.standardizedFileURL.pathComponents
        let path = candidate.standardizedFileURL.pathComponents
        return path.count > base.count && Array(path.prefix(base.count)) == base
    }

}
