import SwiftUI

struct BirdieRootView: View {
    private enum Tab: Hashable {
        case dayPilot
        case setup
    }

    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var router = BirdieAppRouter()
    @StateObject private var dayPilot = DayPilotViewModel()
    @State private var selectedTab: Tab = .dayPilot
    @State private var composerRoute: BirdieRoute?
    @State private var highlightedAction: BirdieActionKind?

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

            BirdiePhoneSetupView()
                .tabItem { Label("Setup", systemImage: "gearshape") }
                .tag(Tab.setup)
        }
        .onAppear { router.consumePendingRoute() }
        .onOpenURL { router.handle(url: $0) }
        .onReceive(NotificationCenter.default.publisher(for: BirdiePendingRouteStore.didChangeNotification)) { _ in
            router.consumePendingRoute()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { router.consumePendingRoute() }
        }
        .onChange(of: router.route) { _, route in
            guard let route else { return }
            handle(route)
            router.clear()
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
