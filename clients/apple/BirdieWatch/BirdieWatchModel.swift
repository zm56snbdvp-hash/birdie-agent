import Foundation

@MainActor
final class BirdieWatchModel: ObservableObject {
    @Published var transcript = ""
    @Published var answer = "Tippe auf Birdie und sprich."
    @Published var inbox: [WatchMailItem] = []
    @Published var unreadCount = 0
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var mailStatus: String?

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

    func sendReply(to mail: WatchMailItem, text: String) async -> Bool {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return false }

        isBusy = true
        mailStatus = nil
        defer { isBusy = false }

        do {
            let subject = mail.subject.lowercased().hasPrefix("re:")
                ? mail.subject
                : "Re: \(mail.subject)"
            try await api.reply(
                to: mail.from,
                subject: subject,
                text: clean,
                replyToUid: mail.uid
            )
            mailStatus = "Antwort gesendet."
            errorMessage = nil
            await refresh()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
