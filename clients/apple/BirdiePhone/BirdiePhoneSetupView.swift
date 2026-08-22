import SwiftUI

struct BirdiePhoneSetupView: View {
    @ObservedObject private var relay = WatchRelay.shared
    @State private var token = ""
    @State private var status = ""
    @State private var hasWatchToken = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        BirdiePhoneMark()
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Birdie")
                                .font(.title2.weight(.semibold))
                            Label(watchStatusTitle, systemImage: watchStatusIcon)
                                .font(.subheadline)
                                .foregroundStyle(watchStatusColor)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("Sicherer Zugang") {
                    Label(
                        hasWatchToken ? "API-Schlüssel hinterlegt" : "API-Schlüssel fehlt",
                        systemImage: hasWatchToken ? "key.fill" : "key"
                    )
                    .foregroundStyle(hasWatchToken ? Color.green : Color.secondary)

                    SecureField("Watch API Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button(hasWatchToken ? "API-Schlüssel aktualisieren" : "API-Schlüssel hinterlegen") {
                        do {
                            try WatchTokenStore.shared.save(token)
                            token = ""
                            hasWatchToken = true
                            status = "Der API-Schlüssel wurde sicher im iPhone-Keychain hinterlegt."
                        } catch {
                            status = error.localizedDescription
                        }
                    }
                    .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).count < 32)

                    Button("API-Schlüssel entfernen", role: .destructive) {
                        WatchTokenStore.shared.remove()
                        hasWatchToken = false
                        status = "Der API-Schlüssel wurde entfernt. Die Gerätekopplung bleibt unverändert."
                    }
                }

                Section("Gerätestatus") {
                    connectionRow("Session aktiviert", isReady: relay.activationState == .activated)
                    connectionRow("Watch gekoppelt", isReady: relay.isPaired)
                    connectionRow("Watch-App installiert", isReady: relay.isWatchAppInstalled)
                    connectionRow("Watch erreichbar", isReady: relay.isReachable)

                    Text("Erreichbar bedeutet, dass die Watch-App gerade direkte Nachrichten mit dieser iPhone-App austauschen kann.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if !status.isEmpty {
                    Section {
                        Text(status)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Birdie")
            .onAppear {
                hasWatchToken = WatchTokenStore.shared.load() != nil
                relay.refreshConnectionState()
            }
            .tint(Color(red: 0.035, green: 0.245, blue: 0.155))
        }
    }

    private var watchStatusTitle: String {
        guard relay.activationState == .activated else {
            return "Watch-Verbindung wird vorbereitet"
        }
        guard relay.isPaired else {
            return "Keine Watch gekoppelt"
        }
        guard relay.isWatchAppInstalled else {
            return "Watch-App nicht installiert"
        }
        return relay.isReachable ? "Watch erreichbar" : "Watch gekoppelt · aktuell nicht erreichbar"
    }

    private var watchStatusIcon: String {
        if relay.isReachable {
            return "checkmark.circle.fill"
        }
        return relay.isPaired ? "applewatch" : "questionmark.circle"
    }

    private var watchStatusColor: Color {
        relay.isReachable ? Color.green : Color.secondary
    }

    private func connectionRow(_ title: String, isReady: Bool) -> some View {
        Label(title, systemImage: isReady ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(isReady ? Color.green : Color.secondary)
    }
}

private struct BirdiePhoneMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.035, green: 0.245, blue: 0.155))
            Circle()
                .stroke(Color(red: 0.84, green: 0.69, blue: 0.31), lineWidth: 2)
                .padding(5)
            Text("B")
                .font(.system(size: 27, weight: .semibold, design: .serif))
                .foregroundStyle(Color(red: 0.84, green: 0.69, blue: 0.31))
        }
        .frame(width: 58, height: 58)
        .accessibilityHidden(true)
    }
}
