import SwiftUI
import UIKit

private enum BirdieRootTab: Hashable {
    case approvals
    case missions
    case device
}

@MainActor
struct BirdiePhoneRootView: View {
    @StateObject private var approvalStore = BirdieApprovalStore()
    @StateObject private var missionStore = LiveMissionStore()
    @State private var selectedTab: BirdieRootTab = .approvals
    @State private var requestedApprovalID: String?

    var body: some View {
        TabView(selection: $selectedTab) {
            BirdieApproveView(
                store: approvalStore,
                requestedApprovalID: $requestedApprovalID
            )
            .tabItem { Label("Approve", systemImage: "checkmark.shield") }
            .tag(BirdieRootTab.approvals)

            LiveMissionView(store: missionStore)
                .tabItem { Label("Mission", systemImage: "waveform.path.ecg") }
                .tag(BirdieRootTab.missions)

            BirdiePhoneSetupView()
                .tabItem { Label("Gerät", systemImage: "iphone.and.arrow.forward") }
                .tag(BirdieRootTab.device)
        }
        .onReceive(NotificationCenter.default.publisher(for: .birdieOpenApprovals)) {
            notification in
            openApproval(from: notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: .birdieReviewApprovalRejection)) {
            notification in
            openApproval(from: notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: .birdieOpenMissions)) { notification in
            openMission(from: notification, shouldPause: false)
        }
        .onReceive(NotificationCenter.default.publisher(for: .birdieReviewMissionPause)) { notification in
            openMission(from: notification, shouldPause: true)
        }
        .onOpenURL { url in
            if let approvalLink = BirdieApprovalDeepLink(url: url) {
                selectedTab = .approvals
                requestedApprovalID = approvalLink.approvalID
            } else if BirdieLiveMissionDeepLink(url: url) != nil {
                Task { await openMission(url: url) }
            }
        }
        .task {
            if let approvalID = BirdieNotificationManager.shared.consumePendingApprovalID() {
                selectedTab = .approvals
                requestedApprovalID = approvalID
            }
            if let review = BirdieNotificationManager.shared.consumePendingMissionReview() {
                await openMission(
                    missionID: review.missionID,
                    shouldPause: review.shouldPause
                )
            }
        }
    }

    private func openApproval(from notification: Notification) {
        _ = BirdieNotificationManager.shared.consumePendingApprovalID()
        selectedTab = .approvals
        requestedApprovalID = notification.userInfo?["opaqueId"] as? String
    }

    private func openMission(from notification: Notification, shouldPause: Bool) {
        _ = BirdieNotificationManager.shared.consumePendingMissionReview()
        guard let missionID = notification.userInfo?["opaqueId"] as? String else {
            selectedTab = .missions
            return
        }
        Task { await openMission(missionID: missionID, shouldPause: shouldPause) }
    }

    private func openMission(missionID: String, shouldPause: Bool) async {
        let intent: BirdieLiveMissionDeepLinkIntent = shouldPause ? .pause : .open
        guard let url = BirdieLiveMissionDeepLink(missionID: missionID, intent: intent).url else {
            return
        }
        await openMission(url: url)
    }

    /// Root is the single deep-link owner. The child view never receives the
    /// same URL a second time, so pause/cancel intents cannot be duplicated.
    private func openMission(url: URL) async {
        selectedTab = .missions
        if missionStore.mission == nil { await missionStore.load() }
        missionStore.handle(
            deepLink: url,
            applicationIsActive: UIApplication.shared.applicationState == .active
        )
    }
}
