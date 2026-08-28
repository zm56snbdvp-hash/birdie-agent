import CryptoKit
import Foundation
import Security

actor PocketRelayDeviceSigner {
    private let service = "de.birdieandbreakfast.birdie.pocket-relay"
    private let account = "device-ed25519-private-key-v1"

    func publicKeyBase64URL() throws -> String {
        let key = try loadOrCreatePrivateKey()
        return PocketRelayEncoding.base64URL(key.publicKey.rawRepresentation)
    }

    func sign(_ payload: Data) throws -> String {
        let key = try loadOrCreatePrivateKey()
        return PocketRelayEncoding.base64URL(try key.signature(for: payload))
    }

    private func loadOrCreatePrivateKey() throws -> Curve25519.Signing.PrivateKey {
        let query = baseQuery.merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess {
            guard let data = result as? Data else { throw PocketRelayLocalError.keychain(errSecDecode) }
            do {
                return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
            } catch {
                throw PocketRelayLocalError.contract("Der gerätegebundene Pocket-Relay-Schlüssel ist beschädigt.")
            }
        }
        guard status == errSecItemNotFound else { throw PocketRelayLocalError.keychain(status) }

        let key = Curve25519.Signing.PrivateKey()
        var insert = baseQuery
        insert[kSecValueData as String] = key.rawRepresentation
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)
        guard insertStatus == errSecSuccess else { throw PocketRelayLocalError.keychain(insertStatus) }
        return key
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

struct PocketRelaySession: Codable, Equatable, Sendable {
    let baseURL: URL
    let deviceId: String
    let targetDevice: PocketRelayTargetDevice
    var accessToken: String
    var accessTokenExpiresAt: Date
    let receiptPublicKey: String
    var serverClockOffset: TimeInterval

    var hasUsableToken: Bool {
        accessTokenExpiresAt.timeIntervalSince(Date().addingTimeInterval(serverClockOffset)) > 30
    }
}

actor PocketRelayCredentialStore {
    private let service = "de.birdieandbreakfast.birdie.pocket-relay"
    private let account = "paired-session-v1"

    func load() throws -> PocketRelaySession? {
        let query = baseQuery.merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw PocketRelayLocalError.keychain(status)
        }
        do {
            return try JSONDecoder().decode(PocketRelaySession.self, from: data)
        } catch {
            throw PocketRelayLocalError.contract("Die lokale Pocket-Relay-Kopplung ist beschädigt.")
        }
    }

    func save(_ session: PocketRelaySession) throws {
        let data = try PocketRelayEncoding.wireEncoder.encode(session)
        let status: OSStatus
        if try load() == nil {
            var insert = baseQuery
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        } else {
            status = SecItemUpdate(
                baseQuery as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
        }
        guard status == errSecSuccess else { throw PocketRelayLocalError.keychain(status) }
    }

    func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PocketRelayLocalError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum PocketRelayReceiptVerifier {
    static func verify(
        signedReceipt: PocketRelaySignedReceipt,
        publicKeyBase64URL: String,
        expectation: PocketRelayReceiptExpectation,
        response: PocketRelayCommandResponse,
        idempotentReplay: Bool,
        now: Date = Date()
    ) throws -> PocketRelayAuditSummary {
        guard signedReceipt.algorithm == "Ed25519" else { throw PocketRelayLocalError.receiptInvalid }
        let receipt = try PocketRelayEncoding.decodeBase64URL(signedReceipt.receipt)
        let signature = try PocketRelayEncoding.decodeBase64URL(signedReceipt.signature)
        let publicKeyBytes = try PocketRelayEncoding.decodeBase64URL(publicKeyBase64URL)
        guard publicKeyBytes.count == 32,
              let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyBytes),
              publicKey.isValidSignature(signature, for: receipt)
        else {
            throw PocketRelayLocalError.receiptInvalid
        }

        let json = try JSONSerialization.jsonObject(with: receipt)
        guard let object = json as? [String: Any] else { throw PocketRelayLocalError.receiptInvalid }
        let expectedKeys: Set<String> = [
            "version", "receiptId", "commandId", "idempotencyKey", "deviceId", "targetDeviceId",
            "action", "scope", "risk", "commandBytesDigest", "commandEffectDigest", "approvalDigest",
            "payloadDigest", "resultDigest", "state", "transitions", "expectedEffect", "acceptedAt",
            "completedAt", "errorCode"
        ]
        guard Set(object.keys) == expectedKeys,
              let decoded = try? JSONDecoder().decode(PocketRelayAuditReceipt.self, from: receipt)
        else {
            throw PocketRelayLocalError.receiptInvalid
        }

        let expectedResultDigest = try response.result.map {
            PocketRelayEncoding.sha256Hex(try PocketRelayEncoding.wireEncoder.encode($0))
        }
        let digestPattern = "^[a-f0-9]{64}$"
        let commandBytesBound = idempotentReplay
            ? decoded.commandBytesDigest.range(of: digestPattern, options: .regularExpression) != nil
            : decoded.commandBytesDigest == expectation.commandBytesDigest
        let approvalBound: Bool
        if idempotentReplay {
            approvalBound = expectation.risk == .high
                ? decoded.approvalDigest?.range(of: digestPattern, options: .regularExpression) != nil
                : decoded.approvalDigest == nil
        } else {
            approvalBound = decoded.approvalDigest == expectation.approvalDigest
        }
        guard decoded.version == "pocket-relay.audit-receipt.v1",
              (try? PocketRelayValidation.requireUUID(decoded.receiptId, field: "receipt.receiptId")) != nil,
              decoded.commandId == expectation.commandId,
              decoded.idempotencyKey == expectation.idempotencyKey,
              decoded.deviceId == expectation.deviceId,
              decoded.targetDeviceId == expectation.targetDeviceId,
              decoded.action == expectation.action,
              decoded.scope == expectation.scope,
              decoded.risk == expectation.risk,
              commandBytesBound,
              decoded.commandEffectDigest == expectation.commandEffectDigest,
              approvalBound,
              decoded.payloadDigest == expectation.payloadDigest,
              decoded.resultDigest == expectedResultDigest,
              decoded.state == response.state,
              decoded.expectedEffect == expectation.expectedEffect,
              decoded.errorCode == response.error?.code,
              response.success == (response.state == .completed && response.error == nil),
              decoded.transitions.count >= 2,
              decoded.transitions.first?.state == .queued,
              decoded.transitions.last?.state == decoded.state
        else {
            throw PocketRelayLocalError.receiptInvalid
        }

        let acceptedAt = try PocketRelayTimestamp.date(from: decoded.acceptedAt)
        let completedAt = try PocketRelayTimestamp.date(from: decoded.completedAt)
        guard acceptedAt <= completedAt else { throw PocketRelayLocalError.receiptInvalid }
        for transition in decoded.transitions {
            _ = try PocketRelayTimestamp.date(from: transition.at)
            guard !transition.reason.isEmpty, transition.reason.count <= 160 else {
                throw PocketRelayLocalError.receiptInvalid
            }
        }
        let digest = SHA256.hash(data: receipt).map { String(format: "%02x", $0) }.joined()
        return PocketRelayAuditSummary(
            receiptSHA256: digest,
            signature: signedReceipt.signature,
            algorithm: signedReceipt.algorithm,
            verifiedAt: now,
            idempotentReplay: idempotentReplay
        )
    }
}

private struct PocketRelayAuditReceipt: Decodable {
    struct Transition: Decodable {
        let state: PocketRelayCommandState
        let at: String
        let reason: String
    }

    let version: String
    let receiptId: String
    let commandId: String
    let idempotencyKey: String
    let deviceId: String
    let targetDeviceId: String
    let action: PocketRelayAction
    let scope: String
    let risk: PocketRelayRisk
    let commandBytesDigest: String
    let commandEffectDigest: String
    let approvalDigest: String?
    let payloadDigest: String
    let resultDigest: String?
    let state: PocketRelayCommandState
    let transitions: [Transition]
    let expectedEffect: String
    let acceptedAt: String
    let completedAt: String
    let errorCode: String?
}
