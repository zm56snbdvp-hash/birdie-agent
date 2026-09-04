import { MOMENT_STATUS } from "../contracts.mjs";
import { FULFILLMENT_TYPE, getProduct } from "./catalog.mjs";
import { MomentAuthorizationError, assertOwnership, assertPaidPurchase } from "./security.mjs";

export class MomentPaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MomentPaymentError";
    this.code = code;
  }
}

function validatePayment(payment, expected, context) {
  if (!payment || payment.status !== "PAID") {
    throw new MomentPaymentError("PAYMENT_NOT_VERIFIED", "Payment is not verified as paid");
  }
  if (payment.amountMinor !== expected.amountMinor || payment.currency !== expected.currency) {
    throw new MomentPaymentError("PAYMENT_AMOUNT_MISMATCH", "Paid amount/currency does not match product catalog");
  }
  const metadata = payment.metadata || {};
  for (const [key, value] of Object.entries(context)) {
    if (metadata[key] !== value) {
      throw new MomentPaymentError("PAYMENT_METADATA_MISMATCH", `Payment metadata mismatch for ${key}`);
    }
  }
  if (typeof payment.reference !== "string" || !payment.reference) {
    throw new MomentPaymentError("PAYMENT_REFERENCE_MISSING", "Payment reference is required");
  }
  return payment;
}

export async function finalizeVerifiedPurchase({
  userId,
  momentId,
  sku,
  paymentReference,
  shippingAddress = null
}, { repo, paymentVerifier, analytics = null }) {
  const product = getProduct(sku);
  const moment = assertOwnership(await repo.getMoment(momentId), userId, "moment");

  if (moment.momentType !== product.momentType) {
    throw new MomentPaymentError("SKU_MOMENT_MISMATCH", "SKU does not belong to this Moment type");
  }

  const payment = await paymentVerifier.verifyPayment(paymentReference);
  validatePayment(payment, product, {
    user_id: userId,
    round_id: moment.roundId,
    moment_id: momentId,
    product_type: sku,
    fulfillment_type: product.fulfillmentType
  });

  if (product.fulfillmentType === FULFILLMENT_TYPE.PRINT && !shippingAddress) {
    throw new MomentPaymentError("SHIPPING_ADDRESS_REQUIRED", "Print purchase requires a shipping address");
  }

  const purchase = await repo.ensurePurchase({
    userId,
    momentId,
    productType: sku,
    paymentReference: payment.reference,
    amount: product.amountMinor,
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
    fulfillmentStatus: "PAID",
    shippingAddress
  });

  await repo.setMomentStatus?.(momentId, MOMENT_STATUS.PURCHASED);
  await analytics?.track?.(
    product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL
      ? "digital_purchase_completed"
      : "print_purchase_completed",
    { userId, momentId, sku }
  );

  return { purchase, product, moment };
}

export async function issueDigitalAssetAccess({ userId, purchaseId }, { repo, assetSigner }) {
  const purchase = assertPaidPurchase(await repo.getPurchase(purchaseId), userId);
  const product = getProduct(purchase.productType);
  if (product.fulfillmentType !== FULFILLMENT_TYPE.DIGITAL) {
    throw new MomentAuthorizationError("WRONG_FULFILLMENT_TYPE", "Purchase is not digital");
  }
  const moment = assertOwnership(await repo.getMoment(purchase.momentId), userId, "moment");
  if (!moment.digitalAsset) {
    throw new MomentAuthorizationError("ASSET_NOT_READY", "Digital master is not ready");
  }
  return assetSigner.signPrivateAsset({
    assetReference: moment.digitalAsset,
    userId,
    purchaseId,
    momentId: moment.id,
    purpose: "BIRDIE_MOMENT_DIGITAL_MASTER"
  });
}
