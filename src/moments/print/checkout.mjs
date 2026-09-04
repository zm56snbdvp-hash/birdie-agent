import { getOwnedMoment } from "../ui/access.mjs";
import { PAYMENT_STATUS, PRODUCT_TYPE, FULFILLMENT_TYPE } from "../commerce/contracts.mjs";
import { printCatalogPrice, printCheckoutMetadata, validateShippingAddress } from "./contracts.mjs";

export async function startPrintCheckout({ authUserId, momentId, shippingAddress, repo, paymentProvider, catalog, successUrl, cancelUrl }) {
  const moment = await getOwnedMoment({ momentId, authUserId, repo });
  const address = validateShippingAddress(shippingAddress);
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
  if (!session?.paymentReference || !session?.checkoutUrl) throw new Error("Payment provider returned an incomplete checkout session");

  await repo.attachPaymentReference({ purchaseId: purchase.id, paymentReference: session.paymentReference });
  return { status: "CHECKOUT_READY", purchaseId: purchase.id, checkoutUrl: session.checkoutUrl };
}
