import Foundation

@MainActor
final class BirdieWatchModel: ObservableObject {
    @Published var transcript = ""
    @Published var answer = "Tippe auf Birdie und sprich."
    @Published var inbox: [WatchMailItem] = []
    @Published var unreadCount = 0
    @Published var isBusy = false
    @Published var errorMessage: String?

    private let api = BirdieWatchAPI()

    func refresh() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let briefing = try await api.briefing()
            inbox = briefing.inbox
            unreadCount = briefing.unreadCount
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func askBirdie(_ text: String) async {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        transcript = clean
        isBusy = true
        defer { isBusy = false }
        do {
            let response = try await api.command(clean)
            answer = response.answer
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

}
