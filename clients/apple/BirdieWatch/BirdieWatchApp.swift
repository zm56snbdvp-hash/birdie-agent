import SwiftUI

@main
struct BirdieWatchApp: App {
    @StateObject private var model = BirdieWatchModel()

    var body: some Scene {
        WindowGroup {
            BirdieWatchView()
                .environmentObject(model)
        }
    }
}
