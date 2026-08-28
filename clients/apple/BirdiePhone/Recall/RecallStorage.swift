import CryptoKit
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

struct RecallPendingDeletionV1: Codable, Hashable, Sendable {
    let operationIdentifier: UUID
    let scope: RecallDeletionScopeV1
    let reason: String
    let requestedAt: Date
}

struct RecallStoredItemV1: Codable, Hashable, Identifiable, Sendable {
    var id: UUID { item.id }
    var item: RecallItemV1
    let attachmentRelativePath: String?
    let intakeFingerprint: String
    var pendingDeletion: RecallPendingDeletionV1?
}

struct RecallDiskStateV1: Codable, Hashable, Sendable {
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    var revision: UInt64
    var settings: RecallSettingsV1
    var items: [RecallStoredItemV1]
    var deletionReceipts: [RecallDeletionReceiptV1]
    var localIndex: RecallLocalSearchIndexV1
    var requiresExternalIndexSync: Bool

    static func empty(now: Date) -> RecallDiskStateV1 {
        RecallDiskStateV1(
            schemaVersion: currentSchemaVersion,
            revision: 0,
            settings: RecallSettingsV1(changedAt: now),
            items: [],
            deletionReceipts: [],
            localIndex: RecallLocalSearchIndexV1(),
            requiresExternalIndexSync: false
        )
    }
}

struct RecallImportedAttachment: Sendable {
    let relativePath: String
    let metadata: RecallAttachmentMetadataV1
}

struct RecallSourceFileInspection: Sendable {
    let filename: String
    let byteCount: Int64
    let sha256: String
}

struct RecallProtectedDisk: @unchecked Sendable {
    static let maximumAttachmentBytes: Int64 = 100 * 1_024 * 1_024
    private static let stateMutationLock = NSLock()

    let rootDirectory: URL
    private let fileManager: FileManager
    private let encryptionKey: SymmetricKey

    private var stateURL: URL { rootDirectory.appendingPathComponent("recall-store.v1.vault") }
    private var attachmentsURL: URL { rootDirectory.appendingPathComponent("attachments", isDirectory: true) }

    init(
        rootDirectory: URL,
        encryptionKey: SymmetricKey,
        fileManager: FileManager = .default
    ) {
        self.rootDirectory = rootDirectory.standardizedFileURL
        self.encryptionKey = encryptionKey
        self.fileManager = fileManager
    }

