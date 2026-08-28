import Foundation

public protocol BirdieRouteStaging: Sendable {
    func stage(_ route: BirdieRoute)
}

extension BirdiePendingRouteStore: BirdieRouteStaging {}

public enum BirdieIntentCoordinatorError: Error, Equatable {
    case unsupportedSource
    case directExecutionContractRejected
}

/// The only runtime entry point used by system-surface intents.
/// It can stage a foreground route, but has no network or domain-write dependency.
public struct BirdieIntentCoordinator: Sendable {
    public static let shared = BirdieIntentCoordinator()

    private let stager: any BirdieRouteStaging

    public init(stager: any BirdieRouteStaging = BirdiePendingRouteStore.shared) {
        self.stager = stager
    }

    public func stagePreview(
        action: BirdieActionKind,
        source: BirdieRouteSource,
        focus: BirdieFocusContext? = nil,
        draft: String? = nil
    ) throws {
        guard source == .appIntent || source == .control else {
            throw BirdieIntentCoordinatorError.unsupportedSource
        }
        let contract = BirdieActionCatalog.contract(for: action)
        guard !contract.allowsDirectIntentExecution else {
            throw BirdieIntentCoordinatorError.directExecutionContractRejected
        }
        stager.stage(
            BirdieRoute(
                action: action,
                source: source,
                focus: focus,
                draft: draft
            )
        )
    }
}
