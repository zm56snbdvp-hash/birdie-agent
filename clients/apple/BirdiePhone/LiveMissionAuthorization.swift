import Foundation
import LocalAuthentication

protocol LiveMissionLocalAuthorizing: Sendable {
    func authorize(
        actionDigest: String,
        requiresBiometrics: Bool
    ) async throws -> LocalAuthorizationEvidence
}

/// Uses biometrics only for cancellation. There is intentionally no passcode
/// fallback for the irreversible path and no authorization from an extension.
struct LiveMissionLocalAuthorizer: LiveMissionLocalAuthorizing {
    func authorize(
        actionDigest: String,
        requiresBiometrics: Bool
    ) async throws -> LocalAuthorizationEvidence {
        guard BirdieCanonicalJSON.validBase64URL(
            actionDigest,
            minimumDecodedBytes: 32,
            encodedLength: 43 ... 43
        ) else {
            throw LiveMissionAuthorizationError.invalidActionDigest
        }
        guard requiresBiometrics else {
            return LocalAuthorizationEvidence(
                method: "not_required",
                policy: "low_risk_only",
                success: true,
                evaluatedAt: Date(),
                contextDigest: actionDigest
            )
        }

        let localAuthentication = LAContext()
        localAuthentication.localizedCancelTitle = "Nicht abbrechen"
        localAuthentication.localizedFallbackTitle = ""
        defer { localAuthentication.invalidate() }

        var evaluationError: NSError?
        guard localAuthentication.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &evaluationError
        ) else {
            throw LiveMissionAuthorizationError.biometricsUnavailable
        }

        let method: String
        switch localAuthentication.biometryType {
        case .faceID:
            method = "face_id"
        case .touchID:
            method = "touch_id"
        case .opticID:
            // Trust-v1 intentionally permits only iPhone Face ID / Touch ID
            // for cancellation; do not silently widen the server contract.
            throw LiveMissionAuthorizationError.biometricsUnavailable
        case .none:
            throw LiveMissionAuthorizationError.biometricsUnavailable
        @unknown default:
            throw LiveMissionAuthorizationError.biometricsUnavailable
        }

        do {
            let accepted = try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Bool, Error>) in
                localAuthentication.evaluatePolicy(
                    .deviceOwnerAuthenticationWithBiometrics,
                    localizedReason: "Bestätige den Abbruch dieser Live Mission."
                ) { success, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: success)
                    }
                }
            }
            guard accepted else {
                throw LiveMissionAuthorizationError.authenticationFailed
            }
        } catch let error as LiveMissionAuthorizationError {
            throw error
        } catch {
            throw LiveMissionAuthorizationError.authenticationFailed
        }

        return LocalAuthorizationEvidence(
            method: method,
            policy: "biometrics_only",
            success: true,
            evaluatedAt: Date(),
            contextDigest: actionDigest
        )
    }
}

enum LiveMissionAuthorizationError: LocalizedError, Equatable, Sendable {
    case invalidActionDigest
    case biometricsUnavailable
    case authenticationFailed

    var errorDescription: String? {
        switch self {
        case .invalidActionDigest:
            "Der Missionsbefehl ist nicht eindeutig an den Trust-v1-Aktionsdigest gebunden."
        case .biometricsUnavailable:
            "Face ID oder eine andere Biometrie ist für den Missionsabbruch nicht verfügbar."
        case .authenticationFailed:
            "Der Missionsabbruch wurde nicht biometrisch bestätigt."
        }
    }
}
