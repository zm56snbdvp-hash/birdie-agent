import Foundation
import StoreKit

enum BirdieMomentsStoreKitError: LocalizedError {
    case invalidServerIntent
    case productNotFound(String)
    case productIsNotConsumable(String)
    case productMismatch
    case unverifiedTransaction
    case serverDidNotGrantEntitlement

    var errorDescription: String? {
        switch self {
        case .invalidServerIntent:
            return "Der Birdie-Moment-Kauf konnte nicht vorbereitet werden."
        case let .productNotFound(productId):
            return "Das App-Store-Produkt \(productId) ist nicht verfügbar."
        case let .productIsNotConsumable(productId):
            return "Das App-Store-Produkt \(productId) ist nicht als Consumable konfiguriert."
        case .productMismatch:
            return "Die StoreKit-Transaktion gehört nicht zum vorbereiteten Birdie Moment."
        case .unverifiedTransaction:
            return "Die StoreKit-Transaktion konnte auf dem Gerät nicht verifiziert werden."
        case .serverDidNotGrantEntitlement:
            return "Die Zahlung wurde noch nicht serverseitig als Birdie-Moment-Entitlement bestätigt."
        }
    }
}

enum BirdieMomentsPurchaseOutcome: Sendable {
    case purchased(BirdieMomentsAppStoreConfirmation)
    case alreadyPurchased(downloadHref: String?)
    case pending
    case cancelled
}

@MainActor
final class BirdieMomentsStoreKitClient {
    private let apiClient: BirdieMomentsAPIClient

    init(apiClient: BirdieMomentsAPIClient) {
        self.apiClient = apiClient
    }

    func purchaseDigitalMoment(momentId: String) async throws -> BirdieMomentsPurchaseOutcome {
        let intent = try await apiClient.startAppStorePurchase(momentId: momentId)

        if intent.status == "ALREADY_PURCHASED" {
            return .alreadyPurchased(downloadHref: intent.downloadHref)
        }

        guard
            intent.status == "STOREKIT_READY",
            let appStoreProductId = intent.appStoreProductId,
            !appStoreProductId.isEmpty,
            let tokenString = intent.appAccountToken,
            let appAccountToken = UUID(uuidString: tokenString)
        else {
            throw BirdieMomentsStoreKitError.invalidServerIntent
        }

        let products = try await Product.products(for: [appStoreProductId])
        guard let product = products.first(where: { $0.id == appStoreProductId }) else {
            throw BirdieMomentsStoreKitError.productNotFound(appStoreProductId)
        }
        guard product.type == .consumable else {
            throw BirdieMomentsStoreKitError.productIsNotConsumable(appStoreProductId)
        }

        let purchaseResult = try await product.purchase(options: [
            .appAccountToken(appAccountToken)
        ])

        switch purchaseResult {
        case let .success(verification):
            let signedTransactionInfo = verification.jwsRepresentation

            switch verification {
            case let .verified(transaction):
                guard transaction.productID == appStoreProductId else {
                    throw BirdieMomentsStoreKitError.productMismatch
                }

                let confirmation = try await apiClient.confirmAppStorePurchase(
                    purchaseId: intent.purchaseId,
                    signedTransactionInfo: signedTransactionInfo
                )
                try requireGrantedEntitlement(confirmation)

                // Finish only after our server has durably granted the entitlement.
                // If confirmation fails, StoreKit can redeliver the unfinished transaction.
                await transaction.finish()
                return .purchased(confirmation)

            case .unverified:
                throw BirdieMomentsStoreKitError.unverifiedTransaction
            }

        case .pending:
            return .pending

        case .userCancelled:
            return .cancelled

        @unknown default:
            return .pending
        }
    }

    /// Call after the authenticated BirdieWorld session is ready.
    /// This recovers consumables that StoreKit still considers unfinished after a crash/network failure.
    func recoverUnfinishedPurchases(onError: ((Error) -> Void)? = nil) async {
        for await verification in Transaction.unfinished {
            do {
                try await recover(verification)
            } catch {
                onError?(error)
            }
        }
    }

    /// Start after authentication is available and keep the returned Task for the authenticated session lifetime.
    /// Handles Ask to Buy and purchases completed outside the immediate purchase() call.
    func startTransactionObserver(onError: ((Error) -> Void)? = nil) -> Task<Void, Never> {
        Task { [weak self] in
            guard let self else { return }
            for await verification in Transaction.updates {
                do {
                    try await self.recover(verification)
                } catch {
                    onError?(error)
                }
            }
        }
    }

    private func recover(_ verification: VerificationResult<Transaction>) async throws {
        let signedTransactionInfo = verification.jwsRepresentation

        switch verification {
        case let .verified(transaction):
            let confirmation = try await apiClient.recoverAppStorePurchase(
                signedTransactionInfo: signedTransactionInfo
            )
            try requireGrantedEntitlement(confirmation)
            await transaction.finish()

        case .unverified:
            throw BirdieMomentsStoreKitError.unverifiedTransaction
        }
    }

    private func requireGrantedEntitlement(_ confirmation: BirdieMomentsAppStoreConfirmation) throws {
        guard confirmation.processed, confirmation.status == "PAID" else {
            throw BirdieMomentsStoreKitError.serverDidNotGrantEntitlement
        }
    }
}
