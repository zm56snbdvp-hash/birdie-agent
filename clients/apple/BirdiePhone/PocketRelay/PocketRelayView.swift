import SwiftUI
import UniformTypeIdentifiers

struct PocketRelayView: View {
    @ObservedObject var model: PocketRelayViewModel

    @State private var hostURL = PocketRelayBuildConfiguration.productionHostURL?.absoluteString ?? ""
    @State private var pairingCode = ""
    @State private var iPhoneName = "Birdie iPhone"
    @State private var action: PocketRelayAction = .openLink
    @State private var link = ""
    @State private var exportId = ""
    @State private var workflowId = ""
    @State private var inputRef = ""
    @State private var showingFileImporter = false
    @State private var showingFileExporter = false
    @State private var exportDocument: PocketRelayExportDocument?
    @State private var pendingApproval: PendingApproval?

    var body: some View {
        NavigationStack {
            Form {
                connectionSection
                if model.pairedSession != nil {
                    commandSection
                    disclosureSection
                    queueSection
                }
                feedbackSection
            }
            .navigationTitle("Pocket Relay")
            .tint(Color(red: 0.035, green: 0.245, blue: 0.155))
            .task { await model.start() }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.data],
                allowsMultipleSelection: false
            ) { result in
                Task { @MainActor in
                    switch result {
                    case .success(let urls):
                        if let url = urls.first { model.selectFile(url) }
                    case .failure(let error):
                        model.statusMessage = error.localizedDescription
                    }
                }
            }
            .fileExporter(
                isPresented: $showingFileExporter,
                document: exportDocument,
                contentType: exportContentType,
                defaultFilename: model.fetchedFile?.metadata.fileName ?? "Birdie-Export"
            ) { result in
                switch result {
                case .success:
                    model.clearFetchedFile()
                    exportDocument = nil
                    model.statusMessage = "Die Datei wurde am ausdrücklich gewählten Ort gesichert."
                case .failure(let error):
                    model.statusMessage = error.localizedDescription
                }
            }
            .alert(
                "Ausdrückliche iPhone-Freigabe",
                isPresented: Binding(
                    get: { pendingApproval != nil },
                    set: { if !$0 { pendingApproval = nil } }
                ),
                presenting: pendingApproval
            ) { approval in
                Button("Ausdrücklich freigeben") {
                    pendingApproval = nil
                    perform(approval)
                }
                Button("Abbrechen", role: .cancel) { pendingApproval = nil }
            } message: { approval in
                Text(approvalMessage(for: approval))
            }
        }
    }

    private var connectionSection: some View {
        Section("Sichere Verbindung") {
            Label(model.connectionStatus.title, systemImage: connectionIcon)
                .foregroundStyle(connectionColor)

            if let paired = model.pairedSession {
                LabeledContent("Zielgerät", value: paired.targetDevice.deviceName)
                LabeledContent("Plattform", value: "Windows")
                LabeledContent("iPhone-ID", value: paired.deviceId)
                    .lineLimit(1)
                LabeledContent("Token gültig bis") {
                    Text(paired.accessTokenExpiresAt, style: .time)
                }
                Button("Lokale Kopplung entfernen", role: .destructive) {
                    Task { await model.disconnect() }
                }
            } else {
                if PocketRelayBuildConfiguration.pairingAvailable {
                    #if DEBUG
                    TextField("https://relay.example oder http://localhost", text: $hostURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    #else
                    LabeledContent("Konfigurierter Host", value: hostURL)
                    #endif
                    SecureField("Pairing-Code", text: $pairingCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Name dieses iPhones", text: $iPhoneName)
                        .autocorrectionDisabled()
                    Button("Gerätegebunden koppeln") {
                        let code = pairingCode
                        pairingCode = ""
                        Task { await model.pair(hostURL: hostURL, pairingCode: code, deviceName: iPhoneName) }
                    }
                    .disabled(hostURL.isEmpty || pairingCode.count < 8 || iPhoneName.isEmpty || model.isBusy)

                    #if DEBUG
                    Text("Manuelles Pairing ist in diesem Debug-Build für den externen Mock-Host freigeschaltet. Der Code wird nicht als einmalig dargestellt oder gespeichert.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    #else
                    Text("Der Release-Build akzeptiert nur den build-time gesetzten HTTPS-Host mit deklarierter gerätegebundener Einmal-Pairing-Garantie.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    #endif
                } else {
                    Label("Produktionsgateway nicht konfiguriert", systemImage: "lock.shield")
                    Text("Dieser Release-Build bleibt fail-closed. Es ist weder ein Produktions-Host noch eine verifizierte Pairing-Garantie eingebaut.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var commandSection: some View {
        Section("Erlaubte Aktion") {
            Picker("Aktion", selection: $action) {
                ForEach(PocketRelayAction.allCases) { item in
                    Text(item.title).tag(item)
                }
            }

            actionFields

            Button(submitButtonTitle) {
                prepareCommandDraft()
            }
            .disabled(model.isBusy || model.pairedSession == nil)
        }
    }

    @ViewBuilder
    private var actionFields: some View {
        switch action {
        case .openLink:
            TextField("HTTPS-Link", text: $link)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
        case .sendFileToPC:
            Button("Datei ausdrücklich auswählen") { showingFileImporter = true }
            if let file = model.selectedFile {
                VStack(alignment: .leading, spacing: 4) {
                    Text(file.metadata.fileName)
                    Text("\(ByteCountFormatter.string(fromByteCount: Int64(file.metadata.sizeBytes), countStyle: .file)) · SHA-256 \(file.metadata.sha256.prefix(12))…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("Auswahl entfernen", role: .destructive) { model.clearSelectedFile() }
            }
        case .fetchFileToIPhone:
            TextField("Am PC freigegebene Export-ID", text: $exportId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Text("Pocket Relay akzeptiert nur eine zuvor am PC erteilte, undurchsichtige Freigabe-ID – niemals einen Dateipfad.")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .startWorkflow:
            workflowFields(includeInput: true)
        case .pauseWorkflow, .cancelWorkflow, .getWorkflowResult:
            workflowFields(includeInput: false)
        case .lockPC:
            Text("Der Vertrag sendet ausschließlich den festen Bestätigungscode LOCK_PC.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func workflowFields(includeInput: Bool) -> some View {
        TextField("Registrierte Workflow-ID", text: $workflowId)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        if includeInput,
           let cursor = model.workflowCursor(for: workflowId),
           cursor.state == .paused {
            LabeledContent("Pausierten Lauf fortsetzen", value: cursor.runId)
                .font(.caption)
            LabeledContent("Erwartete Revision", value: String(cursor.revision))
                .font(.caption)
            LabeledContent("Unveränderlicher Input", value: cursor.inputRef ?? "Keiner")
                .font(.caption)
            Text("Beim Fortsetzen bleiben Lauf-ID und Input-Referenz unverändert.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if includeInput,
                  let cursor = model.workflowCursor(for: workflowId),
                  cursor.state == .queued || cursor.state == .running {
            LabeledContent("Aktiver Lauf", value: cursor.runId)
                .font(.caption)
            LabeledContent("Bekannter Zustand", value: cursor.state.title)
                .font(.caption)
            Text("Ein aktiver Lauf kann nicht erneut gestartet werden. Pausiere ihn zuerst.")
                .font(.caption)
                .foregroundStyle(.orange)
        } else if includeInput {
            TextField("Freigegebene Input-Referenz (optional)", text: $inputRef)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            LabeledContent("Neuer Lauf", value: model.proposedWorkflowRunId.uuidString.lowercased())
                .font(.caption)
            LabeledContent("Erwartete Revision", value: "0")
                .font(.caption)
        } else if let cursor = model.workflowCursor(for: workflowId) {
            LabeledContent("Gebundener Lauf", value: cursor.runId)
                .font(.caption)
            LabeledContent(
                action == .getWorkflowResult ? "Bekannte Revision" : "Erwartete Revision",
                value: String(cursor.revision)
            )
                .font(.caption)
            LabeledContent("Bekannter Zustand", value: cursor.state.title)
                .font(.caption)
        } else {
            Text("Für diese Aktion ist ein zuvor verifizierter Lauf-/Revisions-Cursor dieses iPhones erforderlich.")
                .font(.caption)
                .foregroundStyle(.orange)
        }
    }

    private var disclosureSection: some View {
        Section("Vor dem Senden") {
            LabeledContent("Ziel", value: model.pairedSession?.targetDevice.deviceName ?? "Nicht gekoppelt")
            LabeledContent("Scope", value: action.descriptor.scope)
            LabeledContent("Risiko", value: riskTitle)
            VStack(alignment: .leading, spacing: 4) {
                Text("Daten").font(.caption).foregroundStyle(.secondary)
                Text(model.dataSummary(
                    action: action,
                    link: link,
                    exportId: exportId,
                    workflowId: workflowId,
                    inputRef: inputRef
                ))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Erwarteter Effekt").font(.caption).foregroundStyle(.secondary)
                Text(action.descriptor.expectedEffect)
            }
            if action.descriptor.risk == .high {
                Label("Erfordert eine ausdrückliche Freigabe auf diesem iPhone", systemImage: "exclamationmark.shield.fill")
                    .foregroundStyle(.orange)
            }
        }
    }

    private var queueSection: some View {
        Section("Aufträge") {
            if model.queueRecords.isEmpty {
                Text("Noch keine Aufträge")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.queueRecords.prefix(20)) { record in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(record.action.title).font(.headline)
                            Spacer()
                            Text(record.state.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(stateColor(record.state))
                        }
                        Text("\(record.target.deviceName) · \(record.action.descriptor.scope)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(record.payload.publicSummary)
                            .font(.caption)
                            .lineLimit(2)
                        if let message = record.lastErrorMessage {
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                        if let audit = record.audit {
                            Label(
                                audit.idempotentReplay ? "Audit-Quittung verifiziert · idempotente Wiederholung" : "Audit-Quittung verifiziert",
                                systemImage: "checkmark.seal.fill"
                            )
                            .font(.caption)
                            .foregroundStyle(.green)
                        }
                        if record.state == .paused {
                            Button(record.action.descriptor.risk == .high ? "Erneut prüfen & freigeben" : "Jetzt erneut versuchen") {
                                if record.action.descriptor.risk == .high {
                                    do {
                                        pendingApproval = .retry(try model.makeRetryApprovalDraft(id: record.id))
                                    } catch {
                                        model.statusMessage = error.localizedDescription
                                    }
                                } else {
                                    Task { await model.retry(id: record.id) }
                                }
                            }
                        }
                        if record.state == .queued || record.state == .paused {
                            Button("Lokalen Auftrag abbrechen", role: .destructive) {
                                Task { await model.cancel(id: record.id) }
                            }
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
        }
    }

    @ViewBuilder
    private var feedbackSection: some View {
        if let file = model.fetchedFile {
            Section("Geprüfte Datei vom PC") {
                Text(file.metadata.fileName)
                Text("\(ByteCountFormatter.string(fromByteCount: Int64(file.metadata.sizeBytes), countStyle: .file)) · SHA-256 \(file.metadata.sha256.prefix(12))…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Speicherort ausdrücklich wählen") {
                    exportDocument = PocketRelayExportDocument(data: file.data)
                    showingFileExporter = true
                }
                Button("Datei verwerfen", role: .destructive) {
                    model.clearFetchedFile()
                    exportDocument = nil
                }
            }
        }
        if let result = model.lastResult {
            Section("Letztes freigegebenes Ergebnis") { Text(result) }
        }
        if let status = model.statusMessage {
            Section { Text(status).font(.footnote) }
        }
    }

    private var exportContentType: UTType {
        guard let mimeType = model.fetchedFile?.metadata.contentType,
              let type = UTType(mimeType: mimeType)
        else { return .data }
        return type
    }

    private var submitButtonTitle: String {
        action.descriptor.risk == .high ? "Prüfen & ausdrücklich freigeben" : "Sicher vormerken"
    }

    private var riskTitle: String {
        switch action.descriptor.risk {
        case .low: "Niedrig"
        case .medium: "Mittel"
        case .high: "Hoch"
        }
    }

    private var connectionIcon: String {
        switch model.connectionStatus {
        case .paired: "checkmark.shield.fill"
        case .offline: "wifi.slash"
        case .revoked: "person.crop.circle.badge.xmark"
        case .killSwitch: "power"
        case .unconfigured: "iphone.and.arrow.forward"
        }
    }

    private var connectionColor: Color {
        switch model.connectionStatus {
        case .paired: .green
        case .offline: .orange
        case .revoked, .killSwitch: .red
        case .unconfigured: .secondary
        }
    }

    private func stateColor(_ state: PocketRelayCommandState) -> Color {
        switch state {
        case .completed: .green
        case .failed: .red
        case .cancelled: .secondary
        case .paused: .orange
        case .running: .blue
        case .queued: .secondary
        }
    }

    private func perform(_ approval: PendingApproval) {
        switch approval {
        case .enqueue(let draft):
            Task { await model.enqueue(draft: draft, explicitlyApproved: true) }
        case .retry(let draft):
            Task { await model.retry(approvalDraft: draft) }
        }
    }

    private func prepareCommandDraft() {
        do {
            let draft = try model.makeApprovalDraft(
                action: action,
                link: link,
                exportId: exportId,
                workflowId: workflowId,
                inputRef: inputRef
            )
            if draft.action.descriptor.risk == .high {
                pendingApproval = .enqueue(draft)
            } else {
                Task { await model.enqueue(draft: draft, explicitlyApproved: false) }
            }
        } catch {
            model.statusMessage = error.localizedDescription
        }
    }

    private func approvalMessage(for approval: PendingApproval) -> String {
        switch approval {
        case .enqueue(let draft):
            return [
                "Aktion: \(draft.action.title)",
                "Auftrag: \(draft.id.uuidString.lowercased())",
                "Ziel: \(draft.target.deviceName)",
                "Scope: \(draft.scope)",
                "Daten: \(draft.dataSummary)",
                "Effekt: \(draft.expectedEffect)"
            ].joined(separator: "\n")
        case .retry(let draft):
            return [
                "Aktion: \(draft.action.title)",
                "Auftrag: \(draft.recordId.uuidString.lowercased())",
                "Ziel: \(draft.target.deviceName)",
                "Scope: \(draft.scope)",
                "Daten: \(draft.dataSummary)",
                "Effekt: \(draft.expectedEffect)"
            ].joined(separator: "\n")
        }
    }
}

private struct PocketRelayExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }

    let data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw PocketRelayLocalError.contract("Die ausgewählte Datei konnte nicht gelesen werden.")
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private enum PendingApproval: Identifiable {
    case enqueue(PocketRelayApprovalDraft)
    case retry(PocketRelayRetryApprovalDraft)

    var id: String {
        switch self {
        case .enqueue(let draft): "enqueue-\(draft.id.uuidString)"
        case .retry(let draft): "retry-\(draft.id.uuidString)"
        }
    }
}
