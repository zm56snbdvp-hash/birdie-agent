import Combine
import Foundation

@MainActor
final class BirdieAppRouter: ObservableObject {
    @Published var route: BirdieRoute?

    private let pendingStore: BirdiePendingRouteStore

    init(pendingStore: BirdiePendingRouteStore = .shared) {
        self.pendingStore = pendingStore
    }

    func open(_ action: BirdieActionKind, draft: String? = nil) {
        route = BirdieRoute(action: action, source: .app, draft: draft)
    }

    func handle(url: URL) {
        guard let parsed = BirdieRoute(url: url) else { return }
        route = parsed
    }

    func consumePendingRoute() {
        guard let pending = pendingStore.consume() else { return }
        route = pending
    }

    func clear() {
        route = nil
    }
}
