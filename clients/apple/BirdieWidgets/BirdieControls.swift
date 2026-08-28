import SwiftUI
import WidgetKit

struct AskBirdieControl: ControlWidget {
    static let kind = "de.birdieandbreakfast.birdie.control.ask"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenBirdieActionIntent(.ask)) {
                Label("Birdie fragen", systemImage: "bubble.left.and.text.bubble.right")
            }
        }
        .displayName("Birdie fragen")
        .description("Öffnet eine sichere Fragevorschau in Birdie.")
    }
}

struct CaptureThoughtControl: ControlWidget {
    static let kind = "de.birdieandbreakfast.birdie.control.capture-thought"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenBirdieActionIntent(.captureThought)) {
                Label("Gedanke merken", systemImage: "square.and.pencil")
            }
        }
        .displayName("Gedanke merken")
        .description("Öffnet einen Entwurf; speichert erst nach Bestätigung.")
    }
}

struct BirdieBriefingControl: ControlWidget {
    static let kind = "de.birdieandbreakfast.birdie.control.briefing"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenBirdieActionIntent(.briefing)) {
                Label("Briefing", systemImage: "sun.horizon")
            }
        }
        .displayName("Birdie Briefing")
        .description("Öffnet das schreibgeschützte Day-Pilot-Briefing.")
    }
}

struct BirdieNextStepControl: ControlWidget {
    static let kind = "de.birdieandbreakfast.birdie.control.next-step"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenBirdieActionIntent(.nextStep)) {
                Label("Nächster Schritt", systemImage: "arrow.forward.circle")
            }
        }
        .displayName("Nächster Schritt")
        .description("Öffnet den nächsten sichtbaren Schritt im Day Pilot.")
    }
}
