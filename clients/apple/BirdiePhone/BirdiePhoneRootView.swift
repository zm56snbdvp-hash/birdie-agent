import SwiftUI

struct BirdiePhoneRootView: View {
    private enum Tab: Hashable {
        case drop
        case lens
        case watch
    }

    @StateObject private var captureModel = CaptureAppModel()
    @State private var selectedTab: Tab = .drop
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $selectedTab) {
            CaptureInboxView(model: captureModel)
                .tabItem { Label("Drop", systemImage: "tray.and.arrow.down") }
                .tag(Tab.drop)

            BirdieLensView(appModel: captureModel) {
                selectedTab = .drop
            }
            .tabItem { Label("Lens", systemImage: "viewfinder") }
            .tag(Tab.lens)

            BirdiePhoneSetupView()
                .tabItem { Label("Watch", systemImage: "applewatch") }
                .tag(Tab.watch)
        }
        .onAppear {
            captureModel.setSceneActive(scenePhase == .active)
        }
        .onChange(of: scenePhase) { _, phase in
            captureModel.setSceneActive(phase == .active)
        }
        .onOpenURL { url in
            if captureModel.handle(deepLink: url) {
                selectedTab = .drop
            }
        }
        .overlay {
            if captureModel.isPrivacyProtected {
                LockedCaptureCover()
            }
        }
    }
}
