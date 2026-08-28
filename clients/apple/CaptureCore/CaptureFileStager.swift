import CryptoKit
import Foundation

public final class CaptureFileStager: @unchecked Sendable {
    private let locations: CaptureStoreLocations
    private let fileManager: FileManager

    public init(locations: CaptureStoreLocations, fileManager: FileManager = .default) {
        self.locations = locations
        self.fileManager = fileManager
    }

    public func stageData(
        _ data: Data,
        itemID: UUID,
        kind: CapturePayloadKind,
        displayName: String,
        typeIdentifier: String?
    ) throws -> CapturePayload {
        guard !data.isEmpty else { throw CaptureCoreError.invalidPayload("Der Inhalt ist leer.") }
        guard Int64(data.count) <= CaptureLimits.maximumFileBytes else {
            throw CaptureCoreError.invalidPayload("Eine Datei darf höchstens 100 MB groß sein.")
        }
        let destination = try destinationURL(itemID: itemID, displayName: displayName)
        try ProtectedFileWriter.write(data, to: destination, fileManager: fileManager)
        return CapturePayload(
            kind: kind,
            displayName: displayName,
            typeIdentifier: typeIdentifier,
            relativeFilePath: relativePath(for: destination),
            byteCount: Int64(data.count),
            sha256: SHA256.hash(data: data).hexString
        )
    }

    public func stageFile(
        at sourceURL: URL,
        itemID: UUID,
        kind: CapturePayloadKind,
        displayName: String? = nil,
        typeIdentifier: String?
    ) throws -> CapturePayload {
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer { if accessed { sourceURL.stopAccessingSecurityScopedResource() } }

        let name = displayName ?? sourceURL.lastPathComponent
        let sourceValues = try sourceURL.resourceValues(forKeys: [
            .fileSizeKey,
            .isDirectoryKey,
            .isRegularFileKey,
            .isSymbolicLinkKey
        ])
        guard sourceValues.isDirectory != true,
              sourceValues.isSymbolicLink != true,
              sourceValues.isRegularFile == true else {
            throw CaptureCoreError.invalidPayload("Nur reguläre Dateien können übernommen werden.")
        }
        if let sourceSize = sourceValues.fileSize {
            guard sourceSize > 0 else {
                throw CaptureCoreError.invalidPayload("Leere Dateien können nicht übernommen werden.")
            }
            guard Int64(sourceSize) <= CaptureLimits.maximumFileBytes else {
                throw CaptureCoreError.invalidPayload("Eine Datei darf höchstens 100 MB groß sein.")
            }
        }
        let destination = try destinationURL(itemID: itemID, displayName: name)
        do {
            var coordinationError: NSError?
            let copyResult = FileCoordinationResult()

            NSFileCoordinator().coordinate(
                readingItemAt: sourceURL,
                options: [.withoutChanges],
                error: &coordinationError
            ) { coordinatedURL in
                do {
                    try fileManager.copyItem(at: coordinatedURL, to: destination)
                } catch {
                    copyResult.set(error)
                }
            }

            if let coordinationError { throw coordinationError }
            if let copyError = copyResult.error { throw copyError }
            try ProtectedFileWriter.applySensitiveAttributes(to: destination, fileManager: fileManager)
            let values = try destination.resourceValues(forKeys: [.fileSizeKey])
            guard let fileSize = values.fileSize, fileSize > 0 else {
                throw CaptureCoreError.invalidPayload("Leere Dateien können nicht übernommen werden.")
            }
            guard Int64(fileSize) <= CaptureLimits.maximumFileBytes else {
                throw CaptureCoreError.invalidPayload("Eine Datei darf höchstens 100 MB groß sein.")
            }
            return CapturePayload(
                kind: kind,
                displayName: name,
                typeIdentifier: typeIdentifier,
                relativeFilePath: relativePath(for: destination),
                byteCount: Int64(fileSize),
                sha256: try hashFile(at: destination)
            )
        } catch {
            try? fileManager.removeItem(at: destination)
            throw error
        }
    }

    public func discardStagedFiles(itemID: UUID) throws {
        let directory = locations.staging.appendingPathComponent(
            itemID.uuidString.lowercased(),
            isDirectory: true
        ).standardizedFileURL
        let stagingComponents = locations.staging.standardizedFileURL.pathComponents
        let directoryComponents = directory.pathComponents
        guard directoryComponents.count == stagingComponents.count + 1,
              Array(directoryComponents.prefix(stagingComponents.count)) == stagingComponents else {
            throw CaptureCoreError.unsafeRelativePath(directory.path)
        }
        if fileManager.fileExists(atPath: directory.path) {
            try fileManager.removeItem(at: directory)
        }
    }

    private func destinationURL(itemID: UUID, displayName: String) throws -> URL {
        let directory = locations.staging.appendingPathComponent(
            itemID.uuidString.lowercased(),
            isDirectory: true
        )
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try ProtectedFileWriter.applySensitiveAttributes(to: directory, fileManager: fileManager)

        let sanitized = displayName
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let safeName = sanitized.isEmpty ? "capture.bin" : String(sanitized.prefix(120))
        return directory.appendingPathComponent("\(UUID().uuidString.lowercased())-\(safeName)")
    }

    private func relativePath(for url: URL) -> String {
        let base = locations.root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        return String(path.dropFirst(base.count + 1)).replacingOccurrences(of: "\\", with: "/")
    }

    private func hashFile(at url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            guard let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty else { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().hexString
    }

}

private final class FileCoordinationResult: @unchecked Sendable {
    private let lock = NSLock()
    private var storedError: Error?

    var error: Error? {
        lock.lock()
        defer { lock.unlock() }
        return storedError
    }

    func set(_ error: Error) {
        lock.lock()
        storedError = error
        lock.unlock()
    }
}

private extension Digest {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
