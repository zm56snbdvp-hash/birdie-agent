import SwiftUI

struct DayPilotProposalView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: DayPilotViewModel

    @State private var kind: DayPilotProposal.Kind = .event
    @State private var title = ""
    @State private var date = Date().addingTimeInterval(3_600)
    @State private var preview: DayPilotProposal?
    @State private var previewError: String?
    @State private var showingFinalConfirmation = false
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Vorschlag") {
                    Picker("Art", selection: $kind) {
                        ForEach(DayPilotProposal.Kind.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                    TextField("Titel", text: $title)
                    DatePicker("Zeitpunkt", selection: $date)
                }

                Section {
                    Button("Sichere Vorschau erstellen") {
                        do {
                            preview = try model.prepareProposal(kind: kind, title: title, date: date)
                            previewError = nil
                        } catch {
                            preview = nil
                            previewError = error.localizedDescription
                        }
                    }
                    .disabled(cleanTitle.isEmpty)
                } footer: {
                    Text("Das Erstellen der Vorschau ändert weder Kalender noch Erinnerungen.")
                }

                if let previewError {
                    Section("Vorschau nicht möglich") {
                        Text(previewError)
                    }
                }

                if let preview {
                    Section("Vorschau") {
                        LabeledContent("Art", value: preview.kind.title)
                        LabeledContent("Titel", value: preview.title)
                        LabeledContent("Zeitpunkt") {
                            Text(preview.date, format: .dateTime.day().month().hour().minute())
                        }
                        if let endDate = preview.endDate {
                            LabeledContent("Ende") {
                                Text(endDate, format: .dateTime.day().month().hour().minute())
                            }
                        }
                        LabeledContent("Zeitzone", value: preview.timeZoneIdentifier)
                        LabeledContent("Ziel", value: preview.destinationCalendarTitle)

                        Button("Vorschlag bestätigen") {
                            showingFinalConfirmation = true
                        }
                        .disabled(isSaving)
                    }
                }

                if isSaving {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Änderung vorschlagen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
            }
            .onChange(of: kind) { _, _ in resetPreview() }
            .onChange(of: title) { _, _ in resetPreview() }
            .onChange(of: date) { _, _ in resetPreview() }
            .confirmationDialog(
                "\(preview?.kind.title ?? "Änderung") wirklich anlegen?",
                isPresented: $showingFinalConfirmation,
                titleVisibility: .visible
            ) {
                Button("Jetzt anlegen") {
                    guard let preview else { return }
                    Task {
                        isSaving = true
                        let success = await model.applyConfirmed(preview)
                        isSaving = false
                        if success { dismiss() }
                    }
                }
                Button("Zurück zur Vorschau", role: .cancel) {}
            } message: {
                Text("Erst dieser zweite, ausdrückliche Tap schreibt die angezeigte Änderung.")
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var cleanTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func resetPreview() {
        preview = nil
        previewError = nil
    }
}
