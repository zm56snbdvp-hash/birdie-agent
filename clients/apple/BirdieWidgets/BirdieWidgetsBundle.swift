import SwiftUI
import WidgetKit

@main
struct BirdieWidgetsBundle: WidgetBundle {
    var body: some Widget {
        DayPilotWidget()
        AskBirdieControl()
        CaptureThoughtControl()
        BirdieBriefingControl()
        BirdieNextStepControl()
    }
}
