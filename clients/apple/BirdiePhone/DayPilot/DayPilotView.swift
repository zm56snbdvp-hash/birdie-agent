import SwiftUI

struct DayPilotView: View {
    @ObservedObject var model: DayPilotViewModel
    @ObservedObject var router: BirdieAppRouter
    @Binding var highlightedAction: BirdieActionKind?

    @AppStorage(BirdieFocusStore.key, store: BirdieSharedContainer.defaults)
    private var focusRawValue = BirdieFocusContext.work.rawValue

    @State private var showingProposal = false

    private var focus: BirdieFocusContext {
        get { BirdieFocusContext(rawValue: focusRawValue) ?? .work }
        nonmutating set { focusRawValue = newValue.rawValue }
    }

    private var displayedSnapshot: DayPilotSnapshot {
        model.snapshot.displayed(for: focus)
    }

    var body: some View {
        List {
            Section {
                BirdieButtonView(router: router)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text("Birdie Button")
            }

            Section("Anzeigeprofil") {
                Picker("Kontext", selection: Binding(get: { focus }, set: { focus = $0 })) {
                    ForEach(BirdieFocusContext.allCases, id: \.self) { context in
                        Label(context.title, systemImage: context.systemImageName).tag(context)
                    }
                }
                .pickerStyle(.segmented)

                Label(
                    "Focus steuert nur die Darstellung – niemals Berechtigungen oder Freigaben.",
                    systemImage: "lock.shield"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let highlightedAction {
                Section {
                    Label(
                        highlightedAction == .briefing
                            ? "Über das Briefing geöffnet"
                            : "Über Nächster Schritt geöffnet",
                        systemImage: "sparkles"
                    )
                    .foregroundStyle(.tint)
                    Button("Hinweis ausblenden") { self.highlightedAction = nil }
                        .font(.caption)
                }
            }

            Section("Morgendliches Briefing") {
                Text(displayedSnapshot.briefing)
                    .privacySensitive()
                Text("Aktualisiert \(displayedSnapshot.generatedAt, format: .relative(presentation: .named))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Nächster Schritt") {
                if let task = displayedSnapshot.nextTask {
                    DayPilotItemRow(item: task, fallbackIcon: "checkmark.circle")
                        .privacySensitive()
                } else {
                    Label("Keine offene Erinnerung sichtbar", systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Kalender") {
                if let event = displayedSnapshot.nextEvent {
                    DayPilotItemRow(item: event, fallbackIcon: "calendar")
                        .privacySensitive()
                } else {
                    Label("Kein nächster Termin sichtbar", systemImage: "calendar")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Erinnerungen") {
                LabeledContent("Offen", value: "\(displayedSnapshot.openReminderCount)")
                if model.reminderAccess != .granted {
                    Text("Erinnerungen sind nicht verbunden.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Offene Freigaben") {
                if let approval = displayedSnapshot.nextApproval {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(approval.title).font(.headline)
                        Text(approval.detail).font(.caption).foregroundStyle(.secondary)
                    }
                    .privacySensitive()
                } else {
                    LabeledContent("Offen", value: "\(displayedSnapshot.openApprovalCount)")
                    Text("Ein strukturierter mobiler Freigaben-Provider ist noch nicht verbunden.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Datenzugriff") {
                accessRow(
                    title: "Kalender",
                    icon: "calendar",
                    state: model.calendarAccess,
                    request: model.requestCalendarAccess
                )
                accessRow(
                    title: "Erinnerungen",
                    icon: "checklist",
                    state: model.reminderAccess,
                    request: model.requestReminderAccess
                )
            }

            Section {
                Button("Termin oder Erinnerung vorschlagen") {
                    showingProposal = true
                }
            } header: {
                Text("Bestätigte Änderungen")
            } footer: {
                Text("Jede Änderung erhält zuerst eine Vorschau und danach eine separate Bestätigung.")
            }

            if let statusMessage = model.statusMessage {
                Section("Status") {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Day Pilot")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if model.isRefreshing {
                    ProgressView()
                } else {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Day Pilot aktualisieren")
                }
            }
        }
        .task { await model.refresh() }
        .refreshable { await model.refresh() }
        .sheet(isPresented: $showingProposal) {
            DayPilotProposalView(model: model)
        }
        .tint(tintColor)
    }

    @ViewBuilder
    private func accessRow(
        title: String,
        icon: String,
        state: DayPilotAccessState,
        request: @escaping @MainActor () async -> Void
    ) -> some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer()
            if state == .notDetermined || state == .writeOnly {
                if state == .writeOnly {
                    Text(state.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button(state == .writeOnly ? "Lesen erlauben" : "Freigeben") {
                    Task { await request() }
                }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            } else {
                Text(state.title)
                    .font(.caption)
                    .foregroundStyle(state == .granted ? Color.green : Color.secondary)
            }
        }
    }

    private var tintColor: Color {
        switch focus {
        case .work: Color(red: 0.035, green: 0.245, blue: 0.155)
        case .personal: .indigo
        case .rest: .purple
        }
    }
}

private struct DayPilotItemRow: View {
    let item: DayPilotItem
    let fallbackIcon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: fallbackIcon)
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)
                if let date = item.date {
                    Text(date, format: .dateTime.weekday().hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
