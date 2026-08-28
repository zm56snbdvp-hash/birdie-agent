import Foundation
import UIKit
import UserNotifications

enum BirdieNotificationContract {
    static let approvalSafeCategory = "BIRDIE_APPROVAL_SAFE_V1"
    static let approvalRedCategory = "BIRDIE_APPROVAL_RED_V1"
    static let missionCategory = "BIRDIE_MISSION_CONTROLS_V1"

    static let open = "BIRDIE_OPEN_V1"
    static let remindLater = "BIRDIE_REMIND_LATER_V1"
    static let reviewRejection = "BIRDIE_REVIEW_REJECTION_V1"
    static let reviewPause = "BIRDIE_REVIEW_PAUSE_V1"

    static let schemaVersionKey = "schemaVersion"
    static let approvalIDKey = "approvalId"
    static let missionIDKey = "missionId"
    static let redactedSchemaVersion = "birdie.trust.notification/v1"
}

extension Notification.Name {
    static let birdieOpenApprovals = Notification.Name("birdie.open-approvals")
    static let birdieReviewApprovalRejection = Notification.Name("birdie.review-approval-rejection")
    static let birdieOpenMissions = Notification.Name("birdie.open-missions")
    static let birdieReviewMissionPause = Notification.Name("birdie.review-mission-pause")
}

