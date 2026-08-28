import Foundation
import SwiftUI

@MainActor
struct LiveMissionView: View {
    @ObservedObject private var store: LiveMissionStore

    init(store: LiveMissionStore) {
        self.store = store
    }

    var body: some View {
        NavigationStack {
            Group {
                if let mission = store.mission {
                    missionContent(mission)
                } else if store.isLoading {
                    ProgressView("Mission wird geladen …")
                } else {
                    ContentUnavailableView(
                        "Keine Live Mission",
                        systemImage: "bird",
                        description: Text("Live Mission ist nur für klar begrenzte laufende Aufträge gedacht.")
                    )
                }
            }
            .navigationTitle("Live Mission")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await reload() }
                    } label: {
                        Label("Neu laden", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isLoading || store.isSubmittingCommand)
                }
            }
        }
        .task {
            await reload(onlyWhenEmpty: true)
        }
        .confirmationDialog(
            confirmationTitle,
            isPresented: pendingCommandBinding,
            titleVisibility: .visible
        ) {
            if let pending = store.pendingCommand {
                Button(
                    confirmationButtonTitle(for: pending.command),
                    role: pending.command == .cancel ? .destructive : nil
                ) {
                    Task { await store.confirmPendingCommand() }
                }
                Button("Nicht ausführen", role: .cancel) {
                    store.dismissPendingCommand()
                }
            }
        } message: {
            Text(confirmationMessage)
        }
        .alert("Live Mission", isPresented: messageBinding) {
            Button("OK") { store.clearMessage() }
        } message: {
            Text(store.message ?? "")
        }
        .tint(BirdieLiveMissionStyle.green)
    }

    private func missionContent(_ mission: LiveMissionRecord) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(for: mission)
                progressCard(for: mission)

                if let blocker = mission.blocker {
                    blockerCard(blocker)
                }

                actionCard(for: mission)

                Label(
                    "Automatisches Ende spätestens \(mission.expiresAt.formatted(date: .omitted, time: .shortened))",
                    systemImage: "timer"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .padding()
        }
        .refreshable {
            await reload()
        }
    }

    private func header(for mission: LiveMissionRecord) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Birdie-Auftrag", systemImage: "bird.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BirdieLiveMissionStyle.green)
                Spacer()
                statusBadge(mission.status)
            }

            Text(mission.title)
                .font(.title2.weight(.bold))
                .privacySensitive()
            Text(mission.scope.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .privacySensitive()
            Text("Grenze: \(mission.scope.boundary)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .privacySensitive()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func progressCard(for mission: LiveMissionRecord) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Fortschritt")
                    .font(.headline)
                Spacer()
                Text(mission.progress, format: .percent.precision(.fractionLength(0)))
                    .font(.title3.monospacedDigit().weight(.semibold))
            }

            ProgressView(value: mission.progress)
                .tint(BirdieLiveMissionStyle.green)
                .accessibilityLabel("Missionsfortschritt")

            Divider()

            VStack(alignment: .leading, spacing: 5) {
                Text("Schritt \(mission.currentStep.index) von \(mission.currentStep.total)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(mission.currentStep.title)
                    .font(.body.weight(.medium))
                    .privacySensitive()
                if let detail = mission.currentStep.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .privacySensitive()
                }
            }
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func blockerCard(_ blocker: LiveMissionBlocker) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Mission wartet", systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(.orange)
            Text("Ein Blocker muss in Birdie geklärt werden.")
                .font(.subheadline)
            Text(blocker.message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .privacySensitive()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func actionCard(for mission: LiveMissionRecord) -> some View {
        VStack(spacing: 12) {
            if mission.isEligibleForLiveActivity(), !store.isLiveActivityActive {
                Button {
                    store.startLiveActivity()
                } label: {
                    Label("Auf Sperrbildschirm starten", systemImage: "lock.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            } else if store.isLiveActivityActive {
                Label("Auf dem Sperrbildschirm aktiv", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BirdieLiveMissionStyle.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if mission.status == .running, mission.allowsPause {
                Button {
                    store.prepare(command: .pause)
                } label: {
                    Label("Mission pausieren", systemImage: "pause.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else if mission.status == .paused {
                Button {
                    store.prepare(command: .resume)
                } label: {
                    Label("Mission fortsetzen", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            if mission.allowsCancel, !mission.status.isTerminal {
                Button(role: .destructive) {
                    store.prepare(command: .cancel)
                } label: {
                    Label("Mission abbrechen", systemImage: "xmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .disabled(store.isSubmittingCommand)
    }

    private func statusBadge(_ status: LiveMissionStatus) -> some View {
        Text(statusLabel(status))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(statusColor(status).opacity(0.15), in: Capsule())
            .foregroundStyle(statusColor(status))
    }

    private var pendingCommandBinding: Binding<Bool> {
        Binding(
            get: { store.pendingCommand != nil },
            // A system-driven dialog dismissal must never discard the exact
            // idempotency key after a possible response loss. Only the explicit
            // cancel button or a validated server response clears it.
            set: { _ in }
        )
    }

    private var messageBinding: Binding<Bool> {
        Binding(
            get: { store.message != nil },
            set: { isPresented in
                if !isPresented { store.clearMessage() }
            }
        )
    }

    private var confirmationTitle: String {
        guard let command = store.pendingCommand?.command else { return "Aktion bestätigen" }
        return switch command {
        case .pause:
            "Mission wirklich pausieren?"
        case .resume:
            "Mission wirklich fortsetzen?"
        case .cancel:
            "Mission wirklich abbrechen?"
        }
    }

    private var confirmationMessage: String {
        guard let command = store.pendingCommand?.command else { return "" }
        return switch command {
        case .pause:
            "Birdie stoppt nach dem aktuellen sicheren Übergang."
        case .resume:
            "Birdie setzt den klar begrenzten Auftrag fort."
        case .cancel:
            "Der laufende Auftrag wird beendet. Diese Aktion wird erst nach deiner Bestätigung gesendet."
        }
    }

    private func confirmationButtonTitle(for command: LiveMissionCommand) -> String {
        switch command {
        case .pause:
            "Jetzt pausieren"
        case .resume:
            "Jetzt fortsetzen"
        case .cancel:
            "Auftrag abbrechen"
        }
    }

    private func reload(onlyWhenEmpty: Bool = false) async {
        if !onlyWhenEmpty || store.mission == nil {
            await store.load()
        }
    }

    private func statusLabel(_ status: LiveMissionStatus) -> String {
        switch status {
        case .queued: "Geplant"
        case .running: "Läuft"
        case .paused: "Pausiert"
        case .blocked: "Blockiert"
        case .succeeded: "Erledigt"
        case .failed: "Fehlgeschlagen"
        case .cancelled: "Abgebrochen"
        case .expired: "Abgelaufen"
        }
    }

    private func statusColor(_ status: LiveMissionStatus) -> Color {
        switch status {
        case .running, .succeeded:
            BirdieLiveMissionStyle.green
        case .paused, .queued:
            .secondary
        case .blocked:
            .orange
        case .failed, .cancelled, .expired:
            .red
        }
    }
}

private enum BirdieLiveMissionStyle {
    static let green = Color(red: 0.035, green: 0.245, blue: 0.155)
}
