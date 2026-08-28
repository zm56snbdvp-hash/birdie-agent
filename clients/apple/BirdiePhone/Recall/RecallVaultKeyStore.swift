import CryptoKit
import Foundation
import Security

protocol RecallVaultKeyProviding: Sendable {
    func loadOrCreateKey() throws -> SymmetricKey
}

struct KeychainRecallVaultKeyProvider: RecallVaultKeyProviding {
    private let service = "de.birdieandbreakfast.birdie.recall"
    private let account = "recall-vault-key-v1"

    func loadOrCreateKey() throws -> SymmetricKey {
        if let existing = try loadKeyData() {
            guard existing.count == 32 else {
                throw BirdieRecallError.persistence("Der vorhandene Recall-Vault-Schlüssel ist ungültig.")
            }
            return SymmetricKey(data: existing)
        }

        var bytes = [UInt8](repeating: 0, count: 32)
        let randomStatus = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard randomStatus == errSecSuccess else {
            throw BirdieRecallError.persistence("Keychain-Zufallsgenerator: \(randomStatus)")
        }
        let keyData = Data(bytes)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: keyData
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem, let racedKey = try loadKeyData(), racedKey.count == 32 {
            return SymmetricKey(data: racedKey)
        }
        guard status == errSecSuccess else {
            throw BirdieRecallError.persistence("Keychain konnte den Recall-Schlüssel nicht sichern: \(status)")
        }
        return SymmetricKey(data: keyData)
    }

    private func loadKeyData() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw BirdieRecallError.persistence("Keychain konnte den Recall-Schlüssel nicht lesen: \(status)")
        }
        return data
    }
}

struct FixedRecallVaultKeyProvider: RecallVaultKeyProviding {
    let keyData: Data

    func loadOrCreateKey() throws -> SymmetricKey {
        guard keyData.count == 32 else {
            throw BirdieRecallError.persistence("Test-Vault-Schlüssel muss 32 Bytes lang sein.")
        }
        return SymmetricKey(data: keyData)
    }
}
