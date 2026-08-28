import CryptoKit
import CoreFoundation
import DeviceCheck
import Foundation
import LocalAuthentication
import Security

enum BirdieCanonicalJSON {
    /// RFC 8785 / JCS canonicalization for Birdie Trust's signing domain.
    /// Trust-v1 signed objects deliberately use only strings, booleans, null,
    /// arrays, objects and integral JSON numbers; non-integral numbers fail
    /// closed so a server can never verify a subtly different representation.
    static func data<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = try encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed])
        var canonical = ""
        try appendCanonical(object, to: &canonical)
        return Data(canonical.utf8)
    }

    static func sha256Hex<T: Encodable>(_ value: T) throws -> String {
        sha256Hex(try data(value))
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func sha256Digest<T: Encodable>(_ value: T) throws -> String {
        sha256Digest(try data(value))
    }

    static func sha256Digest(_ data: Data) -> String {
        base64URL(Data(SHA256.hash(data: data)))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static func validBase64URL(
        _ value: String,
        minimumDecodedBytes: Int,
        encodedLength: ClosedRange<Int>
    ) -> Bool {
        guard encodedLength.contains(value.count),
              value.unicodeScalars.allSatisfy({ base64URLCharacters.contains($0) }),
              value.count % 4 != 1
        else { return false }

        return decodeBase64URL(value)?.count ?? 0 >= minimumDecodedBytes
    }

    static func decodeBase64URL(_ value: String) -> Data? {
        guard value.unicodeScalars.allSatisfy({ base64URLCharacters.contains($0) }),
              value.count % 4 != 1
        else { return nil }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        let standard = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding
        return Data(base64Encoded: standard)
    }

    private static let base64URLCharacters = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )

    private static func appendCanonical(_ value: Any, to output: inout String) throws {
        switch value {
        case let object as [String: Any]:
            output.append("{")
            let keys = object.keys.sorted { lhs, rhs in
                lhs.utf16.lexicographicallyPrecedes(rhs.utf16)
            }
            for (index, key) in keys.enumerated() {
                if index > 0 { output.append(",") }
                appendJSONString(key, to: &output)
                output.append(":")
                guard let nested = object[key] else {
                    throw BirdieCanonicalJSONError.unsupportedValue
                }
                try appendCanonical(nested, to: &output)
            }
            output.append("}")
        case let array as [Any]:
            output.append("[")
            for (index, nested) in array.enumerated() {
                if index > 0 { output.append(",") }
                try appendCanonical(nested, to: &output)
            }
            output.append("]")
        case let string as String:
            appendJSONString(string, to: &output)
        case _ as NSNull:
            output.append("null")
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                output.append(number.boolValue ? "true" : "false")
            } else {
                let representation = number.stringValue
                guard representation.range(
                    of: #"^-?(0|[1-9][0-9]*)$"#,
                    options: .regularExpression
                ) != nil,
                      let integer = Int64(representation),
                      (-9_007_199_254_740_991 ... 9_007_199_254_740_991).contains(integer)
                else {
                    throw BirdieCanonicalJSONError.nonIntegralNumber
                }
                output.append(representation)
            }
        default:
            throw BirdieCanonicalJSONError.unsupportedValue
        }
    }

    private static func appendJSONString(_ value: String, to output: inout String) {
        output.append("\"")
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x08: output.append("\\b")
            case 0x09: output.append("\\t")
            case 0x0A: output.append("\\n")
            case 0x0C: output.append("\\f")
            case 0x0D: output.append("\\r")
            case 0x22: output.append("\\\"")
            case 0x5C: output.append("\\\\")
            case 0x00 ... 0x1F:
                output.append(String(format: "\\u%04x", scalar.value))
            default:
                output.append(String(scalar))
            }
        }
        output.append("\"")
    }
}

private enum BirdieCanonicalJSONError: Error {
    case nonIntegralNumber
    case unsupportedValue
}

protocol BirdieLocalAuthorizing: Sendable {
    func authorize(reason: String, contextDigest: String) async throws -> LocalAuthorizationEvidence
}

struct BiometricLocalAuthorizer: BirdieLocalAuthorizing {
    func authorize(reason: String, contextDigest: String) async throws -> LocalAuthorizationEvidence {
        let context = LAContext()
        context.localizedCancelTitle = "Abbrechen"
        context.localizedFallbackTitle = ""
        defer { context.invalidate() }

        var evaluationError: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &evaluationError
        ) else {
            throw BirdieTrustError.authenticationUnavailable
        }

        let biometry: String
        switch context.biometryType {
        case .faceID:
            biometry = "face_id"
        case .touchID:
            biometry = "touch_id"
        case .opticID, .none:
            throw BirdieTrustError.authenticationUnavailable
        @unknown default:
            throw BirdieTrustError.authenticationUnavailable
        }

