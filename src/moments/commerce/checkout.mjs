import { getOwnedMoment } from "../ui/access.mjs";
import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "../analytics/events.mjs";
import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  checkoutMetadata,
  digitalProductTypeForMoment,
  resolveCatalogPrice
} from "./contracts.mjs";

/**
 * Required repo contract:
 * - getMoment(momentId)
 * - ensurePurchase(input): idempotent on user+moment+product+fulfillment
 * - attachPaymentReference({ purchaseId, paymentReference })
 *
 * Required payment provider contract:
 * - createCheckoutSession({ purchaseId, amountMinor, currency, metadata, successUrl, cancelUrl })
 *   -> { paymentReference, checkoutUrl }
 */
export async function startDigitalCheckout({
  authUserId,
  momentId,
  repo,
  paymentProvider,
  catalog,
  analytics,
  successUrl,
  cancelUrl
}) {
  const moment = await getOwnedMoment({ momentId, authUserId, repo });
  const productType = digitalProductTypeForMoment(moment);
  const price = resolveCatalogPrice(catalog, productType);

  const purchase = await repo.ensurePurchase({
    userId: authUserId,
    momentId: moment.id,
    productType,
    paymentStatus: PAYMENT_STATUS.PENDING,
    amountMinor: price.amountMinor,
    currency: price.currency,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
    fulfillmentStatus: "NOT_STARTED"
  });

  if (purchase.paymentStatus === PAYMENT_STATUS.PAID && purchase.entitlementGrantedAt) {
    return {
      status: "ALREADY_PURCHASED",
      purchaseId: purchase.id,
      downloadHref: `/moments/${encodeURIComponent(moment.id)}/download`
    };
  }

  const metadata = checkoutMetadata({
    userId: authUserId,
    moment,
    productType
  });

  const session = await paymentProvider.createCheckoutSession({
    purchaseId: purchase.id,
    amountMinor: price.amountMinor,
    currency: price.currency,
    metadata,
    successUrl,
    cancelUrl
  });

  if (!session?.paymentReference || !session?.checkoutUrl) {
    throw new Error("Payment provider returned an incomplete checkout session");
  }

  await repo.attachPaymentReference({
    purchaseId: purchase.id,
    paymentReference: session.paymentReference
  });

  await emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_STARTED, {
    userId: authUserId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    productType,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
    purchaseId: purchase.id,
    amountMinor: price.amountMinor,
    currency: price.currency,
    status: "CHECKOUT_READY"
  });

  return {
    status: "CHECKOUT_READY",
    purchaseId: purchase.id,
    checkoutUrl: session.checkoutUrl
  };
}
