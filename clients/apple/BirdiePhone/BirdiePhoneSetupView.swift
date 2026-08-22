import SwiftUI

struct BirdiePhoneSetupView: View {
    @State private var token = ""
    @State private var status = ""
    @State private var isConnected = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        BirdiePhoneMark()
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Birdie")
                                .font(.title2.weight(.semibold))
                            Label(
                                isConnected ? "Watch verbunden" : "Watch noch nicht verbunden",
                                systemImage: isConnected ? "checkmark.circle.fill" : "applewatch"
                            )
                            .font(.subheadline)
                            .foregroundStyle(isConnected ? Color.green : Color.gray)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("Birdie Watch") {
                    SecureField("Watch API Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button("Sicher verbinden") {
                        do {
                            try WatchTokenStore.shared.save(token)
                            token = ""
                            _ = WatchRelay.shared
                            isConnected = true
                            status = "Birdie Watch ist verbunden."
                        } catch {
                            status = error.localizedDescription
                        }
                    }
                    .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).count < 32)

                    Button("Verbindung entfernen", role: .destructive) {
                        WatchTokenStore.shared.remove()
                        isConnected = false
                        status = "Birdie Watch wurde getrennt."
                    }
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
                _ = WatchRelay.shared
                isConnected = WatchTokenStore.shared.load() != nil
            }
            .tint(Color(red: 0.035, green: 0.245, blue: 0.155))
        }
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