        do {
            let accepted = try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Bool, Error>) in
                context.evaluatePolicy(
                    .deviceOwnerAuthenticationWithBiometrics,
                    localizedReason: reason
                ) { success, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: success)
                    }
                }
            }
            guard accepted else { throw BirdieTrustError.authenticationFailed }
            return LocalAuthorizationEvidence(
                method: biometry,
                policy: "biometrics_only",
                success: true,
                evaluatedAt: Date(),
                contextDigest: contextDigest
            )
        } catch let error as BirdieTrustError {
            throw error
        } catch {
            throw BirdieTrustError.authenticationFailed
        }
    }
}

protocol BirdieDeviceAssertionProviding: Sendable {
    func bindingID() async throws -> String
    func assertion(for clientDataHash: Data) async throws -> DeviceAssertion
}

protocol BirdieAppAttestRegistering: Sendable {
    func beginRegistration() async throws -> String
    func createRegistrationAttestation(
        keyID: String,
        clientDataHash: Data
    ) async throws -> DeviceAttestation
    func activateRegistration(
        afterBackendAcknowledgedKeyID keyID: String,
        deviceBindingID: String
    ) async throws
    func discardPendingRegistration(keyID: String) async
}

actor AppAttestDeviceAssertionProvider:
    BirdieDeviceAssertionProviding,
    BirdieAppAttestRegistering
{
    private let service = DCAppAttestService.shared
    private let bindingStore = AppAttestBindingStore()
    private let pendingKeyStore = AppAttestPendingKeyStore()
    private var pendingRegistrationKeyID: String?

    func bindingID() async throws -> String {
        guard service.isSupported, let binding = bindingStore.load() else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        return binding.deviceBindingID
    }

    func assertion(for clientDataHash: Data) async throws -> DeviceAssertion {
        guard service.isSupported, let binding = bindingStore.load() else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        let assertion = try await generateAssertion(
            keyID: binding.keyID,
            clientDataHash: clientDataHash
        )
        return DeviceAssertion(
            provider: "app_attest",
            keyID: binding.keyID,
            clientDataHash: BirdieCanonicalJSON.base64URL(clientDataHash),
            assertionObject: BirdieCanonicalJSON.base64URL(assertion)
        )
    }

    /// Starts enrollment without making the generated key authoritative. The
    /// returned key ID is sent in the versioned registration-challenge request.
    func beginRegistration() async throws -> String {
        guard service.isSupported else { throw BirdieTrustError.deviceBindingUnavailable }
        let keyID = try await generateKey()
        try pendingKeyStore.save(keyID)
        pendingRegistrationKeyID = keyID
        return keyID
    }

    /// Produces the attestation only after the backend challenge is known. This
    /// method never activates the key locally: the backend must first verify and
    /// acknowledge the attestation.
    func createRegistrationAttestation(
        keyID: String,
        clientDataHash: Data
    ) async throws -> DeviceAttestation {
        guard activePendingKeyID() == keyID else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        let attestation = try await attestKey(keyID: keyID, clientDataHash: clientDataHash)
        return DeviceAttestation(
            keyID: keyID,
            clientDataHash: BirdieCanonicalJSON.base64URL(clientDataHash),
            attestationObject: BirdieCanonicalJSON.base64URL(attestation)
        )
    }

    /// Call only after an authenticated backend response confirms that this exact
    /// App Attest key and registration challenge were accepted. A rejected or lost
    /// enrollment never replaces the currently active key.
    func activateRegistration(
        afterBackendAcknowledgedKeyID keyID: String,
        deviceBindingID: String
    ) async throws {
        if let active = bindingStore.load(),
           active.keyID == keyID,
           active.deviceBindingID == deviceBindingID {
            // Preserve the pending marker if cleanup fails; a retry must finish
            // the durable Keychain transition deterministically.
            try pendingKeyStore.delete()
            pendingRegistrationKeyID = nil
            return
        }
        guard activePendingKeyID() == keyID,
              !keyID.isEmpty,
              keyID.count <= 1_024,
              BirdieApprovalValidation.isOpaqueIdentifier(deviceBindingID)
        else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        try bindingStore.save(
            AppAttestBindingRecord(deviceBindingID: deviceBindingID, keyID: keyID)
        )
        try pendingKeyStore.delete()
        pendingRegistrationKeyID = nil
    }

    func discardPendingRegistration(keyID: String) async {
        guard activePendingKeyID() == keyID else { return }
        try? pendingKeyStore.delete()
        pendingRegistrationKeyID = nil
    }

    private func activePendingKeyID() -> String? {
        pendingRegistrationKeyID ?? pendingKeyStore.load()
    }

    private func generateKey() async throws -> String {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<String, Error>) in
            service.generateKey { keyID, error in
                if let keyID {
                    continuation.resume(returning: keyID)
                } else {
                    continuation.resume(throwing: error ?? BirdieTrustError.deviceBindingUnavailable)
                }
            }
        }
    }

    private func attestKey(keyID: String, clientDataHash: Data) async throws -> Data {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Data, Error>) in
            service.attestKey(keyID, clientDataHash: clientDataHash) { data, error in
                if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: error ?? BirdieTrustError.deviceBindingUnavailable)
                }
            }
        }
    }

    private func generateAssertion(keyID: String, clientDataHash: Data) async throws -> Data {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Data, Error>) in
            service.generateAssertion(keyID, clientDataHash: clientDataHash) { data, error in
                if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: error ?? BirdieTrustError.deviceBindingUnavailable)
                }
            }
        }
    }
}

