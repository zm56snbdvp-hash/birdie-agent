import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

struct BirdieLiveMissionWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BirdieLiveMissionAttributes.self) { context in
            BirdieLiveMissionLockScreenView(context: context)
                .activityBackgroundTint(BirdieLiveActivityStyle.background)
                .activitySystemActionForegroundColor(BirdieLiveActivityStyle.green)
                .widgetURL(openURL(for: context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Birdie", systemImage: "bird.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BirdieLiveActivityStyle.green)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    if context.isStale {
                        Image(systemName: "clock.badge.exclamationmark")
                            .foregroundStyle(.orange)
                    } else {
                        Text(context.state.progress, format: .percent.precision(.fractionLength(0)))
                            .font(.caption.monospacedDigit().weight(.semibold))
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    if context.isStale {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Status nicht mehr aktuell")
                                .font(.caption.weight(.semibold))
                            Text("Auftrag darf nicht weiterlaufen")
                                .font(.caption2)
                        }
                        .foregroundStyle(.orange)
                    } else {
                        HStack(spacing: 10) {
                            Image(systemName: statusSymbol(context.state.status))
                                .foregroundStyle(statusColor(context.state.status))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(statusLabel(context.state.status))
                                    .font(.caption.weight(.semibold))
                                Text(context.state.currentStepTitle.rawValue)
                                    .font(.caption2)
                                    .lineLimit(1)
                                    .privacySensitive(context.state.containsSensitiveDetails)
                            }
                            Spacer()
                            ProgressView(value: context.state.progress)
                                .frame(width: 72)
                                .tint(BirdieLiveActivityStyle.green)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "bird.fill")
                    .foregroundStyle(BirdieLiveActivityStyle.green)
            } compactTrailing: {
                if context.isStale {
                    Image(systemName: "clock.badge.exclamationmark")
                        .foregroundStyle(.orange)
                } else {
                    Text(context.state.progress, format: .percent.precision(.fractionLength(0)))
                        .font(.caption2.monospacedDigit().weight(.bold))
                }
            } minimal: {
                Image(
                    systemName: context.isStale
                        ? "clock.badge.exclamationmark"
                        : statusSymbol(context.state.status)
                )
                .foregroundStyle(
                    context.isStale ? Color.orange : statusColor(context.state.status)
                )
            }
            .keylineTint(BirdieLiveActivityStyle.gold)
            .widgetURL(openURL(for: context))
        }
    }

    private func openURL(
        for context: ActivityViewContext<BirdieLiveMissionAttributes>
    ) -> URL? {
        BirdieLiveMissionDeepLink(
            missionID: context.attributes.missionID,
            intent: .open
        ).url
    }

    private func statusLabel(_ status: BirdieLiveMissionAttributes.Status) -> String {
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

    private func statusSymbol(_ status: BirdieLiveMissionAttributes.Status) -> String {
        switch status {
        case .queued: "clock"
        case .running: "arrow.triangle.2.circlepath"
        case .paused: "pause.circle.fill"
        case .blocked: "exclamationmark.triangle.fill"
        case .succeeded: "checkmark.circle.fill"
        case .failed: "exclamationmark.circle.fill"
        case .cancelled: "xmark.circle.fill"
        case .expired: "timer"
        }
    }

    private func statusColor(_ status: BirdieLiveMissionAttributes.Status) -> Color {
        switch status {
        case .running, .succeeded:
            BirdieLiveActivityStyle.green
        case .queued, .paused:
            .secondary
        case .blocked:
            .orange
        case .failed, .cancelled, .expired:
            .red
        }
    }
}

private struct BirdieLiveMissionLockScreenView: View {
    let context: ActivityViewContext<BirdieLiveMissionAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("Birdie · Live Mission", systemImage: "bird.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BirdieLiveActivityStyle.green)
                Spacer()
                if context.isStale {
                    Text("Zeitfenster beendet")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                } else {
                    Text(context.attributes.hardEndAt, style: .timer)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Verbleibende Laufzeit")
                }
            }

            if context.isStale {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Status nicht mehr aktuell", systemImage: "clock.badge.exclamationmark")
                        .font(.headline)
                    Text("Der Auftrag darf auf Basis dieses alten Stands nicht weiterlaufen. Öffne Birdie zur Prüfung.")
                        .font(.caption)
                }
                .foregroundStyle(.orange)
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 12)
                    Text(context.state.progress, format: .percent.precision(.fractionLength(0)))
                        .font(.headline.monospacedDigit())
                }

                ProgressView(value: context.state.progress)
                    .tint(BirdieLiveActivityStyle.green)

                HStack(spacing: 8) {
                    Image(systemName: "list.number")
                        .foregroundStyle(.secondary)
                    Text("Schritt \(context.state.currentStepIndex) von \(context.state.currentStepTotal)")
                        .font(.caption.weight(.semibold))
                    Text(context.state.currentStepTitle.rawValue)
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
                }

                if let blockerCategory = context.state.blockerCategory {
                    Label(blockerLabel(blockerCategory), systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                }

                if context.state.allowsPause || context.state.allowsCancel {
                    HStack(spacing: 10) {
                        if context.state.allowsPause, let pauseURL {
                            Link(destination: pauseURL) {
                                Label("Pause prüfen", systemImage: "pause.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .tint(BirdieLiveActivityStyle.green)
                            .accessibilityHint("Öffnet Birdie zur Bestätigung")
                        }

                        if context.state.allowsCancel, let cancelURL {
                            Link(destination: cancelURL) {
                                Label("Abbruch prüfen", systemImage: "xmark")
                                    .frame(maxWidth: .infinity)
                            }
                            .tint(.red)
                            .accessibilityHint("Öffnet Birdie zur Bestätigung")
                        }
                    }
                    .buttonStyle(.bordered)
                    .font(.caption.weight(.semibold))
                }
            }
        }
        .padding(14)
    }

    private var pauseURL: URL? {
        BirdieLiveMissionDeepLink(
            missionID: context.attributes.missionID,
            intent: .pause
        ).url
    }

    private var cancelURL: URL? {
        BirdieLiveMissionDeepLink(
            missionID: context.attributes.missionID,
            intent: .cancel
        ).url
    }

    private func blockerLabel(_ blocker: BirdieLiveMissionAttributes.BlockerCategory) -> String {
        switch blocker {
        case .approvalRequired:
            "Wartet auf Freigabe in Birdie"
        case .connectivity:
            "Wartet auf Verbindung"
        case .dependency:
            "Wartet auf einen vorherigen Schritt"
        case .policy:
            "Wartet auf eine Sicherheitsprüfung"
        case .unknown:
            "Wartet auf Klärung in Birdie"
        }
    }
}

private enum BirdieLiveActivityStyle {
    static let green = Color(red: 0.035, green: 0.245, blue: 0.155)
    static let gold = Color(red: 0.84, green: 0.69, blue: 0.31)
    static let background = Color(red: 0.96, green: 0.98, blue: 0.97)
}
