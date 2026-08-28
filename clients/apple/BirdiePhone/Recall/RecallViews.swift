import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct RecallHomeView: View {
    @EnvironmentObject private var model: RecallViewModel
    @State private var isShowingCapture = false
    @State private var isShowingFilters = false
    @State private var isShowingSettings = false
    @State private var pendingDeletion: RecallItemV1?

    var body: some View {
        NavigationStack(path: $model.navigationPath) {
            Group {
                if model.settings.isEnabled {
                    recallList
                } else {
                    ContentUnavailableView {
                        Label("Recall ist ausgeschaltet", systemImage: "hand.raised.slash")
                    } description: {
                        Text("Der Kill-Switch blockiert Intake und Suche. Alle gespeicherten Inhalte wurden gelöscht.")
                    } actions: {
                        Button("Recall wieder aktivieren") { Task { await model.enableRecall() } }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Birdie Recall")
            .navigationDestination(for: UUID.self) { identifier in
                if let item = model.item(with: identifier) {
                    RecallDetailView(item: item)
                } else {
                    ContentUnavailableView("Element vergessen", systemImage: "trash")
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Filter", systemImage: "line.3.horizontal.decrease.circle") {
                        isShowingFilters = true
                    }
                    .disabled(!model.settings.isEnabled)

                    Button("Hinzufügen", systemImage: "plus") { isShowingCapture = true }
                        .disabled(!model.settings.isEnabled)

                    Button("Einstellungen", systemImage: "gearshape") { isShowingSettings = true }
                }
            }
            .searchable(
                text: $model.queryText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Wo war das Hotel von gestern?"
            )
            .onSubmit(of: .search) { Task { await model.runSearch() } }
            .task(id: model.queryText) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                await model.runSearch()
            }
            .refreshable { await model.refresh() }
        }
        .sheet(isPresented: $isShowingCapture) { RecallCaptureView() }
        .sheet(isPresented: $isShowingFilters) { RecallFilterView() }
        .sheet(isPresented: $isShowingSettings) { RecallSettingsView() }
        .confirmationDialog(
            "Dieses Element wirklich vergessen?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Endgültig vergessen", role: .destructive) {
                guard let identifier = pendingDeletion?.id else { return }
                pendingDeletion = nil
                Task { await model.forget(identifier) }
            }
            Button("Abbrechen", role: .cancel) { pendingDeletion = nil }
        } message: {
            Text("Original, Metadaten sowie lokale Such- und Spotlight-Einträge werden bereinigt.")
        }
    }

    private var recallList: some View {
        List {
            Section {
                Label(
                    "Nur bewusst ausgewählte Inhalte – keine Zwischenablage, Nachrichten oder automatische Fotomediathek.",
                    systemImage: "lock.shield"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            if model.displayedItems.isEmpty {
                ContentUnavailableView(
                    model.queryText.isEmpty ? "Noch nichts gemerkt" : "Nichts gefunden",
                    systemImage: model.queryText.isEmpty ? "tray" : "magnifyingglass",
                    description: Text(
                        model.queryText.isEmpty
                            ? "Füge einen Link, ein ausgewähltes Bild, PDF oder eine Notiz hinzu."
                            : "Versuche andere Wörter oder ändere die Filter."
                    )
                )
                .listRowBackground(Color.clear)
            } else {
                Section("\(model.displayedItems.count) Elemente") {
                    ForEach(model.displayedItems) { item in
                        NavigationLink(value: item.id) { RecallRow(item: item) }
                            .swipeActions {
                                Button("Vergessen", role: .destructive) { pendingDeletion = item }
                            }
                    }
                }
            }
        }
        .overlay {
            if model.isBusy { ProgressView().controlSize(.large) }
        }
    }
}

private struct RecallRow: View {
    let item: RecallItemV1

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.kind.systemImage)
                .frame(width: 30, height: 30)
                .foregroundStyle(BirdieRecallStyle.green)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.headline)
                HStack {
                    Text(item.kind.displayName)
                    Text("·")
                    Text(item.capturedAt, style: .date)
                    Text("·")
                    Text(item.provenance.channel.displayName)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if !item.tags.isEmpty {
                    Text(item.tags.map { "#\($0)" }.joined(separator: "  "))
                        .font(.caption)
                        .foregroundStyle(BirdieRecallStyle.green)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

struct RecallDetailView: View {
    @EnvironmentObject private var model: RecallViewModel
    @Environment(\.dismiss) private var dismiss
    let item: RecallItemV1
    @State private var confirmDeletion = false

    var body: some View {
        List {
            Section {
                Label(item.kind.displayName, systemImage: item.kind.systemImage)
                LabeledContent("Aufgenommen", value: item.capturedAt.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Herkunft", value: item.provenance.channel.displayName)
                LabeledContent("Stabile ID", value: item.id.uuidString.lowercased())
                    .font(.caption)
                    .textSelection(.enabled)
            }

            if let note = item.note {
                Section("Notiz") { Text(note).textSelection(.enabled) }
            }
            if let link = item.linkURL {
                Section("Link") { Link(link.absoluteString, destination: link) }
            }
            if let summary = item.summary {
                Section("Optionale Zusammenfassung") { Text(summary).textSelection(.enabled) }
            }
            if let extractedText = item.extractedText {
                Section("Lokal extrahierter Text") { Text(extractedText).textSelection(.enabled) }
            }
            if let attachment = item.attachment {
                Section("Lokales Original") {
                    LabeledContent("Datei", value: attachment.originalFilename)
                    LabeledContent("Größe", value: ByteCountFormatter.string(fromByteCount: attachment.byteCount, countStyle: .file))
                    LabeledContent("SHA-256", value: attachment.sha256)
                        .font(.caption)
                        .textSelection(.enabled)
                    Text("App-geschützt und vom Cloud-Backup ausgeschlossen.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if !item.tags.isEmpty {
                Section("Tags") { Text(item.tags.map { "#\($0)" }.joined(separator: "  ")) }
            }
            Section("Aufbewahrung") {
                if let expiresAt = item.retention.expiresAt {
                    LabeledContent("Löschen am", value: expiresAt.formatted(date: .abbreviated, time: .shortened))
                } else {
                    Text("Dauerhaft, bis du das Element vergisst.")
                }
            }
            Section {
                Button("Dieses Element vergessen", role: .destructive) { confirmDeletion = true }
            }
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Endgültig vergessen?", isPresented: $confirmDeletion, titleVisibility: .visible) {
            Button("Vergessen", role: .destructive) {
                Task {
                    await model.forget(item.id)
                    dismiss()
                }
            }
            Button("Abbrechen", role: .cancel) {}
        }
    }
}

struct RecallCaptureView: View {
    @EnvironmentObject private var model: RecallViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var kind: RecallItemKindV1 = .note
    @State private var title = ""
    @State private var content = ""
    @State private var tags = ""
    @State private var retentionChoice = 0
    @State private var photoSelection: PhotosPickerItem?
    @State private var importedFileURL: URL?
    @State private var isImportingFile = false
    @State private var localError: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Typ") {
                    Picker("Typ", selection: $kind) {
                        ForEach(RecallItemKindV1.allCases, id: \.self) { value in
                            Label(value.displayName, systemImage: value.systemImage).tag(value)
                        }
                    }
                }
                Section("Beschreibung") {
                    TextField("Titel", text: $title)
                    TextField("Tags, durch Kommas getrennt", text: $tags)
                        .textInputAutocapitalization(.never)
                }

                payloadSection

                Section("Aufbewahrung") {
                    Picker("Dauer", selection: $retentionChoice) {
                        Text("Standard (\(model.settings.defaultRetentionDays.map { String($0) } ?? "dauerhaft"))").tag(0)
                        Text("Dauerhaft").tag(1)
                    }
                }
                Section {
                    Text("Birdie öffnet keinen Link und durchsucht keine Quelle automatisch. Nur dieser bewusst übergebene Inhalt wird lokal gespeichert.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let localError {
                    Section { Text(localError).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Für später merken")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .fileImporter(
                isPresented: $isImportingFile,
                allowedContentTypes: [.pdf],
                allowsMultipleSelection: false
            ) { result in
                do { importedFileURL = try result.get().first }
                catch { localError = error.localizedDescription }
            }
            .onChange(of: kind) {
                content = ""
                photoSelection = nil
                importedFileURL = nil
                localError = nil
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    @ViewBuilder
    private var payloadSection: some View {
        switch kind {
        case .note:
            Section("Notiz") {
                TextEditor(text: $content).frame(minHeight: 130)
            }
        case .link:
            Section("Link") {
                TextField("https://…", text: $content)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
            }
        case .screenshot, .photo:
            Section(kind.displayName) {
                PhotosPicker(selection: $photoSelection, matching: .images) {
                    Label(
                        photoSelection == nil ? "Bild bewusst auswählen" : "Ausgewähltes Bild ändern",
                        systemImage: "photo.badge.plus"
                    )
                }
                Text("Der System-Picker gibt Birdie nur das ausgewählte Bild, nicht die gesamte Mediathek.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .pdf:
            Section("PDF") {
                Button {
                    isImportingFile = true
                } label: {
                    Label(importedFileURL?.lastPathComponent ?? "PDF bewusst auswählen", systemImage: "doc.badge.plus")
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        localError = nil

        var temporaryURL: URL?
        defer {
            if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
        }
        do {
            let retention: RecallRetentionRequestV1 = retentionChoice == 1 ? .keepForever : .defaultPolicy
            let tagValues = tags.split(separator: ",").map(String.init)
            let provenance = RecallProvenanceV1(
                channel: .manualSelection,
                sourceApplication: "Birdie iPhone",
                submittedAt: Date()
            )
            let capture: CaptureItemV1
            switch kind {
            case .note:
                capture = CaptureItemV1(
                    kind: kind,
                    title: title,
                    provenance: provenance,
                    tags: tagValues,
                    note: content,
                    retention: retention
                )
            case .link:
                capture = CaptureItemV1(
                    kind: kind,
                    title: title,
                    provenance: provenance,
                    tags: tagValues,
                    linkURL: URL(string: content.trimmingCharacters(in: .whitespacesAndNewlines)),
                    retention: retention
                )
            case .screenshot, .photo:
                guard let selection = photoSelection,
                      let data = try await selection.loadTransferable(type: Data.self)
                else {
                    throw BirdieRecallError.invalidPayload("Bitte zuerst genau ein Bild auswählen.")
                }
                let contentType = selection.supportedContentTypes.first(where: { $0.conforms(to: .image) }) ?? .image
                let fileExtension = contentType.preferredFilenameExtension ?? "img"
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("recall-selection-\(UUID().uuidString).\(fileExtension)")
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                temporaryURL = url
                capture = CaptureItemV1(
                    kind: kind,
                    title: title,
                    provenance: provenance,
                    tags: tagValues,
                    localFileURL: url,
                    contentTypeIdentifier: contentType.identifier,
                    retention: retention
                )
            case .pdf:
                guard let importedFileURL else {
                    throw BirdieRecallError.invalidPayload("Bitte zuerst genau ein PDF auswählen.")
                }
                capture = CaptureItemV1(
                    kind: kind,
                    title: title,
                    provenance: provenance,
                    tags: tagValues,
                    localFileURL: importedFileURL,
                    contentTypeIdentifier: UTType.pdf.identifier,
                    retention: retention
                )
            }
            let succeeded = await model.ingest(capture)
            if succeeded { dismiss() }
        } catch {
            localError = error.localizedDescription
        }
    }
}

struct RecallFilterView: View {
    @EnvironmentObject private var model: RecallViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var useStartDate = false
    @State private var useEndDate = false
    @State private var startDate = Calendar.current.startOfDay(for: Date())
    @State private var endDate = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400)

    var body: some View {
        NavigationStack {
            Form {
                Section("Herkunft") {
                    ForEach(RecallIntakeChannelV1.allCases, id: \.self) { source in
                        Toggle(source.displayName, isOn: membershipBinding(source, in: \RecallSearchFiltersV1.sourceChannels))
                    }
                }
                Section("Typ") {
                    ForEach(RecallItemKindV1.allCases, id: \.self) { kind in
                        Toggle(kind.displayName, isOn: membershipBinding(kind, in: \RecallSearchFiltersV1.kinds))
                    }
                }
                Section("Datum") {
                    Toggle("Ab Datum", isOn: $useStartDate)
                    if useStartDate { DatePicker("Von", selection: $startDate, displayedComponents: .date) }
                    Toggle("Vor Datum", isOn: $useEndDate)
                    if useEndDate { DatePicker("Vor", selection: $endDate, displayedComponents: .date) }
                }
            }
            .navigationTitle("Suche filtern")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zurücksetzen") {
                        model.filters = RecallSearchFiltersV1()
                        useStartDate = false
                        useEndDate = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Anwenden") {
                        model.filters.capturedFrom = useStartDate ? Calendar.current.startOfDay(for: startDate) : nil
                        model.filters.capturedBefore = useEndDate ? Calendar.current.startOfDay(for: endDate) : nil
                        Task { await model.runSearch() }
                        dismiss()
                    }
                }
            }
            .onAppear {
                if let value = model.filters.capturedFrom { useStartDate = true; startDate = value }
                if let value = model.filters.capturedBefore { useEndDate = true; endDate = value }
            }
        }
    }

    private func membershipBinding<Element: Hashable>(
        _ element: Element,
        in keyPath: WritableKeyPath<RecallSearchFiltersV1, Set<Element>>
    ) -> Binding<Bool> {
        Binding(
            get: { model.filters[keyPath: keyPath].contains(element) },
            set: { isIncluded in
                var updated = model.filters
                if isIncluded { updated[keyPath: keyPath].insert(element) }
                else { updated[keyPath: keyPath].remove(element) }
                model.filters = updated
            }
        )
    }
}

struct RecallSettingsView: View {
    @EnvironmentObject private var model: RecallViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var retentionDays = 30
    @State private var applyToExisting = false
    @State private var confirmForgetAll = false
    @State private var confirmKillSwitch = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Datenschutz") {
                    Toggle(
                        "In Core Spotlight suchen",
                        isOn: Binding(
                            get: { model.settings.isSpotlightEnabled },
                            set: { value in Task { await model.setSpotlightEnabled(value) } }
                        )
                    )
                    Text("Opt-in. Es werden nur Titel, kurzer Text, Tags, Typ und Datum lokal indexiert; nie Original oder Thumbnail.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Aufbewahrungsdauer") {
                    Picker("Standard", selection: $retentionDays) {
                        Text("7 Tage").tag(7)
                        Text("30 Tage").tag(30)
                        Text("90 Tage").tag(90)
                        Text("365 Tage").tag(365)
                        Text("Dauerhaft").tag(-1)
                    }
                    Toggle("Auch auf vorhandene Elemente anwenden", isOn: $applyToExisting)
                    Button("Aufbewahrung speichern") {
                        Task {
                            await model.setDefaultRetentionDays(
                                retentionDays == -1 ? nil : retentionDays,
                                applyToExisting: applyToExisting
                            )
                        }
                    }
                }

                Section("Export") {
                    Button("Bewussten JSON-Export erstellen") { Task { await model.prepareExport() } }
                    Text("Der Export ist unverschlüsselt und enthält ausgewählte Originale als Base64. Er wird nur nach diesem Tippen erzeugt.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Löschen") {
                    Button("Alle Inhalte vergessen", role: .destructive) { confirmForgetAll = true }
                    Button("Recall-Kill-Switch", role: .destructive) { confirmKillSwitch = true }
                    Text("Der Kill-Switch blockiert Intake und Suche, löscht alle Recall-Inhalte und leert die lokalen Indizes.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if !model.deletionHistory.isEmpty {
                    Section("Lokaler Löschverlauf") {
                        ForEach(model.deletionHistory.prefix(10)) { receipt in
                            VStack(alignment: .leading) {
                                Text(receipt.reason)
                                Text("\(receipt.deletedItemCount) Elemente · \(receipt.completedAt.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Recall-Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .onAppear { retentionDays = model.settings.defaultRetentionDays ?? -1 }
            .confirmationDialog("Alle Recall-Inhalte löschen?", isPresented: $confirmForgetAll, titleVisibility: .visible) {
                Button("Alle endgültig vergessen", role: .destructive) { Task { await model.forgetAll() } }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text("Recall bleibt aktiv. Originale, Metadaten und Indizes werden gelöscht; ein inhaltsfreier Löschbeleg bleibt lokal.")
            }
            .confirmationDialog("Kill-Switch aktivieren?", isPresented: $confirmKillSwitch, titleVisibility: .visible) {
                Button("Ausschalten und alles löschen", role: .destructive) {
                    Task {
                        await model.engageKillSwitch()
                        dismiss()
                    }
                }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text("Intake und Suche werden blockiert. Alle Recall-Inhalte und lokalen Indizes werden bereinigt.")
            }
        }
    }
}
