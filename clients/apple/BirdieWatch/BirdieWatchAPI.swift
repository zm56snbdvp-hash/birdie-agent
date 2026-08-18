import Foundation

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

private struct Envelope<T: Codable>: Codable {
    let success: Bool
    let data: T
}

enum BirdieWatchAPIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Birdie hat eine ungültige Antwort geliefert."
        case .unauthorized: return "Birdie Watch ist noch nicht autorisiert."
        case .server(let code): return "Birdie ist gerade nicht erreichbar (HTTP \(code))."
        }
    }
}

final class BirdieWatchAPI {
    private let baseURL = URL(string: "https://birdie-agent-893591677320.europe-west3.run.app")!

    // V0.1 scaffold only. Replace with the dedicated watch credential delivered
    // by the paired iPhone and stored in Keychain. Never ship BIRDIE_AGENT_API_KEY.
    private var watchCredential: String? {
        nil
    }

    func briefing() async throws -> WatchBriefing {
        let request = try makeRequest(path: "/watch/briefing", method: "GET")
        return try await perform(request, as: WatchBriefing.self)
    }

    func command(_ utterance: String) async throws -> WatchCommandResult {
        var request = try makeRequest(path: "/watch/command", method: "POST")
        request.httpBody = try JSONEncoder().encode(["utterance": utterance])
        return try await perform(request, as: WatchCommandResult.self)
    }

    private func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let credential = watchCredential else { throw BirdieWatchAPIError.unauthorized }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        return request
    }

    private func perform<T: Codable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BirdieWatchAPIError.invalidResponse }
        if http.statusCode == 401 { throw BirdieWatchAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw BirdieWatchAPIError.server(http.statusCode) }
        return try JSONDecoder().decode(Envelope<T>.self, from: data).data
    }
}
