import Foundation
import WatchConnectivity

final class WatchRelay: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchRelay()

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private let baseURL = URL(string: "https://birdie-agent-893591677320.europe-west3.run.app")!

    // Store this in Keychain in the iPhone app. Never hard-code production credentials.
    var watchTokenProvider: () -> String? = { nil }

    override private init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
        Task {
            do {
                let result = try await handle(message)
                replyHandler(["success": true, "data": result])
            } catch {
                replyHandler(["success": false, "error": error.localizedDescription])
            }
        }
    }

    private func handle(_ message: [String: Any]) async throws -> Any {
        guard let action = message["action"] as? String else {
            throw RelayError.invalidRequest
        }

        switch action {
        case "briefing":
            return try await request(path: "/watch/briefing", method: "GET", body: nil)
        case "command":
            guard let utterance = message["utterance"] as? String else { throw RelayError.invalidRequest }
            return try await request(path: "/watch/command", method: "POST", body: ["utterance": utterance])
        case "mailReply":
            guard let payload = message["payload"] as? [String: Any] else { throw RelayError.invalidRequest }
            return try await request(path: "/watch/mail/reply", method: "POST", body: payload)
        default:
            throw RelayError.invalidRequest
        }
    }

    private func request(path: String, method: String, body: [String: Any]?) async throws -> Any {
        guard let token = watchTokenProvider(), !token.isEmpty else { throw RelayError.notAuthenticated }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw RelayError.backendRejected
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}

enum RelayError: LocalizedError {
    case invalidRequest
    case notAuthenticated
    case backendRejected

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "Ungültige Watch-Anfrage."
        case .notAuthenticated: return "Birdie Watch ist noch nicht sicher angemeldet."
        case .backendRejected: return "Birdie Agent hat die Anfrage abgelehnt."
        }
    }
}