    func prepare() throws {
        do {
            try fileManager.createDirectory(
                at: rootDirectory,
                withIntermediateDirectories: true,
                attributes: protectionAttributes
            )
            try fileManager.createDirectory(
                at: attachmentsURL,
                withIntermediateDirectories: true,
                attributes: protectionAttributes
            )
            try protectAndExcludeFromBackup(rootDirectory)
            try protectAndExcludeFromBackup(attachmentsURL)
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func loadState(now: Date) throws -> RecallDiskStateV1 {
        guard fileManager.fileExists(atPath: stateURL.path) else {
            return .empty(now: now)
        }

        do {
            let sealedData = try Data(contentsOf: stateURL)
            let data = try openVault(sealedData)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let state = try decoder.decode(RecallDiskStateV1.self, from: data)
            guard state.schemaVersion == RecallDiskStateV1.currentSchemaVersion else {
                throw BirdieRecallError.invalidContractVersion(state.schemaVersion)
            }
            return state
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func saveState(
        _ state: RecallDiskStateV1,
        expectedRevision: UInt64? = nil
    ) throws {
        Self.stateMutationLock.lock()
        defer { Self.stateMutationLock.unlock() }
        do {
            if let expectedRevision {
                let persistedRevision = try loadState(now: Date()).revision
                guard persistedRevision == expectedRevision else {
                    throw BirdieRecallError.persistence(
                        "Eine neuere Recall-Revision liegt bereits vor; veraltete Daten wurden nicht überschrieben."
                    )
                }
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            let cleartext = try encoder.encode(state)
            let data = try sealVault(cleartext)
            try data.write(to: stateURL, options: [.atomic])
            try protectAndExcludeFromBackup(stateURL)
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func importAttachment(
        from sourceURL: URL,
        itemID: UUID,
        kind: RecallItemKindV1
    ) throws -> RecallImportedAttachment {
        guard sourceURL.isFileURL else { throw BirdieRecallError.sourceFileUnavailable }

        let accessedSecurityScope = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScope { sourceURL.stopAccessingSecurityScopedResource() }
        }

        do {
            let values = try sourceURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .nameKey])
            guard values.isRegularFile == true else { throw BirdieRecallError.sourceFileUnavailable }

            let byteCount = Int64(values.fileSize ?? 0)
            guard byteCount <= Self.maximumAttachmentBytes else {
                throw BirdieRecallError.attachmentTooLarge(byteCount)
            }

            let itemDirectory = attachmentsURL.appendingPathComponent(
                itemID.uuidString.lowercased(),
                isDirectory: true
            )
            guard !fileManager.fileExists(atPath: itemDirectory.path) else {
                throw BirdieRecallError.persistence("Für diese stabile ID existiert bereits ein lokaler Dateibereich.")
            }
            try fileManager.createDirectory(
                at: itemDirectory,
                withIntermediateDirectories: false,
                attributes: protectionAttributes
            )
            try protectAndExcludeFromBackup(itemDirectory)

            let pathExtension = safePathExtension(sourceURL.pathExtension)
            let destinationName = pathExtension.isEmpty ? "payload" : "payload.\(pathExtension)"
            let destinationURL = itemDirectory.appendingPathComponent(destinationName)
            let incomingURL = itemDirectory.appendingPathComponent(".incoming-\(UUID().uuidString)")

            let copiedByteCount: Int64
            let copiedSHA256: String
            let actualContentTypeIdentifier: String
            do {
                try fileManager.copyItem(at: sourceURL, to: incomingURL)
                try protectAndExcludeFromBackup(incomingURL)
                let copiedValues = try incomingURL.resourceValues(
                    forKeys: [.isRegularFileKey, .fileSizeKey]
                )
                guard copiedValues.isRegularFile == true else {
                    throw BirdieRecallError.sourceFileUnavailable
                }
                copiedByteCount = Int64(copiedValues.fileSize ?? 0)
                guard copiedByteCount <= Self.maximumAttachmentBytes else {
                    throw BirdieRecallError.attachmentTooLarge(copiedByteCount)
                }
                actualContentTypeIdentifier = try verifyContentTypeIdentifier(
                    at: incomingURL,
                    kind: kind
                )
                copiedSHA256 = try sha256(of: incomingURL)
                try fileManager.moveItem(at: incomingURL, to: destinationURL)
                try protectAndExcludeFromBackup(destinationURL)
            } catch {
                // A copy may already have been moved. Remove the whole per-item area so
                // failed intake can never strand a plaintext original outside the vault state.
                try? fileManager.removeItem(at: itemDirectory)
                throw error
            }

            let relativePath = destinationURL.path.replacingOccurrences(
                of: rootDirectory.path + pathSeparator,
                with: ""
            )
            return RecallImportedAttachment(
                relativePath: relativePath,
                metadata: RecallAttachmentMetadataV1(
                    originalFilename: values.name ?? sourceURL.lastPathComponent,
                    contentTypeIdentifier: actualContentTypeIdentifier,
                    byteCount: copiedByteCount,
                    sha256: copiedSHA256
                )
            )
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func inspectAttachmentSource(_ sourceURL: URL) throws -> RecallSourceFileInspection {
        guard sourceURL.isFileURL else { throw BirdieRecallError.sourceFileUnavailable }
        let accessedSecurityScope = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScope { sourceURL.stopAccessingSecurityScopedResource() }
        }

        do {
            let values = try sourceURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .nameKey])
            guard values.isRegularFile == true else { throw BirdieRecallError.sourceFileUnavailable }
            let byteCount = Int64(values.fileSize ?? 0)
            guard byteCount <= Self.maximumAttachmentBytes else {
                throw BirdieRecallError.attachmentTooLarge(byteCount)
            }
            return RecallSourceFileInspection(
                filename: values.name ?? sourceURL.lastPathComponent,
                byteCount: byteCount,
                sha256: try sha256(of: sourceURL)
            )
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func removeAttachment(relativePath: String?) throws {
        guard let relativePath else { return }
        let attachmentURL = try validatedAttachmentURL(relativePath: relativePath)
        let itemDirectory = attachmentURL.deletingLastPathComponent()
        guard fileManager.fileExists(atPath: itemDirectory.path) else { return }

        do {
            try fileManager.removeItem(at: itemDirectory)
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func removeOrphanedAttachments(referencedRelativePaths: [String]) throws {
        do {
            let referencedDirectories = try Set(referencedRelativePaths.map { relativePath in
                try validatedAttachmentURL(relativePath: relativePath)
                    .deletingLastPathComponent()
                    .standardizedFileURL.path
            })
            let children = try fileManager.contentsOfDirectory(
                at: attachmentsURL,
                includingPropertiesForKeys: nil,
                options: []
            )
            for child in children where !referencedDirectories.contains(child.standardizedFileURL.path) {
                try fileManager.removeItem(at: child)
            }
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func removeAllAttachments() throws {
        do {
            if fileManager.fileExists(atPath: attachmentsURL.path) {
                try fileManager.removeItem(at: attachmentsURL)
            }
            try fileManager.createDirectory(
                at: attachmentsURL,
                withIntermediateDirectories: false,
                attributes: protectionAttributes
            )
            try protectAndExcludeFromBackup(attachmentsURL)
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func attachmentData(relativePath: String) throws -> Data {
        do {
            return try Data(contentsOf: validatedAttachmentURL(relativePath: relativePath))
        } catch let error as BirdieRecallError {
            throw error
        } catch {
            throw BirdieRecallError.persistence(error.localizedDescription)
        }
    }

    func fileProtectionValue(at url: URL) throws -> Any? {
        try fileManager.attributesOfItem(atPath: url.path)[.protectionKey]
    }

    private func validatedAttachmentURL(relativePath: String) throws -> URL {
        let candidate = rootDirectory.appendingPathComponent(relativePath).standardizedFileURL
        let protectedPrefix = attachmentsURL.standardizedFileURL.path + pathSeparator
        guard candidate.path.hasPrefix(protectedPrefix) else {
            throw BirdieRecallError.persistence("Unsicherer Attachment-Pfad wurde abgewiesen.")
        }
        return candidate
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var digest = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            digest.update(data: chunk)
        }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func verifyContentTypeIdentifier(
        at url: URL,
        kind: RecallItemKindV1
    ) throws -> String {
        switch kind {
        case .photo, .screenshot:
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  CGImageSourceGetCount(source) > 0,
                  let sourceType = CGImageSourceGetType(source),
                  let uniformType = UTType(sourceType as String),
                  uniformType.conforms(to: .image),
                  CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
            else {
                throw BirdieRecallError.invalidPayload(
                    "Die ausgewählte Datei ist kein decodierbares Bild."
                )
            }
            return uniformType.identifier
        case .pdf:
            guard let document = PDFDocument(url: url), document.pageCount > 0 else {
                throw BirdieRecallError.invalidPayload(
                    "Die ausgewählte Datei ist kein gültiges PDF mit mindestens einer Seite."
                )
            }
            return UTType.pdf.identifier
        case .link, .note:
            throw BirdieRecallError.invalidPayload("Dieser Recall-Typ darf keine Datei enthalten.")
        }
    }

    private func sealVault(_ cleartext: Data) throws -> Data {
        let sealedBox = try AES.GCM.seal(cleartext, using: encryptionKey)
        guard let combined = sealedBox.combined else {
            throw BirdieRecallError.persistence("Der verschlüsselte Vault konnte nicht erzeugt werden.")
        }
        var result = Data("BRV1".utf8)
        result.append(combined)
        return result
    }

    private func openVault(_ data: Data) throws -> Data {
        let header = Data("BRV1".utf8)
        guard data.count > header.count, data.prefix(header.count) == header else {
            throw BirdieRecallError.persistence("Unbekanntes oder beschädigtes Vault-Format.")
        }
        let sealedBox = try AES.GCM.SealedBox(combined: Data(data.dropFirst(header.count)))
        return try AES.GCM.open(sealedBox, using: encryptionKey)
    }

    private func safePathExtension(_ value: String) -> String {
        String(value.lowercased().filter { $0.isLetter || $0.isNumber }.prefix(12))
    }

    private var pathSeparator: String {
        #if os(Windows)
        "\\"
        #else
        "/"
        #endif
    }

    private var protectionAttributes: [FileAttributeKey: Any] {
        #if os(iOS)
        [.protectionKey: FileProtectionType.complete]
        #else
        [:]
        #endif
    }

    private func protectAndExcludeFromBackup(_ url: URL) throws {
        #if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path
        )
        #endif

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = url
        try mutableURL.setResourceValues(values)
    }
}
