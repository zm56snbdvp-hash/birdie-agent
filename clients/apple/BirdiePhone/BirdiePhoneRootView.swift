import CoreSpotlight
import SwiftUI
import UniformTypeIdentifiers

struct BirdiePhoneRootView: View {
    private enum Tab: Hashable {
        case recall
        case drop
        case lens
        case watch
    }

    @EnvironmentObject private var recall: RecallViewModel
    @StateObject private var captureModel = CaptureAppModel()
    @State private var selectedTab: Tab = .recall
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $selectedTab) {
            RecallHomeView()
                .tabItem { Label("Recall", systemImage: "sparkle.magnifyingglass") }
                .tag(Tab.recall)

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
        .tint(BirdieRecallStyle.green)
        .task { await recall.start() }
        .onAppear {
            captureModel.setSceneActive(scenePhase == .active)
        }
        .onChange(of: scenePhase) { _, phase in
            captureModel.setSceneActive(phase == .active)
            if phase == .active {
                Task { await recall.start() }
            } else if phase == .background {
                recall.lockForBackground()
            }
        }
        .onOpenURL { url in
            if captureModel.handle(deepLink: url) {
                selectedTab = .drop
            } else {
                Task { await recall.openDeepLink(url) }
            }
        }
        .onContinueUserActivity(CSSearchableItemActionType) { activity in
            guard let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else {
                return
            }
            Task { await recall.openSpotlightIdentifier(identifier) }
        }
        .alert(
            "Birdie Recall",
            isPresented: Binding(
                get: { recall.errorMessage != nil },
                set: { if !$0 { recall.errorMessage = nil } }
            )
        ) {
            Button("OK") { recall.errorMessage = nil }
        } message: {
            Text(recall.errorMessage ?? "Unbekannter Fehler")
        }
        .fileExporter(
            isPresented: $recall.isExporting,
            document: recall.exportDocument,
            contentType: .json,
            defaultFilename: "birdie-recall-export"
        ) { result in
            if case .failure(let error) = result { recall.errorMessage = error.localizedDescription }
            recall.exportDocument = nil
        }
        .overlay {
            if captureModel.isPrivacyProtected {
                LockedCaptureCover()
            }
        }
    }
}

enum BirdieRecallStyle {
    static let green = Color(red: 0.035, green: 0.245, blue: 0.155)
    static let gold = Color(red: 0.84, green: 0.69, blue: 0.31)
}
