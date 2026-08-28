import Combine
import Foundation
import UIKit

@MainActor
final class LiveMissionStore: ObservableObject {
    struct PendingCommand: Identifiable, Equatable {
        let id = UUID()
        let missionID: String
        let expectedRecordVersion: Int
        let command: LiveMissionCommand
        let idempotencyKey: String
    }

    @Published private(set) var mission: LiveMissionRecord?
    @Published private(set) var isLoading = false
    @Published private(set) var isSubmittingCommand = false
    @Published private(set) var isLiveActivityActive = false
    @Published private(set) var lastCommandReceipt: MissionCommandReceipt?
    @Published private(set) var message: String?
    @Published var pendingCommand: PendingCommand?

    private let service: any LiveMissionServicing
    private let activityCoordinator: any LiveMissionActivityCoordinating
    private let commandCoordinator: any LiveMissionCommandCoordinating

    init(
        service: any LiveMissionServicing = LiveMissionEnvironment.makeService(),
        activityCoordinator: (any LiveMissionActivityCoordinating)? = nil,
        localAuthorizer: any LiveMissionLocalAuthorizing = LiveMissionLocalAuthorizer(),
        commandCoordinator: (any LiveMissionCommandCoordinating)? = nil
    ) {
        self.service = service
        self.activityCoordinator = activityCoordinator ?? LiveMissionActivityCoordinator()
        if let commandCoordinator {
            self.commandCoordinator = commandCoordinator
        } else {
#if DEBUG
            let assertionProvider: any BirdieDeviceAssertionProviding = LocalMockDeviceAssertionProvider()
            let pendingRequestCache = LiveMissionPendingRequestCache(fileURL: nil)
            let receiptVerifier: any BirdieServerSignatureVerifying
            if let mockService = service as? LiveMissionMockService {
                receiptVerifier = DynamicDebugEd25519ServerSignatureVerifier {
                    await mockService.debugReceiptVerificationKey()
                }
            } else {
                receiptVerifier = UnconfiguredServerSignatureVerifier()
            }
#else
            let assertionProvider: any BirdieDeviceAssertionProviding = AppAttestDeviceAssertionProvider()
            let pendingRequestCache = LiveMissionPendingRequestCache()
            let receiptVerifier: any BirdieServerSignatureVerifying =
                UnconfiguredServerSignatureVerifier()
#endif
            self.commandCoordinator = LiveMissionCommandCoordinator(
                service: service,
                localAuthorizer: localAuthorizer,
                deviceAssertionProvider: assertionProvider,
                receiptVerifier: receiptVerifier,
                pendingRequestCache: pendingRequestCache
            )
        }
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        message = nil
        defer { isLoading = false }

        do {
            let recovery = try await commandCoordinator.recoverAllPendingResponses()
            for recovered in recovery.responses {
                if applyIfNotOlder(recovered.mission) {
                    lastCommandReceipt = recovered.receipt
                }
                if pendingCommand?.idempotencyKey == recovered.receipt.idempotencyKey {
                    pendingCommand = nil
                }
            }
            let fetchedMission = try await service.fetchCurrentMission()
            if let fetchedMission {
                _ = applyIfNotOlder(fetchedMission)
            } else if recovery.responses.isEmpty {
                mission = nil
            }
            await synchronizeExistingActivity()
            if recovery.retainedPendingRequestCount > 0, message == nil {
                message = "Ein ausstehender Missionsbefehl wird sicher erneut geprüft."
            }
        } catch {
            message = error.localizedDescription
        }
    }

    /// Live Activities never start as a side effect of loading a mission. This
    /// method is only called by an explicit foreground button in the phone UI.
    func startLiveActivity() {
        guard UIApplication.shared.applicationState == .active else {
            message = "Öffne Birdie, um die Live Mission zu starten."
            return
        }
        guard let mission else {
            message = "Es ist keine Mission geladen."
            return
        }

        do {
            _ = try activityCoordinator.start(for: mission)
            isLiveActivityActive = true
            message = "Live Mission gestartet."
        } catch {
            message = error.localizedDescription
        }
    }

