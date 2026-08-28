import SwiftUI

struct BirdiePhoneRootView: View {
    private enum Tab: Hashable {
        case dayPilot
        case drop
        case lens
        case watch
    }

    @StateObject private var captureModel = CaptureAppModel()
    @StateObject private var router = BirdieAppRouter()
    @StateObject private var dayPilot = DayPilotViewModel(
        remoteProvider: DayPilotAgentProvider()
    )
    @State private var selectedTab: Tab = .dayPilot
    @State private var composerRoute: BirdieRoute?
    @State private var highlightedAction: BirdieActionKind?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                DayPilotView(
                    model: dayPilot,
                    router: router,
                    highlightedAction: $highlightedAction
                )
            }
            .tabItem { Label("Day Pilot", systemImage: "sun.horizon") }
            .tag(Tab.dayPilot)

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
            router.consumePendingRoute()
        }
        .onChange(of: scenePhase) { _, phase in
            captureModel.setSceneActive(phase == .active)
            if phase == .active {
                router.consumePendingRoute()
            }
        }
        .onOpenURL { url in
            if captureModel.handle(deepLink: url) {
                selectedTab = .drop
            } else {
                router.handle(url: url)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: BirdiePendingRouteStore.didChangeNotification)) { _ in
            router.consumePendingRoute()
        }
        .onChange(of: captureModel.navigationPath) { _, path in
            if !path.isEmpty {
                selectedTab = .drop
            }
        }
        .onChange(of: router.route) { _, route in
            guard let route else { return }
            handle(route)
            router.clear()
        }
        .overlay {
            if captureModel.isPrivacyProtected {
                LockedCaptureCover()
            }
        }
        .sheet(item: $composerRoute) { route in
            BirdieActionComposerView(route: route)
        }
    }

    private func handle(_ route: BirdieRoute) {
        if let focus = route.focus {
            BirdieFocusStore.current = focus
        }
        switch route.action {
        case .ask, .captureThought:
            composerRoute = route
        case .briefing, .nextStep:
            selectedTab = .dayPilot
            highlightedAction = route.action
            Task { await dayPilot.refresh() }
        }
    }
}
