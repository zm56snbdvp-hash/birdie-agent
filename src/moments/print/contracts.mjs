import { MomentCommerceError, PAYMENT_STATUS, PRODUCT_TYPE, FULFILLMENT_TYPE, resolveCatalogPrice } from "../commerce/contracts.mjs";

export const PRINT_ORDER_STATUS = Object.freeze({
  PENDING_SUBMISSION: "PENDING_SUBMISSION",
  SUBMITTED: "SUBMITTED",
  IN_PRODUCTION: "IN_PRODUCTION",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  FULFILLMENT_FAILED: "FULFILLMENT_FAILED",
  CANCELLED: "CANCELLED"
});

export function validateShippingAddress(address) {
  const required = ["recipientName", "line1", "postalCode", "city", "countryCode"];
  const missing = required.filter((key) => typeof address?.[key] !== "string" || !address[key].trim());
  if (missing.length) {
    throw new MomentCommerceError("PRINT_ADDRESS_INCOMPLETE", `Missing shipping address fields: ${missing.join(", ")}`, 400);
  }
  const countryCode = address.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new MomentCommerceError("PRINT_ADDRESS_INVALID", "countryCode must be ISO-3166 alpha-2", 400);
  }
  const email = typeof address.email === "string" && address.email.trim() ? address.email.trim() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MomentCommerceError("PRINT_ADDRESS_INVALID", "email is invalid", 400);
  }
  return Object.freeze({
    recipientName: address.recipientName.trim(),
    firstName: typeof address.firstName === "string" && address.firstName.trim() ? address.firstName.trim() : null,
    lastName: typeof address.lastName === "string" && address.lastName.trim() ? address.lastName.trim() : null,
    email,
    company: typeof address.company === "string" && address.company.trim() ? address.company.trim() : null,
    line1: address.line1.trim(),
    line2: typeof address.line2 === "string" && address.line2.trim() ? address.line2.trim() : null,
    postalCode: address.postalCode.trim(),
    city: address.city.trim(),
    region: typeof address.region === "string" && address.region.trim() ? address.region.trim() : null,
    countryCode
  });
}

export function printCheckoutMetadata({ userId, moment }) {
  if (!userId || !moment?.id || !moment?.roundId) {
    throw new MomentCommerceError("INVALID_CHECKOUT_CONTEXT", "Print checkout metadata is incomplete", 500);
  }
  return Object.freeze({
    user_id: String(userId),
    round_id: String(moment.roundId),
    moment_id: String(moment.id),
    product_type: PRODUCT_TYPE.PRINT_A3,
    fulfillment_type: FULFILLMENT_TYPE.PRINT
  });
}

export function assertPrintPurchaseReady(purchase, moment) {
  if (!purchase || purchase.productType !== PRODUCT_TYPE.PRINT_A3 || purchase.fulfillmentType !== FULFILLMENT_TYPE.PRINT) {
    throw new MomentCommerceError("PRINT_PURCHASE_INVALID", "Purchase is not an A3 print purchase", 400);
  }
  if (purchase.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw new MomentCommerceError("PRINT_PAYMENT_REQUIRED", "Print order requires confirmed payment", 403);
  }
  if (!moment || moment.id !== purchase.momentId || moment.userId !== purchase.userId) {
    throw new MomentCommerceError("PRINT_OWNER_MISMATCH", "Print purchase ownership cannot be verified", 400);
  }
  const printAsset = moment.printAsset ?? moment.print_asset;
  if (!printAsset) throw new MomentCommerceError("PRINT_ASSET_NOT_READY", "Print asset is not ready", 409);
  return printAsset;
}

export function printCatalogPrice(catalog) {
  return resolveCatalogPrice(catalog, PRODUCT_TYPE.PRINT_A3);
}

export function internalPrintOrderKey(purchaseId) {
  if (!purchaseId) throw new MomentCommerceError("PRINT_PURCHASE_INVALID", "purchaseId is required", 400);
  return `birdie-moment-print:${purchaseId}`;
}
