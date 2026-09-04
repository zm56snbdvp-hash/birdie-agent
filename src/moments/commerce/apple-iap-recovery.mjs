import { MomentCommerceError } from "./contracts.mjs";
import { confirmAppStoreDigitalPurchase } from "./apple-iap.mjs";

export async function recoverAppStoreDigitalPurchase({
  authUserId,
  signedTransactionInfo,
  repo,
  catalog,
  appleVerifier,
  intentLookup,
  analytics,
  now = () => new Date().toISOString()
}) {
  if (!appleVerifier || typeof appleVerifier.verifyAndDecodeTransaction !== "function") {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", "App Store transaction verifier is required", 503);
  }
  if (!intentLookup || typeof intentLookup.getByAppAccountToken !== "function") {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", "App Store purchase-intent lookup is required", 503);
  }

  // Verify the JWS before using any transaction field for lookup.
  const verifiedTransaction = await appleVerifier.verifyAndDecodeTransaction(signedTransactionInfo);
  const accountToken = verifiedTransaction?.appAccountToken;
  if (typeof accountToken !== "string" || !accountToken) {
    throw new MomentCommerceError("APPLE_ACCOUNT_TOKEN_MISSING", "Verified App Store transaction has no appAccountToken", 400);
  }

  const intent = await intentLookup.getByAppAccountToken(accountToken);
  if (!intent) {
    throw new MomentCommerceError("APPLE_PURCHASE_INTENT_MISSING", "No Birdie Moment purchase intent matches this App Store transaction", 404);
  }
  if (String(intent.userId) !== String(authUserId)) {
    // Do not disclose another user's purchase intent.
    throw new MomentCommerceError("APPLE_PURCHASE_INTENT_MISSING", "No Birdie Moment purchase intent matches this App Store transaction", 404);
  }

  // Reuse the canonical confirmation path with the already verified transaction.
  return confirmAppStoreDigitalPurchase({
    authUserId,
    purchaseId: intent.purchaseId,
    signedTransactionInfo,
    repo,
    catalog,
    appleVerifier: {
      async verifyAndDecodeTransaction() {
        return verifiedTransaction;
      }
    },
    analytics,
    now
  });
}
