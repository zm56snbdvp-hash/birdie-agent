import Foundation
import WatchConnectivity

final class WatchRelay: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchRelay()

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private let baseURL = URL(string: "https://birdie-agent-893591677320.europe-west3.run.app")!

    override private init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String : Any],
        replyHandler: @escaping ([String : Any]) -> Void
    ) {
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
            // A paired Watch is never an approval authority. In particular, do
            // not accept caller-authored founderApproved/confirmation flags or
            // forward mail content around the Birdie Trust challenge flow.
            throw RelayError.controlledActionRequiresPhoneReview
        default:
            throw RelayError.invalidRequest
        }
    }

    private func request(path: String, method: String, body: [String: Any]?) async throws -> Any {
        guard let token = WatchTokenStore.shared.load(), !token.isEmpty else {
            throw RelayError.notAuthenticated
        }

        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RelayError.backendRejected
        }
        if http.statusCode == 401 { throw RelayError.notAuthenticated }
        guard (200..<300).contains(http.statusCode) else {
            let serverMessage = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw RelayError.backendMessage(serverMessage ?? "Birdie Agent hat die Anfrage abgelehnt.")
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}

enum RelayError: LocalizedError {
    case invalidRequest
    case notAuthenticated
    case backendRejected
    case backendMessage(String)
    case controlledActionRequiresPhoneReview

    var errorDescription: String? {
        switch self {
        case .invalidRequest:
            return "Ungültige Watch-Anfrage."
        case .notAuthenticated:
            return "Birdie Watch ist noch nicht sicher angemeldet."
        case .backendRejected:
            return "Birdie Agent hat die Anfrage abgelehnt."
        case .backendMessage(let message):
            return message
        case .controlledActionRequiresPhoneReview:
            return "Mail-Antworten müssen in Birdie Approve auf dem iPhone geprüft werden."
        }
    }
}
