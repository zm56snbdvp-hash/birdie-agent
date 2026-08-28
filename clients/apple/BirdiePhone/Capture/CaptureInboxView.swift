import CaptureCore
import SwiftUI

struct CaptureInboxView: View {
    @ObservedObject var model: CaptureAppModel

    var body: some View {
        NavigationStack(path: $model.navigationPath) {
            Group {
                if let error = model.configurationError {
                    ContentUnavailableView(
                        "Birdie Drop nicht verfügbar",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if model.items.isEmpty {
                    ContentUnavailableView(
                        "Noch nichts vorgemerkt",
                        systemImage: "tray",
                        description: Text("Teile Inhalte mit Birdie Drop oder nutze Birdie Lens.")
                    )
                } else {
                    List(model.items) { item in
                        NavigationLink(value: item.id) {
                            CaptureItemRow(item: item)
                        }
                        .swipeActions {
                            Button("Löschen", role: .destructive) {
                                model.delete(itemID: item.id)
                            }
                        }
                    }
                    .refreshable {
                        model.refresh()
                        model.processQueue()
                    }
                }
            }
            .navigationTitle("Birdie Drop")
            .navigationDestination(for: UUID.self) { id in
                if let item = model.item(id: id) {
                    CaptureItemDetailView(item: item, model: model)
                } else {
                    ContentUnavailableView("Eintrag nicht gefunden", systemImage: "questionmark.folder")
                }
            }
        }
        .privacySensitive()
        .overlay {
            if model.isPrivacyProtected {
                LockedCaptureCover()
            }
        }
    }
}

private struct CaptureItemRow: View {
    let item: CaptureItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .frame(width: 30)
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.intent.title).font(.headline)
                Text(item.payloads.isEmpty
                     ? "Lokaler Eintrag nicht lesbar"
                     : item.payloads.map(\.displayName).joined(separator: ", "))
                    .lineLimit(1)
                    .font(.subheadline)
                Text(statusTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var icon: String {
        switch item.source {
        case .shareExtension: "square.and.arrow.down"
        case .document: "doc.text.viewfinder"
        case .receipt: "receipt"
        case .businessCard: "person.text.rectangle"
        case .whiteboard: "rectangle.and.pencil.and.ellipsis"
        case .errorMessage: "exclamationmark.triangle"
        }
    }

    private var statusTitle: String {
        switch item.status {
        case .staged, .queued: "Lokal in der Warteschlange"
        case .processing: "Lokale Vorschau wird vorbereitet"
        case .retryScheduled: "Offline – erneuter Versuch geplant"
        case .readyForReview: "Lokal zur Prüfung vorbereitet"
        case .failed: "Vorbereitung fehlgeschlagen"
        }
    }
}

private struct CaptureItemDetailView: View {
    let item: CaptureItem
    @ObservedObject var model: CaptureAppModel
    @State private var confirmDelete = false

    var body: some View {
        List {
            Section("Ziel") {
                LabeledContent("Auswahl", value: item.intent.title)
                LabeledContent("Status", value: statusTitle)
                Text("Lokaler Mock-Adapter: kein Upload und keine Außenwirkung.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section("Inhalte") {
                ForEach(item.payloads) { payload in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(payload.displayName).font(.headline)
                        if let text = payload.inlineText {
                            Text(preview(text))
                                .font(.body.monospaced(payload.kind == .recognizedText))
                                .lineLimit(12)
                        }
                    }
                }
            }
            if !item.suggestions.isEmpty {
                Section("Vorschläge – noch keine Aktionen") {
                    ForEach(item.suggestions) { suggestion in
                        LabeledContent(
                            suggestion.label,
                            value: item.containsSensitiveData ? "[redigiert]" : suggestion.value
                        )
                    }
                }
            }
            if let failure = item.lastFailure {
                Section("Fehler") {
                    Text(failure.message)
                    if failure.isRetryable {
                        Button("Jetzt erneut lokal vorbereiten") {
                            model.retry(itemID: item.id)
                        }
                    }
                }
            }
            Section {
                Button("Löschen", role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle(item.intent.title)
        .privacySensitive()
        .confirmationDialog("Eintrag und lokale Dateien löschen?", isPresented: $confirmDelete) {
            Button("Endgültig löschen", role: .destructive) {
                model.delete(itemID: item.id)
            }
            Button("Abbrechen", role: .cancel) {}
        }
    }

    private func preview(_ text: String) -> String {
        guard item.containsSensitiveData, item.source != .shareExtension else { return text }
        let profile: LensProfile
        switch item.source {
        case .document: profile = .document
        case .receipt: profile = .receipt
        case .businessCard: profile = .businessCard
        case .whiteboard: profile = .whiteboard
        case .errorMessage: profile = .errorMessage
        case .shareExtension: return text
        }
        return LensAnalyzer.analyze(text: text, profile: profile).redactedText
    }

    private var statusTitle: String {
        switch item.status {
        case .staged, .queued: "Lokal in der Warteschlange"
        case .processing: "Lokale Vorschau wird vorbereitet"
        case .retryScheduled: "Erneuter Versuch geplant"
        case .readyForReview: "Lokal zur Prüfung vorbereitet"
        case .failed: "Fehlgeschlagen"
        }
    }
}

struct LockedCaptureCover: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "lock.shield.fill").font(.largeTitle)
                Text("Sensible Inhalte geschützt").font(.headline)
            }
        }
    }
}