final class BirdieNotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = BirdieNotificationManager()

    private static let pendingApprovalKey = "birdie.notification.pending-approval-v1"
    private static let pendingMissionKey = "birdie.notification.pending-mission-v1"
    private static let pendingMissionIntentKey = "birdie.notification.pending-mission-intent-v1"

    private override init() {
        super.init()
    }

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(Self.categories())
    }

    func requestAuthorization() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        )
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func consumePendingApprovalID() -> String? {
        let defaults = UserDefaults.standard
        defer { defaults.removeObject(forKey: Self.pendingApprovalKey) }
        return Self.validIdentifier(defaults.string(forKey: Self.pendingApprovalKey))
    }

    func consumePendingMissionReview() -> (missionID: String, shouldPause: Bool)? {
        let defaults = UserDefaults.standard
        defer {
            defaults.removeObject(forKey: Self.pendingMissionKey)
            defaults.removeObject(forKey: Self.pendingMissionIntentKey)
        }
        guard let missionID = Self.validIdentifier(defaults.string(forKey: Self.pendingMissionKey)) else {
            return nil
        }
        return (
            missionID,
            defaults.string(forKey: Self.pendingMissionIntentKey) == "pause"
        )
    }

    func scheduleRedactedApprovalReminder(approvalID: String, after delay: TimeInterval = 900) async throws {
        guard Self.isOpaqueIdentifier(approvalID) else {
            throw BirdieTrustError.invalidContract("Ungültige Approval-ID in Notification.")
        }
        let content = UNMutableNotificationContent()
        content.title = "Birdie-Aktion wartet"
        content.body = "Details nach dem Entsperren in Birdie Approve prüfen."
        content.categoryIdentifier = BirdieNotificationContract.approvalSafeCategory
        content.userInfo = [
            BirdieNotificationContract.schemaVersionKey:
                BirdieNotificationContract.redactedSchemaVersion,
            BirdieNotificationContract.approvalIDKey: approvalID
        ]
        let request = UNNotificationRequest(
            identifier: "approval-reminder-\(approvalID)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: max(delay, 60),
                repeats: false
            )
        )
        try await UNUserNotificationCenter.current().add(request)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard userInfo[BirdieNotificationContract.schemaVersionKey] as? String
                == BirdieNotificationContract.redactedSchemaVersion
        else { return }

        switch response.actionIdentifier {
        case BirdieNotificationContract.remindLater:
            if let approvalID = Self.validIdentifier(
                userInfo[BirdieNotificationContract.approvalIDKey]
            ) {
                try? await scheduleRedactedApprovalReminder(approvalID: approvalID)
            }
        case BirdieNotificationContract.reviewRejection:
            postOnMain(
                name: .birdieReviewApprovalRejection,
                opaqueID: Self.validIdentifier(userInfo[BirdieNotificationContract.approvalIDKey])
            )
        case BirdieNotificationContract.reviewPause:
            postOnMain(
                name: .birdieReviewMissionPause,
                opaqueID: Self.validIdentifier(userInfo[BirdieNotificationContract.missionIDKey])
            )
        case UNNotificationDefaultActionIdentifier, BirdieNotificationContract.open:
            let approvalID = Self.validIdentifier(
                userInfo[BirdieNotificationContract.approvalIDKey]
            )
            let missionID = Self.validIdentifier(userInfo[BirdieNotificationContract.missionIDKey])
            if approvalID != nil {
                postOnMain(name: .birdieOpenApprovals, opaqueID: approvalID)
            } else if missionID != nil {
                postOnMain(name: .birdieOpenMissions, opaqueID: missionID)
            }
        default:
            break
        }
    }

    private nonisolated func postOnMain(name: Notification.Name, opaqueID: String?) {
        Task { @MainActor in
            if let opaqueID {
                let defaults = UserDefaults.standard
                switch name {
                case .birdieOpenApprovals, .birdieReviewApprovalRejection:
                    defaults.set(opaqueID, forKey: Self.pendingApprovalKey)
                case .birdieOpenMissions, .birdieReviewMissionPause:
                    defaults.set(opaqueID, forKey: Self.pendingMissionKey)
                    defaults.set(
                        name == .birdieReviewMissionPause ? "pause" : "open",
                        forKey: Self.pendingMissionIntentKey
                    )
                default:
                    break
                }
            }
            NotificationCenter.default.post(
                name: name,
                object: nil,
                userInfo: opaqueID.map { ["opaqueId": $0] }
            )
        }
    }

    private static func categories() -> Set<UNNotificationCategory> {
        let open = UNNotificationAction(
            identifier: BirdieNotificationContract.open,
            title: "In Birdie öffnen",
            options: [.foreground, .authenticationRequired]
        )
        let remind = UNNotificationAction(
            identifier: BirdieNotificationContract.remindLater,
            title: "Später erinnern",
            options: []
        )
        let reject = UNNotificationAction(
            identifier: BirdieNotificationContract.reviewRejection,
            title: "Ablehnung prüfen",
            options: [.foreground, .authenticationRequired, .destructive]
        )
        let pause = UNNotificationAction(
            identifier: BirdieNotificationContract.reviewPause,
            title: "Pausieren",
            options: [.foreground, .authenticationRequired]
        )

        let approval = UNNotificationCategory(
            identifier: BirdieNotificationContract.approvalSafeCategory,
            actions: [open, remind, reject],
            intentIdentifiers: [],
            hiddenPreviewsBodyPlaceholder: "Birdie-Aktion wartet",
            categorySummaryFormat: "%u Birdie-Aktionen warten",
            options: [.customDismissAction]
        )
        let redApproval = UNNotificationCategory(
            identifier: BirdieNotificationContract.approvalRedCategory,
            actions: [open, remind, reject],
            intentIdentifiers: [],
            hiddenPreviewsBodyPlaceholder: "Birdie-Aktion wartet",
            categorySummaryFormat: "%u Birdie-Aktionen warten",
            options: [.customDismissAction]
        )
        let mission = UNNotificationCategory(
            identifier: BirdieNotificationContract.missionCategory,
            actions: [open, pause],
            intentIdentifiers: [],
            hiddenPreviewsBodyPlaceholder: "Birdie-Mission läuft",
            categorySummaryFormat: "%u Birdie-Missionen laufen",
            options: [.customDismissAction]
        )
        return [approval, redApproval, mission]
    }

    private static func validIdentifier(_ value: Any?) -> String? {
        guard let value = value as? String, isOpaqueIdentifier(value) else { return nil }
        return value
    }

    private static func isOpaqueIdentifier(_ value: String) -> Bool {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        guard (16...128).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy {
            allowed.contains($0)
        }
    }
}

final class BirdieAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        BirdieNotificationManager.shared.configure()
        return true
    }
}
