import SwiftUI

struct BirdieWatchView: View {
    @EnvironmentObject private var model: BirdieWatchModel
    @State private var prompt = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 10) {
                        Text("🐦")
                            .font(.system(size: 34))
                        Text("Birdie")
                            .font(.headline)
                        Text(model.answer)
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)

                    TextField("Mit Birdie sprechen", text: $prompt)
                        .onSubmit {
                            let text = prompt
                            prompt = ""
                            Task { await model.askBirdie(text) }
                        }

                    if model.isBusy {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    }
                }

                Section("Inbox · \(model.unreadCount) neu") {
                    if model.inbox.isEmpty {
                        Text("Keine ungelesenen Mails")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.inbox.prefix(5)) { mail in
                            NavigationLink {
                                BirdieMailReplyView(mail: mail)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(mail.subject)
                                        .font(.headline)
                                        .lineLimit(1)
                                    Text(mail.from)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    if !mail.preview.isEmpty {
                                        Text(mail.preview)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                }
                            }
                        }
                    }
                }

                if let status = model.mailStatus {
                    Section {
                        Text(status)
                            .font(.caption)
                    }
                }

                if let error = model.errorMessage {
                    Section {
                        Text(error)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Birdie")
            .task { await model.refresh() }
            .refreshable { await model.refresh() }
        }
    }
}

private struct BirdieMailReplyView: View {
    @EnvironmentObject private var model: BirdieWatchModel
    @Environment(\.dismiss) private var dismiss

    let mail: WatchMailItem

    @State private var replyText = ""
    @State private var showingApproval = false

    var body: some View {
        List {
            Section("Mail") {
                Text(mail.subject)
                    .font(.headline)
                Text(mail.from)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if !mail.preview.isEmpty {
                    Text(mail.preview)
                        .font(.footnote)
                }
            }

            Section("Antwort") {
                TextField("Antwort diktieren", text: $replyText, axis: .vertical)
                    .lineLimit(2...6)

                if !replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(replyText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button("Antwort prüfen & senden") {
                    showingApproval = true
                }
                .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
            }
        }
        .navigationTitle("Antwort")
        .confirmationDialog(
            "Diese Mail wirklich senden?",
            isPresented: $showingApproval,
            titleVisibility: .visible
        ) {
            Button("Jetzt senden") {
                let text = replyText
                Task {
                    if await model.sendReply(to: mail, text: text) {
                        dismiss()
                    }
                }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Birdie sendet erst nach dieser ausdrücklichen Bestätigung.")
        }
    }
}
