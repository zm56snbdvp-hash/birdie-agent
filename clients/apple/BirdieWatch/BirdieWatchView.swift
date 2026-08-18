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
