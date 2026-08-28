import CaptureCore
import PhotosUI
import SwiftUI

struct BirdieLensView: View {
    @ObservedObject var appModel: CaptureAppModel
    let onSaved: () -> Void

    @StateObject private var model = LensCaptureModel()
    @State private var photoItem: PhotosPickerItem?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    intro
                    profilePicker

                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }

                    switch model.phase {
                    case .idle:
                        sourceButtons
                    case .recognizing:
                        ProgressView("OCR läuft vollständig auf diesem Gerät …")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    case .preview:
                        preview
                    case .saving:
                        ProgressView("Wird geschützt lokal übernommen …")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    case .saved:
                        VStack(spacing: 12) {
                            Label("In Birdie Drop zur Prüfung vorbereitet", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Button("Neuen Scan starten", action: model.startNewScan)
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Birdie Lens")
        }
        .privacySensitive()
        .sheet(isPresented: $model.isScannerPresented) {
            DocumentScannerView(
                onComplete: model.accept(images:),
                onCancel: model.discardUnconfirmed,
                onFailure: model.scannerFailed
            )
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { _, item in model.loadPhoto(item) }
        .onChange(of: model.profile) { _, _ in model.profileDidChange() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.discardUnconfirmed() }
        }
        .overlay {
            if appModel.isPrivacyProtected {
                LockedCaptureCover()
            }
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("On-device OCR", systemImage: "viewfinder")
                .font(.headline)
            Text("Originale bleiben flüchtig, bis du die lokale Übernahme ausdrücklich bestätigst. Es werden nur Vorschläge erzeugt – keine Kontakte, Aufgaben oder Nachrichten angelegt.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var profilePicker: some View {
        Picker("Erkennen als", selection: $model.profile) {
            ForEach(LensProfile.allCases, id: \.self) { profile in
                Text(profile.title).tag(profile)
            }
        }
        .pickerStyle(.menu)
    }

    private var sourceButtons: some View {
        VStack(spacing: 12) {
            Button(action: model.requestScan) {
                Label("Mit Kamera scannen", systemImage: "doc.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Ein Bild auswählen", systemImage: "photo.on.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            Text("Die Bildauswahl gewährt nur Zugriff auf das ausgewählte Bild.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 16) {
            if model.containsSensitiveData && model.redactSensitivePreview {
                ContentUnavailableView(
                    "Scanbild redigiert",
                    systemImage: "eye.slash",
                    description: Text("Deaktiviere die Redigierung nur im entsperrten Zustand, um das Original zu prüfen.")
                )
                .frame(minHeight: 160)
            } else if let first = model.pageImages.first {
                Image(uiImage: first)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel("Erste Scan-Seite")
            }

            if model.containsSensitiveData {
                Toggle("Sensible Daten in Vorschau redigieren", isOn: $model.redactSensitivePreview)
            }

            GroupBox("Erkannter Text") {
                Text(model.redactSensitivePreview ? model.redactedText : model.recognizedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }

            if !model.suggestions.isEmpty {
                GroupBox("Strukturierte Vorschläge – noch keine Aktionen") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(model.suggestions) { suggestion in
                            LabeledContent(
                                suggestion.label,
                                value: model.containsSensitiveData && model.redactSensitivePreview
                                    ? "[redigiert]"
                                    : suggestion.value
                            )
                        }
                    }
                }
            }

            Picker("Ziel", selection: $model.intent) {
                ForEach(CaptureIntent.allCases, id: \.self) { intent in
                    Text(intent.title).tag(intent)
                }
            }
            .pickerStyle(.menu)

            Toggle("Originalseiten lokal beilegen", isOn: $model.includeOriginals)
            Text(model.includeOriginals
                 ? "Die Originalseiten werden erst mit dem nächsten Tap dauerhaft in der geschützten App Group gespeichert."
                 : "Nur der erkannte Text wird übernommen; die Originalseiten werden verworfen.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Lokal als „\(model.intent.title)“ übernehmen") {
                model.commit(to: appModel, onSaved: onSaved)
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)

            Button("Scan löschen und abbrechen", role: .destructive, action: model.discardUnconfirmed)
                .frame(maxWidth: .infinity)
        }
    }
}
