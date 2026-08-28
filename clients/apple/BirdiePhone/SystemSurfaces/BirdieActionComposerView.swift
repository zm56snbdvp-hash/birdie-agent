import SwiftUI
import WidgetKit

struct BirdieActionComposerView: View {
    @Environment(\.dismiss) private var dismiss

    let route: BirdieRoute

    @State private var text: String
    @State private var showingConfirmation = false
    @State private var isWorking = false
    @State private var resultMessage: String?

    private let client = BirdieAgentClient()

    init(route: BirdieRoute) {
        self.route = route
        _text = State(initialValue: route.draft ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(route.action == .ask ? "Frage" : "Gedanke")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextEditor(text: $text)
                        .frame(minHeight: 130)
                        .accessibilityLabel(route.action == .ask ? "Frage an Birdie" : "Gedankenentwurf")
                } header: {
                    Label(contract.title, systemImage: contract.systemImageName)
                } footer: {
                    Text(safetyMessage)
                }

                Section("Sichere Vorschau") {
                    if cleanText.isEmpty {
                        Text("Noch kein Inhalt")
                            .foregroundStyle(.secondary)
                    } else {
                        Text(cleanText)
                    }
                }

                Section {
                    Button(actionTitle) {
                        showingConfirmation = true
                    }
                    .disabled(cleanText.isEmpty || isWorking)

                    if isWorking {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    }
                }

                if let resultMessage {
                    Section("Ergebnis") {
                        Text(resultMessage)
                    }
                }
            }
            .navigationTitle(contract.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Schließen") { dismiss() }
                }
            }
            .confirmationDialog(
                confirmationTitle,
                isPresented: $showingConfirmation,
                titleVisibility: .visible
            ) {
                Button(confirmButtonTitle) {
                    Task { await performConfirmedAction() }
                }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text(confirmationMessage)
            }
        }
        .interactiveDismissDisabled(isWorking)
    }

    private var contract: BirdieActionContract {
        BirdieActionCatalog.contract(for: route.action)
    }

    private var cleanText: String {
        String(
            text.trimmingCharacters(in: .whitespacesAndNewlines)
                .prefix(BirdieRoute.maximumDraftLength)
        )
    }

    private var safetyMessage: String {
        route.action == .ask
            ? "Der Intent hat nichts gesendet. Erst deine Bestätigung startet die externe Anfrage."
            : "Der Intent hat nichts gespeichert. Erst deine Bestätigung schreibt den Gedanken lokal."
    }

    private var actionTitle: String {
        route.action == .ask ? "Vorschau prüfen & senden" : "Vorschau prüfen & merken"
    }

    private var confirmationTitle: String {
        route.action == .ask ? "Frage wirklich senden?" : "Gedanken wirklich speichern?"
    }

    private var confirmButtonTitle: String {
        route.action == .ask ? "Jetzt senden" : "Jetzt lokal speichern"
    }

    private var confirmationMessage: String {
        route.action == .ask
            ? "Birdie sendet den angezeigten Text erst nach diesem Tap an den konfigurierten Agent-Zugang."
            : "Birdie speichert genau den angezeigten Text erst nach diesem Tap lokal und app-exklusiv."
    }

    @MainActor
    private func performConfirmedAction() async {
        guard !cleanText.isEmpty else { return }
        isWorking = true
        defer { isWorking = false }

        switch route.action {
        case .ask:
            do {
                resultMessage = try await client.askConfirmed(cleanText)
            } catch {
                resultMessage = error.localizedDescription
            }
        case .captureThought:
            BirdieThoughtStore.shared.saveConfirmed(cleanText)
            WidgetCenter.shared.reloadTimelines(ofKind: DayPilotWidgetContract.kind)
            resultMessage = "Gedanke wurde nach deiner Bestätigung lokal gespeichert."
        case .briefing, .nextStep:
            break
        }
    }
}
