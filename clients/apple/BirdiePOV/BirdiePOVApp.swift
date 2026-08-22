import MWDATCore
import SwiftUI

@main
struct BirdiePOVApp: App {
    @StateObject private var controller = POVController()

    init() {
        do {
            try Wearables.configure()
        } catch {
            NSLog("[BirdiePOV] Wearables.configure failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            POVView(controller: controller)
                .onOpenURL { url in
                    Task {
                        _ = try? await Wearables.shared.handleUrl(url)
                    }
                }
        }
    }
}
