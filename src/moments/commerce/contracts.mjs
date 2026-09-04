import { MOMENT_TYPE } from "../contracts.mjs";

export const PRODUCT_TYPE = Object.freeze({
  DIGITAL_ROUND: "DIGITAL_ROUND",
  DIGITAL_PERSONAL_BEST: "DIGITAL_PERSONAL_BEST",
  PRINT_A3: "PRINT_A3"
});

export const FULFILLMENT_TYPE = Object.freeze({
  DIGITAL: "DIGITAL",
  PRINT: "PRINT"
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED"
});

export class MomentCommerceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MomentCommerceError";
    this.code = code;
    this.status = status;
  }
}

export function digitalProductTypeForMoment(moment) {
  if (moment?.momentType === MOMENT_TYPE.ROUND) return PRODUCT_TYPE.DIGITAL_ROUND;
  if (moment?.momentType === MOMENT_TYPE.PERSONAL_BEST) return PRODUCT_TYPE.DIGITAL_PERSONAL_BEST;
  throw new MomentCommerceError("UNSUPPORTED_MOMENT_TYPE", "Moment cannot be sold digitally", 400);
}

export function resolveCatalogPrice(catalog, productType) {
  const product = catalog?.[productType];
  if (
    !product ||
    !Number.isInteger(product.amountMinor) ||
    product.amountMinor < 0 ||
    typeof product.currency !== "string" ||
    !product.currency.trim()
  ) {
    throw new MomentCommerceError("PRODUCT_NOT_CONFIGURED", `No valid server price for ${productType}`, 503);
  }

  return {
    amountMinor: product.amountMinor,
    currency: product.currency.trim().toUpperCase()
  };
}

export function checkoutMetadata({ userId, moment, productType }) {
  if (!userId || !moment?.id || !moment?.roundId) {
    throw new MomentCommerceError("INVALID_CHECKOUT_CONTEXT", "Checkout metadata is incomplete", 500);
  }

  return Object.freeze({
    user_id: String(userId),
    round_id: String(moment.roundId),
    moment_id: String(moment.id),
    product_type: String(productType),
    fulfillment_type: FULFILLMENT_TYPE.DIGITAL
  });
}

export function assertPaidEventMatchesPurchase(event, purchase) {
  if (!event || !purchase) {
    throw new MomentCommerceError("PAYMENT_VERIFICATION_FAILED", "Payment verification context missing", 400);
  }

  const expectedMetadata = {
    user_id: String(purchase.userId),
    moment_id: String(purchase.momentId),
    product_type: String(purchase.productType),
    fulfillment_type: String(purchase.fulfillmentType)
  };

  for (const [key, value] of Object.entries(expectedMetadata)) {
    if (String(event.metadata?.[key] ?? "") !== value) {
      throw new MomentCommerceError("PAYMENT_METADATA_MISMATCH", `Payment metadata mismatch: ${key}`, 400);
    }
  }

  if (Number(event.amountMinor) !== Number(purchase.amountMinor)) {
    throw new MomentCommerceError("PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match purchase", 400);
  }

  if (String(event.currency || "").toUpperCase() !== String(purchase.currency || "").toUpperCase()) {
    throw new MomentCommerceError("PAYMENT_CURRENCY_MISMATCH", "Payment currency does not match purchase", 400);
  }

  if (event.paid !== true) {
    throw new MomentCommerceError("PAYMENT_NOT_PAID", "Payment is not confirmed as paid", 400);
  }

  return true;
}