struct DeviceAttestation: Codable, Hashable, Sendable {
    let keyID: String
    let clientDataHash: String
    let attestationObject: String
}

struct BirdieServerVerificationKey: Hashable, Sendable {
    let keyID: String
    let rawRepresentation: Data
}

protocol BirdieServerSignatureVerifying: Sendable {
    func verify(signature: ServerSignature, payload: Data) async throws
}

/// Production callers construct this verifier only from a pinned key set or a
/// separately authenticated and rotation-aware key-discovery response. Unknown
/// key IDs and malformed signatures always fail closed.
struct PinnedEd25519ServerSignatureVerifier: BirdieServerSignatureVerifying {
    private let publicKeysByID: [String: Data]

    init(keys: [BirdieServerVerificationKey]) {
        publicKeysByID = Dictionary(
            keys.map { ($0.keyID, $0.rawRepresentation) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    func verify(signature: ServerSignature, payload: Data) async throws {
        guard signature.format == "raw-ed25519-jcs",
              signature.algorithm == "EdDSA",
              signature.canonicalization == "RFC8785",
              let rawPublicKey = publicKeysByID[signature.keyID],
              rawPublicKey.count == 32,
              let rawSignature = BirdieCanonicalJSON.decodeBase64URL(signature.signature),
              rawSignature.count == 64,
              let publicKey = try? Curve25519.Signing.PublicKey(
                  rawRepresentation: rawPublicKey
              ),
              publicKey.isValidSignature(rawSignature, for: payload)
        else {
            throw BirdieTrustError.invalidContract(
                "Receipt-Signatur ist unbekannt, unvollständig oder ungültig."
            )
        }
    }
}

struct UnconfiguredServerSignatureVerifier: BirdieServerSignatureVerifying {
    func verify(signature: ServerSignature, payload: Data) async throws {
        _ = (signature, payload)
        throw BirdieTrustError.invalidContract(
            "Für Receipt-Verifikation ist kein vertrauenswürdiger Server-Key konfiguriert."
        )
    }
}

#if DEBUG
struct DynamicDebugEd25519ServerSignatureVerifier: BirdieServerSignatureVerifying {
    let keyProvider: @Sendable () async throws -> BirdieServerVerificationKey

    func verify(signature: ServerSignature, payload: Data) async throws {
        let key = try await keyProvider()
        try await PinnedEd25519ServerSignatureVerifier(keys: [key]).verify(
            signature: signature,
            payload: payload
        )
    }
}
#endif

#if DEBUG
enum LocalMockDeviceIdentity {
    static let bindingID = "debug-local-device-binding"
    static let keyID = "debug-local-app-attest-key"
}

actor LocalMockDeviceAssertionProvider: BirdieDeviceAssertionProviding {
    func bindingID() async throws -> String {
        LocalMockDeviceIdentity.bindingID
    }

    func assertion(for clientDataHash: Data) async throws -> DeviceAssertion {
        let digest = BirdieCanonicalJSON.base64URL(clientDataHash)
        return DeviceAssertion(
            provider: "local_mock_only",
            keyID: LocalMockDeviceIdentity.keyID,
            clientDataHash: digest,
            assertionObject: BirdieCanonicalJSON.base64URL(Data("mock:\(digest)".utf8))
        )
    }
}
#endif

actor BirdieReplayProtector {
    private var reservations: [String: String] = [:]

    func reserve(nonce: String, requestDigest: String) throws {
        if let existing = reservations[nonce], existing != requestDigest {
            throw BirdieTrustError.replayDetected
        }
        reservations[nonce] = requestDigest
    }
}

private struct AppAttestBindingRecord: Codable {
    let deviceBindingID: String
    let keyID: String
}

private final class AppAttestBindingStore: @unchecked Sendable {
    private let service = "de.birdieandbreakfast.birdie.trust"
    private let account = "app-attest-binding-v1"

    func save(_ binding: AppAttestBindingRecord) throws {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let encoded = try JSONEncoder().encode(binding)
        let attributes: [String: Any] = [
            kSecValueData as String: encoded,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            attributes as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        var insert = baseQuery
        insert.merge(attributes) { _, replacement in replacement }
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
    }

    func load() -> AppAttestBindingRecord? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return try? JSONDecoder().decode(AppAttestBindingRecord.self, from: data)
    }
}

private final class AppAttestPendingKeyStore: @unchecked Sendable {
    private let service = "de.birdieandbreakfast.birdie.trust"
    private let account = "app-attest-pending-key-v1"

    func save(_ keyID: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: Data(keyID.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
        var insert = query
        insert.merge(attributes) { _, replacement in replacement }
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
    }

    func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw BirdieTrustError.deviceBindingUnavailable
        }
    }
}
