import { getOwnedMoment } from "../ui/access.mjs";
import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "../analytics/events.mjs";
import { PAYMENT_STATUS, PRODUCT_TYPE, FULFILLMENT_TYPE } from "../commerce/contracts.mjs";
import { printCatalogPrice, printCheckoutMetadata, validateShippingAddress } from "./contracts.mjs";

export async function startPrintCheckout({
  authUserId,
  contactEmail,
  momentId,
  shippingAddress,
  repo,
  paymentProvider,
  catalog,
  analytics,
  successUrl,
  cancelUrl
}) {
  const moment = await getOwnedMoment({ momentId, authUserId, repo });
  const address = validateShippingAddress({
    ...shippingAddress,
    email: shippingAddress?.email ?? contactEmail ?? null
  });
  const price = printCatalogPrice(catalog);

  const purchase = await repo.ensurePurchase({
    userId: authUserId,
    momentId: moment.id,
    productType: PRODUCT_TYPE.PRINT_A3,
    paymentStatus: PAYMENT_STATUS.PENDING,
    amountMinor: price.amountMinor,
    currency: price.currency,
    fulfillmentType: FULFILLMENT_TYPE.PRINT,
    fulfillmentStatus: "NOT_STARTED",
    shippingAddress: address
  });

  if (purchase.paymentStatus === PAYMENT_STATUS.PAID) {
    return { status: "ALREADY_PAID", purchaseId: purchase.id };
  }

  const metadata = printCheckoutMetadata({ userId: authUserId, moment });
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

  await repo.attachPaymentReference({ purchaseId: purchase.id, paymentReference: session.paymentReference });

  await emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_STARTED, {
    userId: authUserId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    productType: PRODUCT_TYPE.PRINT_A3,
    fulfillmentType: FULFILLMENT_TYPE.PRINT,
    purchaseId: purchase.id,
    amountMinor: price.amountMinor,
    currency: price.currency,
    status: "CHECKOUT_READY"
  });

  return { status: "CHECKOUT_READY", purchaseId: purchase.id, checkoutUrl: session.checkoutUrl };
}
