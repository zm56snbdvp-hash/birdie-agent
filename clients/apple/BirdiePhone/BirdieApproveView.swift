import SwiftUI

@MainActor
struct BirdieApproveView: View {
    @ObservedObject var store: BirdieApprovalStore
    @Binding var requestedApprovalID: String?
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if store.approvals.isEmpty, store.isLoading {
                    ProgressView("Freigaben werden geladen …")
                } else if store.approvals.isEmpty {
                    ContentUnavailableView(
                        "Keine offenen Freigaben",
                        systemImage: "checkmark.shield",
                        description: Text(store.errorMessage ?? "BirdieOS wartet auf keine Entscheidung.")
                    )
                } else {
                    List {
                        #if DEBUG
                        Section {
                            Label(
                                "Lokaler Sicherheits-Mock – keine reale Aktion wird ausgeführt",
                                systemImage: "hammer"
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                        #endif

                        if let receipt = store.lastReceipt {
                            Section("Letzter Receipt") {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(receipt.decision.title)
                                        .font(.headline)
                                    Text(receipt.receiptID)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                    Text(receipt.result)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }

                        Section("Offen") {
                            ForEach(store.approvals) { approval in
                                NavigationLink(value: approval.id) {
                                    ApprovalCard(approval: approval)
                                }
                            }
                        }
                    }
                    .refreshable { await store.refresh() }
                }
            }
            .navigationTitle("Birdie Approve")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task {
                            do {
                                let accepted = try await BirdieNotificationManager.shared
                                    .requestAuthorization()
                                if !accepted {
                                    store.errorMessage = "Notifications wurden nicht freigegeben."
                                }
                            } catch {
                                store.errorMessage = error.localizedDescription
                            }
                        }
                    } label: {
                        Label("Sichere Notifications aktivieren", systemImage: "bell.badge")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Label("Neu laden", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isLoading)
                }
            }
            .navigationDestination(for: String.self) { approvalID in
                if let approval = store.approvals.first(where: { $0.id == approvalID }) {
                    ApprovalDetailView(store: store, approval: approval)
                } else {
                    ContentUnavailableView(
                        "Freigabe nicht mehr offen",
                        systemImage: "checkmark.circle"
                    )
                }
            }
            .task {
                if store.approvals.isEmpty { await store.refresh() }
                openRequestedApprovalIfAvailable()
            }
            .onChange(of: requestedApprovalID) {
                openRequestedApprovalIfAvailable()
            }
            .alert(
                "Birdie Trust",
                isPresented: Binding(
                    get: { store.errorMessage != nil },
                    set: { if !$0 { store.errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { store.errorMessage = nil }
            } message: {
                Text(store.errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private func openRequestedApprovalIfAvailable() {
        guard let requestedApprovalID,
              store.approvals.contains(where: { $0.id == requestedApprovalID })
        else { return }
        path = [requestedApprovalID]
        self.requestedApprovalID = nil
    }
}

private struct ApprovalCard: View {
    let approval: ApprovalItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(approval.actionKind.title, systemImage: approval.actionKind.systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                ApprovalRiskBadge(risk: approval.risk)
            }
            Text(approval.title)
                .font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Label(approval.target.displayName, systemImage: "scope")
                Text(approval.target.canonicalIdentifier)
                    .font(.caption2.monospaced())
                    .lineLimit(2)
                    .privacySensitive()

                Text("Beabsichtigte Änderungen")
                    .font(.caption.weight(.semibold))
                    .padding(.top, 3)
                ForEach(Array(approval.changes.prefix(3))) { change in
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(change.field) · \(change.classification)")
                            .font(.caption2.weight(.semibold))
                        Text("\(change.before ?? "—") → \(change.proposed)")
                            .font(.caption2)
                            .lineLimit(2)
                            .privacySensitive()
                    }
                }
                if approval.changes.count > 3 {
                    Text("+ \(approval.changes.count - 3) weitere vollständig in der Prüfung")
                        .font(.caption2)
                }

                Label {
                    Text(approval.expiresAt, style: .relative)
                } icon: {
                    Image(systemName: "timer")
                }
                Label(approval.source.system, systemImage: "arrow.triangle.branch")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}

private struct ApprovalRiskBadge: View {
    let risk: ApprovalRisk

    private var color: Color {
        switch risk {
        case .green: .green
        case .amber: .orange
        case .red: .red
        }
    }

    var body: some View {
        Text("Risiko \(risk.title)")
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
            .accessibilityLabel("Risiko \(risk.title)")
    }
}

@MainActor
private struct ApprovalDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: BirdieApprovalStore
    let approval: ApprovalItem
    @State private var showingApprovalConfirmation = false
    @State private var showingRejectionConfirmation = false
    @State private var showingEditor = false

    private var isWorking: Bool { store.activeApprovalIDs.contains(approval.id) }

    var body: some View {
        List {
            Section {
                HStack {
                    Label(approval.actionKind.title, systemImage: approval.actionKind.systemImage)
                    Spacer()
                    ApprovalRiskBadge(risk: approval.risk)
                }
                Text(approval.summary)
                    .foregroundStyle(.secondary)
                ForEach(approval.riskReasons, id: \.self) { reason in
                    Label(reason, systemImage: "exclamationmark.shield")
                        .font(.footnote)
                }
                if approval.irreversible {
                    Label("Nicht automatisch rückgängig zu machen", systemImage: "arrow.uturn.backward.slash")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                }
            }

            Section("Exaktes Ziel") {
                LabeledContent("Name", value: approval.target.displayName)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Kanonische ID")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(approval.target.canonicalIdentifier)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text("Kanonischer Payload-Digest")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(approval.payloadDigest)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                }
            }

            Section("Beabsichtigte Änderung / Daten") {
                ForEach(approval.changes) { change in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(change.field)
                                .font(.headline)
                            Spacer()
                            Text(change.classification)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let before = change.before {
                            Text("Vorher: \(before)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text("Geplant: \(change.proposed)")
                            .font(.body)
                            .textSelection(.enabled)
                            .privacySensitive()
                    }
                    .padding(.vertical, 3)
                }
            }

            Section("Zeit und Quelle") {
                LabeledContent("Läuft ab") {
                    Text(approval.expiresAt, format: .dateTime.day().month().hour().minute())
                }
                LabeledContent("System", value: approval.source.system)
                LabeledContent("Workflow", value: approval.source.workflowID)
                LabeledContent("Angefordert von", value: approval.source.requestedBy)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Correlation ID")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(approval.source.correlationID)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }

            Section {
                Button("Genehmigen") { showingApprovalConfirmation = true }
                    .frame(maxWidth: .infinity)
                    .buttonStyle(.borderedProminent)
                    .tint(approval.risk == .red ? .red : .green)
                    .disabled(!approval.capabilities.canApprove)

                Button("Bearbeiten") { showingEditor = true }
                    .frame(maxWidth: .infinity)
                    .disabled(!approval.capabilities.canEdit)

                Button("Ablehnen", role: .destructive) {
                    showingRejectionConfirmation = true
                }
                .frame(maxWidth: .infinity)
                .disabled(!approval.capabilities.canReject)
            } footer: {
                Text(
                    approval.requiresLocalAuthentication(for: .approve)
                        ? "Genehmigen fordert frische Biometrie sowie eine neue Einmal-Nonce an."
                        : "Jede Entscheidung bleibt an Version, Payload, Nonce und Idempotency-Key gebunden."
                )
            }
            .disabled(isWorking || approval.expiresAt <= Date())
        }
        .navigationTitle(approval.title)
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isWorking {
                ProgressView("Sicher prüfen …")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .confirmationDialog(
            "Exakt diese Aktion genehmigen?",
            isPresented: $showingApprovalConfirmation,
            titleVisibility: .visible
        ) {
            Button("Jetzt genehmigen", role: approval.risk == .red ? .destructive : nil) {
                perform(.approve)
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("\(approval.target.displayName) · Version \(approval.recordVersion)")
        }
        .confirmationDialog(
            "Freigabe ablehnen?",
            isPresented: $showingRejectionConfirmation,
            titleVisibility: .visible
        ) {
            Button("Ablehnen", role: .destructive) { perform(.reject) }
            Button("Abbrechen", role: .cancel) {}
        }
        .sheet(isPresented: $showingEditor) {
            ApprovalEditView(store: store, approval: approval) {
                showingEditor = false
                dismiss()
            }
        }
    }

    private func perform(_ decision: ApprovalDecision) {
        Task {
            if await store.decide(approval: approval, decision: decision) != nil {
                dismiss()
            }
        }
    }
}

@MainActor
private struct ApprovalEditView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: BirdieApprovalStore
    let approval: ApprovalItem
    let completed: () -> Void
    @State private var changes: [ApprovalChange]

    init(
        store: BirdieApprovalStore,
        approval: ApprovalItem,
        completed: @escaping () -> Void
    ) {
        self.store = store
        self.approval = approval
        self.completed = completed
        _changes = State(initialValue: approval.changes)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(
                        "Die Bearbeitung führt nichts aus. Sie sendet eine neue Version zur erneuten Prüfung zurück."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                ForEach($changes) { $change in
                    Section(change.field) {
                        if let before = change.before {
                            LabeledContent("Vorher", value: before)
                        }
                        TextField("Neuer Wert", text: $change.proposed, axis: .vertical)
                            .lineLimit(2...8)
                            .privacySensitive()
                    }
                }
            }
            .navigationTitle("Änderung anfordern")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Senden") {
                        Task {
                            if await store.decide(
                                approval: approval,
                                decision: .requestChanges,
                                editedChanges: changes
                            ) != nil {
                                completed()
                            }
                        }
                    }
                    .disabled(changes == approval.changes || store.activeApprovalIDs.contains(approval.id))
                }
            }
        }
    }
}
