import AppIntents
import SwiftUI
import WidgetKit

struct DayPilotConfigurationIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Day Pilot konfigurieren"
    static let description = IntentDescription(
        "Wählt nur das Anzeigeprofil. Der Kontext erteilt keine Berechtigungen."
    )

    @Parameter(title: "Anzeigeprofil", default: .work)
    var focus: BirdieFocusContext

    init() {
        focus = .work
    }
}

struct DayPilotEntry: TimelineEntry {
    let date: Date
    let snapshot: DayPilotSnapshot
    let focus: BirdieFocusContext
}

struct DayPilotProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DayPilotEntry {
        DayPilotEntry(
            date: .now,
            snapshot: .placeholder(),
            focus: .work
        )
    }

    func snapshot(
        for configuration: DayPilotConfigurationIntent,
        in context: Context
    ) async -> DayPilotEntry {
        entry(for: configuration)
    }

    func timeline(
        for configuration: DayPilotConfigurationIntent,
        in context: Context
    ) async -> Timeline<DayPilotEntry> {
        let current = entry(for: configuration)
        let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: current.date)
            ?? current.date.addingTimeInterval(900)
        return Timeline(entries: [current], policy: .after(refresh))
    }

    private func entry(for configuration: DayPilotConfigurationIntent) -> DayPilotEntry {
        let snapshot = DayPilotSnapshotStore.shared.load().displayed(for: configuration.focus)
        return DayPilotEntry(date: .now, snapshot: snapshot, focus: configuration.focus)
    }
}

struct DayPilotWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.redactionReasons) private var redactionReasons

    let entry: DayPilotEntry

    var body: some View {
        Group {
            if redactionReasons.contains(.privacy) {
                lockedContent
            } else {
                content
            }
        }
        .containerBackground(background, for: .widget)
        .widgetURL(
            BirdieRoute(action: .briefing, source: .widget, focus: entry.focus).url
        )
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    Image(systemName: entry.focus.systemImageName)
                    Text("\(entry.snapshot.openReminderCount)")
                        .font(.headline)
                }
            }
            .privacySensitive()

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("Day Pilot", systemImage: entry.focus.systemImageName)
                    .font(.headline)
                Text(primaryTitle)
                    .font(.caption)
                    .lineLimit(2)
                    .privacySensitive()
            }

        case .accessoryInline:
            Text("Day Pilot · \(primaryTitle)")
                .privacySensitive()

        case .systemMedium:
            HStack(alignment: .top, spacing: 14) {
                header
                Divider()
                VStack(alignment: .leading, spacing: 7) {
                    detailRow("checkmark.circle", entry.snapshot.nextTask?.title ?? "Keine Aufgabe")
                    detailRow("calendar", entry.snapshot.nextEvent?.title ?? "Kein Termin")
                    detailRow("checkmark.shield", "\(entry.snapshot.openApprovalCount) Freigaben")
                }
                .privacySensitive()
            }

        default:
            VStack(alignment: .leading, spacing: 8) {
                header
                Text(primaryTitle)
                    .font(.headline)
                    .lineLimit(3)
                    .privacySensitive()
                Spacer(minLength: 0)
                HStack {
                    Label("\(entry.snapshot.openReminderCount)", systemImage: "checklist")
                    Spacer()
                    Label("\(entry.snapshot.openApprovalCount)", systemImage: "checkmark.shield")
                }
                .font(.caption)
                .privacySensitive()
            }
        }
    }

    private var lockedContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Day Pilot", systemImage: "bird")
                .font(.headline)
            Text("Entsperren, um persönliche Details zu sehen.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Day Pilot", systemImage: entry.focus.systemImageName)
                .font(.headline)
            Text(entry.focus.title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var primaryTitle: String {
        switch entry.focus {
        case .work:
            entry.snapshot.nextTask?.title
                ?? entry.snapshot.nextEvent?.title
                ?? "Alles ruhig"
        case .personal:
            entry.snapshot.nextEvent?.title
                ?? entry.snapshot.nextTask?.title
                ?? "Privat ist alles ruhig"
        case .rest:
            "Ruhemodus – Details zurückgehalten"
        }
    }

    private func detailRow(_ icon: String, _ text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption)
            .lineLimit(1)
    }

    private var background: some ShapeStyle {
        switch entry.focus {
        case .work: Color.green.gradient
        case .personal: Color.indigo.gradient
        case .rest: Color.purple.gradient
        }
    }
}

struct DayPilotWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: DayPilotWidgetContract.kind,
            intent: DayPilotConfigurationIntent.self,
            provider: DayPilotProvider()
        ) { entry in
            DayPilotWidgetView(entry: entry)
        }
        .configurationDisplayName("Day Pilot")
        .description("Nächster Schritt, Termin, Erinnerungen und Freigaben auf einen Blick.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}
