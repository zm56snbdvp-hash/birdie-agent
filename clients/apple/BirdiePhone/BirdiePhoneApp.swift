import SwiftUI

@main
struct BirdiePhoneApp: App {
    init() {
        _ = WatchRelay.shared
    }

    var body: some Scene {
        WindowGroup {
            BirdiePhoneRootView()
        }
    }
}
