import AppIntents
import SwiftUI

@main
struct BirdiePhoneApp: App {
    init() {
        _ = WatchRelay.shared
        BirdieAppShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            BirdieRootView()
        }
    }
}
