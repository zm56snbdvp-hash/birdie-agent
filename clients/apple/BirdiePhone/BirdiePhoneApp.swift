import SwiftUI

@main
struct BirdiePhoneApp: App {
    @UIApplicationDelegateAdaptor(BirdieAppDelegate.self) private var appDelegate

    init() {
        _ = WatchRelay.shared
    }

    var body: some Scene {
        WindowGroup {
            BirdiePhoneRootView()
        }
    }
}
