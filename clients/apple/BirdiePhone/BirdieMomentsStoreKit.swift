import Foundation
import StoreKit

enum BirdieMomentStoreKitOutcome: Sendable, Equatable {
    case purchased(purchaseId: String)
    case alreadyPurchased(downloadHref: String?)
    case pending
    case cancelled
}

enum BirdieMomentStoreKitError: LocalizedError {
    case purchaseIntentIncomplete
    case accountTokenInvalid
    case productNotFound(String)
    case productTypeInvalid(String)
    case transactionUnverified
    case transactionProductMismatch
    case transactionAccountMismatch
    case serverDidNotGrantEntitlement
    case unknownPurchaseResult

    var errorDescription: String? {
        switch self {
        case .purchaseIntentIncomplete: return "Birdie Moments purchase intent is incomplete."
        case .accountTokenInvalid: return "Birdie Moments account token is invalid."
        case .productNotFound(let id): return "App Store product \(id) is unavailable."
        case .productTypeInvalid(let id): return "App Store product \(id) is not configured as consumable."
        case .transactionUnverified: return "StoreKit could not verify the purchase on this device."
        case .transactionProductMismatch: return "StoreKit returned a different product than Birdie Moments requested."
        case .transactionAccountMismatch: return "StoreKit returned a purchase for a different Birdie account."
        case .serverDidNotGrantEntitlement: return "Birdie Moments did not confirm the paid entitlement."
        case .unknownPurchaseResult: return "StoreKit returned an unsupported purchase result."
        }
    }
}

actor BirdieMomentsStoreKit {
    private let api: BirdieMomentsAPI
    private let pendingStore: BirdieMomentsPendingPurchaseStore

    init(
        api: BirdieMomentsAPI,
        pendingStore: BirdieMomentsPendingPurchaseStore = BirdieMomentsPendingPurchaseStore()
    ) {
        self.api = api
        self.pendingStore = pendingStore
    }

    func purchaseDigitalEdition(momentId: String) async throws -> BirdieMomentStoreKitOutcome {
        let intent = try await api.startDigitalPurchase(momentId: momentId)

        if intent.isAlreadyPurchased {
            return .alreadyPurchased(downloadHref: intent.downloadHref)
        }

        guard intent.status == "STOREKIT_READY",
              let productId = intent.appStoreProductId,
              let tokenString = intent.appAccountToken else {
            throw BirdieMomentStoreKitError.purchaseIntentIncomplete
        }
        guard let accountToken = UUID(uuidString: tokenString) else {
            throw BirdieMomentStoreKitError.accountTokenInvalid
        }

        let products = try await Product.products(for: [productId])
        guard let product = products.first(where: { $0.id == productId }) else {
            throw BirdieMomentStoreKitError.productNotFound(productId)
        }
        guard product.type == .consumable else {
            throw BirdieMomentStoreKitError.productTypeInvalid(productId)
        }

        let pending = BirdieMomentPendingPurchase(
            purchaseId: intent.purchaseId,
            momentId: momentId,
            productId: productId,
            appAccountToken: accountToken
        )
        await pendingStore.save(pending)

        let result = try await product.purchase(options: [.appAccountToken(accountToken)])
        switch result {
        case .success(let verification):
            return try await confirm(
                verification,
                pending: pending
            )
        case .pending:
            return .pending
        case .userCancelled:
            return .cancelled
        @unknown default:
            throw BirdieMomentStoreKitError.unknownPurchaseResult
        }
    }

    /// Call after the authenticated Birdie session is ready at app launch/reconnect.
    /// Unfinished consumables stay in StoreKit until the Birdie server confirms entitlement.
    func recoverUnfinishedPurchases() async -> Int {
        var recovered = 0

        for await verification in Transaction.unfinished {
            guard case .verified(let transaction) = verification,
                  let accountToken = transaction.appAccountToken,
                  let pending = await pendingStore.matching(
                    productId: transaction.productID,
                    appAccountToken: accountToken
                  ) else {
                continue
            }

            do {
                _ = try await confirm(verification, pending: pending)
                recovered += 1
            } catch {
                // Leave both the local record and StoreKit transaction unfinished.
                // A later authenticated recovery attempt can safely retry.
            }
        }

        return recovered
    }

    private func confirm(
        _ verification: VerificationResult<Transaction>,
        pending: BirdieMomentPendingPurchase
    ) async throws -> BirdieMomentStoreKitOutcome {
        guard case .verified(let transaction) = verification else {
            throw BirdieMomentStoreKitError.transactionUnverified
        }
        guard transaction.productID == pending.productId else {
            throw BirdieMomentStoreKitError.transactionProductMismatch
        }
        guard transaction.appAccountToken == pending.appAccountToken else {
            throw BirdieMomentStoreKitError.transactionAccountMismatch
        }

        let confirmation = try await api.confirmDigitalPurchase(
            purchaseId: pending.purchaseId,
            signedTransactionInfo: verification.jwsRepresentation
        )

        guard confirmation.processed,
              confirmation.status == "PAID" else {
            throw BirdieMomentStoreKitError.serverDidNotGrantEntitlement
        }

        // Finish only after Birdie server persistence + entitlement succeeded.
        await transaction.finish()
        await pendingStore.remove(purchaseId: pending.purchaseId)
        return .purchased(purchaseId: pending.purchaseId)
    }
}
