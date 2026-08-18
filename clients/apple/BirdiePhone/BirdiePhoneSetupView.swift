import SwiftUI

struct BirdiePhoneSetupView: View {
    @State private var token = ""
    @State private var status = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Birdie Watch") {
                    SecureField("Watch API Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button("Sicher verbinden") {
                        do {
                            try WatchTokenStore.shared.save(token)
                            token = ""
                            _ = WatchRelay.shared
                            status = "Birdie Watch ist verbunden."
                        } catch {
                            status = error.localizedDescription
                        }
                    }
                    .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).count < 32)

                    Button("Verbindung entfernen", role: .destructive) {
                        WatchTokenStore.shared.remove()
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
            }
        }
    }
}
