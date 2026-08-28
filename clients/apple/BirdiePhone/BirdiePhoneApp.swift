import SwiftUI

@main
@MainActor
struct BirdiePhoneApp: App {
    @StateObject private var recall = RecallViewModel()

    init() {
        _ = WatchRelay.shared
    }

    var body: some Scene {
        WindowGroup {
            BirdiePhoneRootView()
                .environmentObject(recall)
        }
    }
}
