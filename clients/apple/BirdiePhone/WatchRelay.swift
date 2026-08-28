import Combine
import Foundation
import WatchConnectivity

final class WatchRelay: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchRelay()

    @Published private(set) var activationState: WCSessionActivationState = .notActivated
    @Published private(set) var isPaired = false
    @Published private(set) var isWatchAppInstalled = false
    @Published private(set) var isReachable = false

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private let baseURL = URL(string: "https://birdie-agent-893591677320.europe-west3.run.app")!

    override private init() {
        super.init()
        session?.delegate = self
        publishConnectionState(from: session)
        session?.activate()
    }

    func refreshConnectionState() {
        publishConnectionState(from: session)
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
            guard let payload = message["payload"] as? [String: Any] else { throw RelayError.invalidRequest }
            return try await request(path: "/watch/mail/reply", method: "POST", body: payload)
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
    ) {
        publishConnectionState(from: session)
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        publishConnectionState(from: session)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        publishConnectionState(from: session)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        publishConnectionState(from: session)
    }

    func sessionDidDeactivate(_ session: WCSession) {
        publishConnectionState(from: session)
        session.activate()
    }

    private func publishConnectionState(from session: WCSession?) {
        let activationState = session?.activationState ?? .notActivated
        let isPaired = session?.isPaired ?? false
        let isWatchAppInstalled = session?.isWatchAppInstalled ?? false
        let isReachable = session?.isReachable ?? false

        DispatchQueue.main.async { [weak self] in
            self?.activationState = activationState
            self?.isPaired = isPaired
            self?.isWatchAppInstalled = isWatchAppInstalled
            self?.isReachable = isReachable
        }
    }
}

enum RelayError: LocalizedError {
    case invalidRequest
    case notAuthenticated
    case backendRejected
    case backendMessage(String)

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
        }
    }
}
