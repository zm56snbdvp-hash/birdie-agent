import Foundation
import WatchConnectivity

struct WatchMailItem: Codable, Identifiable {
    var id: String { String(uid) }
    let uid: Int
    let subject: String
    let from: String
    let date: String?
    let unread: Bool
    let flagged: Bool
    let preview: String
}

struct WatchBriefing: Codable {
    let unreadCount: Int
    let inbox: [WatchMailItem]
    let primaryAction: String
}

struct WatchCommandResult: Codable {
    let utterance: String
    let intent: String
    let answer: String
    let authoritative: Bool
    let source: String
}

enum BirdieWatchAPIError: LocalizedError {
    case connectivityUnavailable
    case phoneNotReachable
    case invalidResponse
    case backend(String)

    var errorDescription: String? {
        switch self {
        case .connectivityUnavailable:
            return "Birdie kann die Verbindung zum iPhone nicht starten."
        case .phoneNotReachable:
            return "Dein iPhone ist für Birdie gerade nicht erreichbar."
        case .invalidResponse:
            return "Birdie hat eine ungültige Antwort geliefert."
        case .backend(let message):
            return message
        }
    }
}

final class BirdieWatchAPI: NSObject, WCSessionDelegate {
    private let session: WCSession?

    override init() {
        if WCSession.isSupported() {
            session = .default
        } else {
            session = nil
        }
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func briefing() async throws -> WatchBriefing {
        try await send(["action": "briefing"], as: WatchBriefing.self)
    }

    func command(_ utterance: String) async throws -> WatchCommandResult {
        try await send([
            "action": "command",
            "utterance": utterance
        ], as: WatchCommandResult.self)
    }

    func reply(
        to: String,
        subject: String,
        text: String,
        replyToUid: Int?
    ) async throws {
        var payload: [String: Any] = [
            "to": to,
            "subject": subject,
            "text": text,
            "founderApproved": true,
            "confirmation": "SEND_EMAIL"
        ]
        if let replyToUid { payload["replyToUid"] = replyToUid }

        let _: WatchSendReceipt = try await send([
            "action": "mailReply",
            "payload": payload
        ], as: WatchSendReceipt.self)
    }

    private func send<T: Decodable>(_ message: [String: Any], as type: T.Type) async throws -> T {
        guard let session else { throw BirdieWatchAPIError.connectivityUnavailable }
        guard session.activationState == .activated, session.isReachable else {
            throw BirdieWatchAPIError.phoneNotReachable
        }

        return try await withCheckedThrowingContinuation { continuation in
            session.sendMessage(message, replyHandler: { reply in
                do {
                    guard (reply["success"] as? Bool) == true else {
                        let message = (reply["error"] as? String) ?? "Birdie Agent hat die Anfrage abgelehnt."
                        throw BirdieWatchAPIError.backend(message)
                    }
                    guard
                        let outerData = reply["data"] as? [String: Any],
                        (outerData["success"] as? Bool) == true,
                        let payload = outerData["data"]
                    else {
                        throw BirdieWatchAPIError.invalidResponse
                    }
                    let data = try JSONSerialization.data(withJSONObject: payload)
                    continuation.resume(returning: try JSONDecoder().decode(T.self, from: data))
                } catch {
                    continuation.resume(throwing: error)
                }
            }, errorHandler: { error in
                continuation.resume(throwing: error)
            })
        }
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}
}

private struct WatchSendReceipt: Decodable {
    let accepted: Bool?
}
