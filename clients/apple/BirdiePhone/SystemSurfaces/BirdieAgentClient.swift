import Foundation

enum BirdieAgentClientError: LocalizedError {
    case notAuthenticated
    case rejected(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "Verbinde zuerst den vorhandenen Birdie-Watch-Zugang im Bereich Setup."
        case .rejected(let message):
            message
        case .invalidResponse:
            "Birdie hat keine lesbare Antwort geliefert."
        }
    }
}

struct BirdieAgentClient: Sendable {
    private let baseURL = URL(string: "https://birdie-agent-893591677320.europe-west3.run.app")!

    func askConfirmed(_ question: String) async throws -> String {
        guard let token = WatchTokenStore.shared.load(), !token.isEmpty else {
            throw BirdieAgentClientError.notAuthenticated
        }

        var request = URLRequest(url: baseURL.appending(path: "/watch/command"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONSerialization.data(withJSONObject: ["utterance": question])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BirdieAgentClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = body?["message"] as? String ?? "Birdie hat die Anfrage abgelehnt."
            throw http.statusCode == 401
                ? BirdieAgentClientError.notAuthenticated
                : BirdieAgentClientError.rejected(message)
        }

        guard
            let outer = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let payload = outer["data"] as? [String: Any],
            let answer = payload["answer"] as? String
        else { throw BirdieAgentClientError.invalidResponse }
        return answer
    }

    func fetchDayPilot() async throws -> DayPilotRemoteSnapshot {
        guard let token = WatchTokenStore.shared.load(), !token.isEmpty else {
            throw BirdieAgentClientError.notAuthenticated
        }

        var request = URLRequest(url: baseURL.appending(path: "/watch/day-pilot/v1"))
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BirdieAgentClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = body?["message"] as? String ?? "Day Pilot konnte nicht geladen werden."
            throw http.statusCode == 401
                ? BirdieAgentClientError.notAuthenticated
                : BirdieAgentClientError.rejected(message)
        }

        do {
            return try DayPilotRemoteContract.decode(data)
        } catch let error as BirdieAgentClientError {
            throw error
        } catch {
            throw BirdieAgentClientError.invalidResponse
        }
    }
}

enum DayPilotRemoteContract {
    private struct Envelope: Decodable {
        let success: Bool
        let data: DayPilotRemoteSnapshot
    }

    static func decode(_ data: Data) throws -> DayPilotRemoteSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            let fractionalFormatter = ISO8601DateFormatter()
            fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractionalFormatter.date(from: value) {
                return date
            }

            let standardFormatter = ISO8601DateFormatter()
            standardFormatter.formatOptions = [.withInternetDateTime]
            if let date = standardFormatter.date(from: value) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an RFC 3339 timestamp."
            )
        }

        let envelope = try decoder.decode(Envelope.self, from: data)
        guard envelope.success, envelope.data.contractVersion == 1 else {
            throw BirdieAgentClientError.invalidResponse
        }
        return envelope.data
    }
}
