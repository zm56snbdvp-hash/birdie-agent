import SwiftUI
import WidgetKit

struct BirdieEntry: TimelineEntry {
    let date: Date
}

struct BirdieProvider: TimelineProvider {
    func placeholder(in context: Context) -> BirdieEntry {
        BirdieEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (BirdieEntry) -> Void) {
        completion(BirdieEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BirdieEntry>) -> Void) {
        completion(Timeline(entries: [BirdieEntry(date: .now)], policy: .never))
    }
}

struct BirdieComplicationView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Text("🐦")
                    .font(.title2)
                    .widgetAccentable()
            }
        case .accessoryRectangular:
            HStack(spacing: 6) {
                Text("🐦")
                    .font(.title3)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Birdie")
                        .font(.headline)
                    Text("Antippen & sprechen")
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
        case .accessoryInline:
            Text("🐦 Birdie")
        default:
            Text("🐦")
        }
    }
}

@main
struct BirdieWatchWidget: Widget {
    let kind = "BirdieWatchComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BirdieProvider()) { _ in
            BirdieComplicationView()
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Birdie")
        .description("Sprich direkt mit Birdie von deinem Watchface.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}
