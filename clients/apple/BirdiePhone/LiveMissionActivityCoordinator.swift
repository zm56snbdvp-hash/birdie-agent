import ActivityKit
import Foundation
import UIKit

@MainActor
protocol LiveMissionActivityCoordinating: AnyObject {
    func start(for mission: LiveMissionRecord) throws -> String
    func update(for mission: LiveMissionRecord) async throws
    func end(for mission: LiveMissionRecord) async throws
    func isActive(missionID: String) -> Bool
}

@MainActor
final class LiveMissionActivityCoordinator: LiveMissionActivityCoordinating {
    static let lockScreenTitle = "Birdie-Auftrag"

    enum CoordinatorError: LocalizedError, Equatable {
        case activitiesDisabled
        case applicationNotActive
        case missionNotEligible
        case missionExpired
        case activityAlreadyExists
        case activityNotFound
        case staleRecordVersion
        case expiryChanged
        case missionNotTerminal

        var errorDescription: String? {
            switch self {
            case .activitiesDisabled:
                "Live-Aktivitäten sind auf diesem Gerät deaktiviert."
            case .applicationNotActive:
                "Eine Live Mission kann nur in der geöffneten App gestartet werden."
            case .missionNotEligible:
                "Diese Mission eignet sich nicht als zeitlich begrenzte Live Mission."
            case .missionExpired:
                "Diese Mission ist bereits abgelaufen."
            case .activityAlreadyExists:
                "Für diese Mission läuft bereits eine Live-Aktivität."
            case .activityNotFound:
                "Für diese Mission ist keine Live-Aktivität aktiv."
            case .staleRecordVersion:
                "Eine veraltete Missionsantwort darf die Live-Aktivität nicht zurücksetzen."
            case .expiryChanged:
                "Die Laufzeit einer Live Mission darf nach dem Start nicht verändert werden."
            case .missionNotTerminal:
                "Eine laufende Live Mission darf nicht ohne Missionsabschluss beendet werden."
            }
        }
    }

    private let now: @Sendable () -> Date

    init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    @discardableResult
    func start(for mission: LiveMissionRecord) throws -> String {
        let currentDate = now()
        guard UIApplication.shared.applicationState == .active else {
            throw CoordinatorError.applicationNotActive
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw CoordinatorError.activitiesDisabled
        }
        guard mission.expiresAt > currentDate else {
            throw CoordinatorError.missionExpired
        }
        guard mission.startedAt <= currentDate else {
            throw CoordinatorError.missionNotEligible
        }
        guard mission.isEligibleForLiveActivity(at: currentDate) else {
            throw CoordinatorError.missionNotEligible
        }
        guard !isActive(missionID: mission.missionID) else {
            throw CoordinatorError.activityAlreadyExists
        }

        let attributes = try BirdieLiveMissionAttributes(
            missionID: mission.missionID,
            // Never project the potentially sensitive backend title onto the
            // Lock Screen or Dynamic Island.
            title: Self.lockScreenTitle,
            startedAt: mission.startedAt,
            hardEndAt: mission.expiresAt
        )
        let state = try makeContentState(for: mission)
        let content = makeActivityContent(
            state: state,
            updatedAt: mission.updatedAt,
            expiresAt: attributes.hardEndAt
        )

        // No push type means no ActivityKit token is requested or handled here.
        // Updates remain under control of the containing phone app.
        let activity = try Activity<BirdieLiveMissionAttributes>.request(
            attributes: attributes,
            content: content,
            pushType: nil
        )
        return activity.id
    }

    func update(for mission: LiveMissionRecord) async throws {
        guard let activity = activity(for: mission.missionID) else {
            throw CoordinatorError.activityNotFound
        }
        guard Self.acceptsUpdate(
            recordVersion: mission.recordVersion,
            currentRecordVersion: activity.content.state.recordVersion
        ) else {
            throw CoordinatorError.staleRecordVersion
        }
        guard abs(mission.expiresAt.timeIntervalSince(activity.attributes.hardEndAt)) < 1 else {
            throw CoordinatorError.expiryChanged
        }

        if mission.status.isTerminal || now() >= mission.expiresAt {
            try await end(activity: activity, mission: mission)
            return
        }

        let state = try makeContentState(for: mission)
        await activity.update(
            makeActivityContent(
                state: state,
                updatedAt: mission.updatedAt,
                expiresAt: min(mission.expiresAt, activity.attributes.hardEndAt)
            )
        )
    }

