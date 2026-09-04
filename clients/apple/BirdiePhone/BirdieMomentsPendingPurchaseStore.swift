import Foundation

struct BirdieMomentPendingPurchase: Codable, Sendable, Equatable {
    let purchaseId: String
    let momentId: String
    let productId: String
    let appAccountToken: UUID
}

actor BirdieMomentsPendingPurchaseStore {
    private let defaults: UserDefaults
    private let key = "birdie.moments.storekit.pending.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func save(_ record: BirdieMomentPendingPurchase) {
        var records = load()
        records.removeAll { $0.purchaseId == record.purchaseId }
        records.append(record)
        persist(records)
    }

    func remove(purchaseId: String) {
        var records = load()
        records.removeAll { $0.purchaseId == purchaseId }
        persist(records)
    }

    func matching(productId: String, appAccountToken: UUID) -> BirdieMomentPendingPurchase? {
        load().first {
            $0.productId == productId && $0.appAccountToken == appAccountToken
        }
    }

    func all() -> [BirdieMomentPendingPurchase] {
        load()
    }

    private func load() -> [BirdieMomentPendingPurchase] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([BirdieMomentPendingPurchase].self, from: data)) ?? []
    }

    private func persist(_ records: [BirdieMomentPendingPurchase]) {
        if records.isEmpty {
            defaults.removeObject(forKey: key)
            return
        }
        guard let data = try? JSONEncoder().encode(records) else { return }
        defaults.set(data, forKey: key)
    }
}
