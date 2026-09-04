import {
  PAYMENT_STATUS,
  MomentCommerceError,
  assertPaidEventMatchesPurchase
} from "./contracts.mjs";

/**
 * paymentProvider.verifyWebhook({ rawBody, signature }) must verify the provider signature
 * and return a normalized event. No unverified request body may authorize entitlement.
 *
 * Required repo contract:
 * - getPurchaseByPaymentReference(reference)
 * - getMoment(momentId)
 * - confirmPaidPurchase(input): atomically records provider_event_id and grants entitlement.
 * - markPurchaseFailed?(input)
 */
export async function handlePaymentWebhook({
  rawBody,
  signature,
  paymentProvider,
  repo,
  now = () => new Date().toISOString()
}) {
  const event = await paymentProvider.verifyWebhook({ rawBody, signature });

  if (!event?.id || !event?.type || !event?.paymentReference) {
    throw new MomentCommerceError("INVALID_PROVIDER_EVENT", "Verified provider event is incomplete", 400);
  }

  const purchase = await repo.getPurchaseByPaymentReference(event.paymentReference);
  if (!purchase) {
    throw new MomentCommerceError("PURCHASE_NOT_FOUND", "Purchase for payment reference not found", 404);
  }

  if (event.type === "PAYMENT_FAILED") {
    await repo.markPurchaseFailed?.({
      purchaseId: purchase.id,
      providerEventId: event.id,
      failedAt: now()
    });
    return { processed: true, status: PAYMENT_STATUS.FAILED, purchaseId: purchase.id };
  }

  if (event.type !== "PAYMENT_SUCCEEDED") {
    return { processed: false, ignored: true, eventType: event.type };
  }

  assertPaidEventMatchesPurchase(event, purchase);

  const moment = await repo.getMoment(purchase.momentId);
  if (!moment || moment.userId !== purchase.userId) {
    throw new MomentCommerceError("PURCHASE_OWNER_MISMATCH", "Purchase ownership cannot be verified", 400);
  }

  if (String(event.metadata?.round_id ?? "") !== String(moment.roundId ?? "")) {
    throw new MomentCommerceError("PAYMENT_METADATA_MISMATCH", "Payment metadata mismatch: round_id", 400);
  }

  if (!moment.digitalAsset && !moment.digital_asset) {
    throw new MomentCommerceError("DIGITAL_ASSET_NOT_READY", "Digital asset is not ready", 409);
  }

  const paidAt = now();
  const result = await repo.confirmPaidPurchase({
    purchaseId: purchase.id,
    providerEventId: event.id,
    eventType: event.type,
    paymentStatus: PAYMENT_STATUS.PAID,
    entitlementGrantedAt: paidAt,
    fulfillmentStatus: "READY",
    updatedAt: paidAt
  });

  if (result?.duplicate === true) {
    return { processed: true, duplicate: true, status: PAYMENT_STATUS.PAID, purchaseId: purchase.id };
  }

  return {
    processed: true,
    duplicate: false,
    status: PAYMENT_STATUS.PAID,
    purchaseId: purchase.id,
    entitlementGrantedAt: paidAt
  };
}
