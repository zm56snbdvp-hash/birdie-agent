import Foundation

enum ProtectedFileWriter {
    static func write(
        _ data: Data,
        to destination: URL,
        fileManager: FileManager = .default
    ) throws {
        let temporary = destination.deletingLastPathComponent().appendingPathComponent(
            ".\(destination.lastPathComponent).\(UUID().uuidString.lowercased()).partial"
        )
        do {
            try data.write(to: temporary, options: [.completeFileProtection])
            try applySensitiveAttributes(to: temporary, fileManager: fileManager)
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(
                    destination,
                    withItemAt: temporary,
                    backupItemName: nil,
                    options: [.usingNewMetadataOnly]
                )
            } else {
                try fileManager.moveItem(at: temporary, to: destination)
            }
        } catch {
            try? fileManager.removeItem(at: temporary)
            throw error
        }
    }

    static func applySensitiveAttributes(
        to url: URL,
        fileManager: FileManager = .default
    ) throws {
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path
        )
        var protectedURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protectedURL.setResourceValues(values)
    }
}
