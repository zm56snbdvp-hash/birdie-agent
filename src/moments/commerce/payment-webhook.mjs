import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  MomentCommerceError,
  assertPaidEventMatchesPurchase
} from "./contracts.mjs";
import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "../analytics/events.mjs";

export async function handlePaymentWebhook({
  rawBody,
  signature,
  paymentProvider,
  repo,
  analytics,
  now = () => new Date().toISOString()
}) {
  const event = await paymentProvider.verifyWebhook({ rawBody, signature });

  if (!event?.id || !event?.type || !event?.paymentReference) {
    throw new MomentCommerceError("INVALID_PROVIDER_EVENT", "Verified provider event is incomplete", 400);
  }

  const purchase = await repo.getPurchaseByPaymentReference(event.paymentReference);
  if (!purchase) throw new MomentCommerceError("PURCHASE_NOT_FOUND", "Purchase for payment reference not found", 404);

  if (event.type === "PAYMENT_FAILED") {
    await repo.markPurchaseFailed?.({ purchaseId: purchase.id, providerEventId: event.id, failedAt: now() });
    return { processed: true, status: PAYMENT_STATUS.FAILED, purchaseId: purchase.id };
  }

  if (event.type !== "PAYMENT_SUCCEEDED") return { processed: false, ignored: true, eventType: event.type };

  assertPaidEventMatchesPurchase(event, purchase);

  const moment = await repo.getMoment(purchase.momentId);
  if (!moment || moment.userId !== purchase.userId) {
    throw new MomentCommerceError("PURCHASE_OWNER_MISMATCH", "Purchase ownership cannot be verified", 400);
  }
  if (String(event.metadata?.round_id ?? "") !== String(moment.roundId ?? "")) {
    throw new MomentCommerceError("PAYMENT_METADATA_MISMATCH", "Payment metadata mismatch: round_id", 400);
  }

  const paidAt = now();
  let entitlementGrantedAt = null;
  let fulfillmentStatus;

  if (purchase.fulfillmentType === FULFILLMENT_TYPE.DIGITAL) {
    if (!moment.digitalAsset && !moment.digital_asset) {
      throw new MomentCommerceError("DIGITAL_ASSET_NOT_READY", "Digital asset is not ready", 409);
    }
    entitlementGrantedAt = paidAt;
    fulfillmentStatus = "READY";
  } else if (purchase.fulfillmentType === FULFILLMENT_TYPE.PRINT) {
    if (!moment.printAsset && !moment.print_asset) {
      throw new MomentCommerceError("PRINT_ASSET_NOT_READY", "Print asset is not ready", 409);
    }
    fulfillmentStatus = "AWAITING_ORDER";
  } else {
    throw new MomentCommerceError("FULFILLMENT_TYPE_INVALID", "Unsupported fulfillment type", 400);
  }

  const result = await repo.confirmPaidPurchase({
    purchaseId: purchase.id,
    providerEventId: event.id,
    eventType: event.type,
    paymentStatus: PAYMENT_STATUS.PAID,
    entitlementGrantedAt,
    fulfillmentStatus,
    updatedAt: paidAt
  });

  if (result?.duplicate === true) {
    return { processed: true, duplicate: true, status: PAYMENT_STATUS.PAID, purchaseId: purchase.id };
  }

  const eventName = purchase.fulfillmentType === FULFILLMENT_TYPE.DIGITAL
    ? MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED
    : MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_COMPLETED;

  await emitMomentAnalytics(analytics, eventName, {
    userId: purchase.userId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    productType: purchase.productType,
    fulfillmentType: purchase.fulfillmentType,
    purchaseId: purchase.id,
    amountMinor: purchase.amountMinor,
    currency: purchase.currency,
    status: PAYMENT_STATUS.PAID
  });

  return {
    processed: true,
    duplicate: false,
    status: PAYMENT_STATUS.PAID,
    purchaseId: purchase.id,
    entitlementGrantedAt,
    fulfillmentStatus
  };
}