    func prepare(
        command: LiveMissionCommand,
        applicationIsActive: Bool? = nil
    ) {
        let isActive = applicationIsActive ?? (UIApplication.shared.applicationState == .active)
        guard isActive else {
            message = "Pause und Abbruch müssen in der geöffneten App bestätigt werden."
            return
        }
        guard let mission else {
            message = "Es ist keine Mission geladen."
            return
        }
        guard commandIsAllowed(command, for: mission) else {
            message = LiveMissionServiceError.commandNotAllowed.localizedDescription
            return
        }
        if let pendingCommand {
            if pendingCommand.missionID == mission.missionID,
               pendingCommand.expectedRecordVersion == mission.recordVersion,
               pendingCommand.command == command {
                message = nil
            } else {
                message = "Bestätige oder verwirf zuerst den bereits vorbereiteten Missionsbefehl."
            }
            return
        }

        pendingCommand = PendingCommand(
            missionID: mission.missionID,
            expectedRecordVersion: mission.recordVersion,
            command: command,
            idempotencyKey: UUID().uuidString.lowercased()
        )
        message = nil
    }

    func confirmPendingCommand(
        applicationIsActive: Bool? = nil
    ) async {
        guard !isSubmittingCommand else { return }
        let isActive = applicationIsActive ?? (UIApplication.shared.applicationState == .active)
        guard isActive else {
            message = "Der Befehl wurde nicht ausgeführt. Öffne Birdie und versuche es erneut."
            return
        }
        guard let pendingCommand,
              let current = mission,
              current.missionID == pendingCommand.missionID,
              current.recordVersion == pendingCommand.expectedRecordVersion,
              commandIsAllowed(pendingCommand.command, for: current) else {
            message = "Die Mission hat sich geändert oder ist abgelaufen. Bitte neu laden."
            return
        }

        isSubmittingCommand = true
        message = nil
        defer { isSubmittingCommand = false }

        do {
            let response = try await commandCoordinator.execute(
                mission: current,
                command: pendingCommand.command,
                idempotencyKey: pendingCommand.idempotencyKey,
                reason: nil
            )
            mission = response.mission
            lastCommandReceipt = response.receipt
            if self.pendingCommand?.id == pendingCommand.id {
                self.pendingCommand = nil
            }
            await synchronizeExistingActivity()
            if message == nil {
                message = response.receipt.outcome == .accepted
                    ? successMessage(for: pendingCommand.command)
                    : "Der Server hat den Missionsbefehl gemäß Richtlinie abgelehnt."
            }
        } catch {
            message = error.localizedDescription
        }
    }

    func dismissPendingCommand() {
        pendingCommand = nil
    }

    /// A Lock-Screen action can only navigate here. It never invokes the
    /// service or changes ActivityKit state directly.
    func handle(deepLink url: URL, applicationIsActive: Bool) {
        guard let link = BirdieLiveMissionDeepLink(url: url),
              let mission,
              mission.missionID == link.missionID else {
            message = "Der Live-Mission-Link ist ungültig oder nicht mehr aktuell."
            return
        }

        switch link.intent {
        case .open:
            break
        case .pause:
            prepare(command: .pause, applicationIsActive: applicationIsActive)
        case .cancel:
            prepare(command: .cancel, applicationIsActive: applicationIsActive)
        }
    }

    func clearMessage() {
        message = nil
    }

    private func synchronizeExistingActivity() async {
        guard let mission else {
            isLiveActivityActive = false
            return
        }
        guard activityCoordinator.isActive(missionID: mission.missionID) else {
            isLiveActivityActive = false
            return
        }

        do {
            try await activityCoordinator.update(for: mission)
            isLiveActivityActive = !mission.status.isTerminal && Date() < mission.expiresAt
        } catch {
            isLiveActivityActive = activityCoordinator.isActive(missionID: mission.missionID)
            message = error.localizedDescription
        }
    }

    /// Network responses can arrive out of order. Never regress one mission
    /// from a locally observed N+1 record to an older N record.
    @discardableResult
    private func applyIfNotOlder(_ candidate: LiveMissionRecord) -> Bool {
        if let current = mission,
           current.missionID == candidate.missionID,
           candidate.recordVersion < current.recordVersion {
            return false
        }
        mission = candidate
        return true
    }

    private func commandIsAllowed(_ command: LiveMissionCommand, for mission: LiveMissionRecord) -> Bool {
        guard Date() < mission.expiresAt else { return false }
        return switch command {
        case .pause:
            mission.status == .running && mission.allowsPause
        case .resume:
            mission.status == .paused
        case .cancel:
            !mission.status.isTerminal && mission.allowsCancel
        }
    }

    private func successMessage(for command: LiveMissionCommand) -> String {
        switch command {
        case .pause:
            "Mission pausiert."
        case .resume:
            "Mission fortgesetzt."
        case .cancel:
            "Mission abgebrochen."
        }
    }
}