    func end(for mission: LiveMissionRecord) async throws {
        guard let activity = activity(for: mission.missionID) else {
            throw CoordinatorError.activityNotFound
        }
        try await end(activity: activity, mission: mission)
    }

    func isActive(missionID: String) -> Bool {
        activity(for: missionID) != nil
    }

    static func acceptsUpdate(recordVersion: Int, currentRecordVersion: Int) -> Bool {
        recordVersion >= currentRecordVersion
    }

    private func activity(for missionID: String) -> Activity<BirdieLiveMissionAttributes>? {
        Activity<BirdieLiveMissionAttributes>.activities.first {
            guard $0.attributes.missionID == missionID else { return false }
            let state = $0.activityState
#if compiler(>=6.2)
            // `pending` was added in the iOS 26 SDK. Keep scheduled activities
            // discoverable without making Xcode 16 builds reference that symbol.
            if #available(iOS 26.0, *) {
                switch state {
                case .active, .stale, .pending:
                    return true
                case .ended, .dismissed:
                    return false
                @unknown default:
                    return false
                }
            }
#endif
            switch state {
            case .active, .stale:
                return true
            case .ended, .dismissed:
                return false
            default:
                return false
            }
        }
    }

    private func end(
        activity: Activity<BirdieLiveMissionAttributes>,
        mission: LiveMissionRecord
    ) async throws {
        let finalStatus: BirdieLiveMissionAttributes.Status
        if mission.status.isTerminal {
            finalStatus = mission.status.activityStatus
        } else if now() >= mission.expiresAt {
            finalStatus = .expired
        } else {
            throw CoordinatorError.missionNotTerminal
        }

        let state = try makeContentState(
            for: mission,
            overridingStatus: finalStatus
        )
        let finalContent = ActivityContent(
            state: state,
            staleDate: nil,
            relevanceScore: 0
        )
        await activity.end(
            finalContent,
            dismissalPolicy: .after(now().addingTimeInterval(60))
        )
    }

    private func makeContentState(
        for mission: LiveMissionRecord,
        overridingStatus: BirdieLiveMissionAttributes.Status? = nil
    ) throws -> BirdieLiveMissionAttributes.ContentState {
        let status = overridingStatus ?? mission.status.activityStatus
        return try BirdieLiveMissionAttributes.ContentState(
            recordVersion: mission.recordVersion,
            status: status,
            progress: mission.progress,
            currentStepIndex: mission.currentStep.index,
            currentStepTotal: mission.currentStep.total,
            currentStepTitle: activityStepTitle(for: mission),
            blockerCategory: mission.blocker?.activityCategory,
            allowsPause: mission.allowsPause && status == .running,
            allowsCancel: mission.allowsCancel
        )
    }

    private func activityStepTitle(
        for mission: LiveMissionRecord
    ) -> BirdieLiveMissionAttributes.StepTitle {
        if mission.blocker?.activityCategory == .approvalRequired {
            return .waitingForApproval
        }

        let normalized = mission.currentStep.title.lowercased()
        if normalized.contains("prüf")
            || normalized.contains("pruef")
            || normalized.contains("review")
            || normalized.contains("check") {
            return .review
        }
        if mission.currentStep.index == mission.currentStep.total || mission.progress >= 0.85 {
            return .completion
        }
        if mission.currentStep.index == 1 || mission.progress <= 0.15 {
            return .preparation
        }
        return .execution
    }

    private func makeActivityContent(
        state: BirdieLiveMissionAttributes.ContentState,
        updatedAt: Date,
        expiresAt: Date
    ) -> ActivityContent<BirdieLiveMissionAttributes.ContentState> {
        let freshnessWindow: TimeInterval = state.status == .paused ? 30 * 60 : 15 * 60
        return ActivityContent(
            state: state,
            staleDate: min(expiresAt, updatedAt.addingTimeInterval(freshnessWindow)),
            relevanceScore: state.status == .blocked ? 1 : 0.7
        )
    }
}
