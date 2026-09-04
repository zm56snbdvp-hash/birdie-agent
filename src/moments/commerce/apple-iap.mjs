import { getOwnedMoment } from "../ui/access.mjs";
import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "../analytics/events.mjs";
import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  MomentCommerceError,
  digitalProductTypeForMoment,
  resolveCatalogPrice
} from "./contracts.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, name) {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw new MomentCommerceError("APPLE_ACCOUNT_TOKEN_INVALID", `${name} must be a UUID`, 500);
  }
  return value.trim().toLowerCase();
}

function resolveAppStoreProduct(catalog, productType) {
  const price = resolveCatalogPrice(catalog, productType);
  const appStoreProductId = catalog?.[productType]?.appStoreProductId;
  if (typeof appStoreProductId !== "string" || !appStoreProductId.trim()) {
    throw new MomentCommerceError("APPLE_PRODUCT_NOT_CONFIGURED", `No App Store product configured for ${productType}`, 503);
  }
  return { ...price, appStoreProductId: appStoreProductId.trim() };
}

function assertApplePurchaseContext({ purchase, moment, authUserId }) {
  if (!purchase) throw new MomentCommerceError("PURCHASE_NOT_FOUND", "App Store purchase not found", 404);
  if (String(purchase.userId) !== String(authUserId)) {
    throw new MomentCommerceError("PURCHASE_NOT_FOUND", "App Store purchase not found", 404);
  }
  if (purchase.fulfillmentType !== FULFILLMENT_TYPE.DIGITAL) {
    throw new MomentCommerceError("APPLE_PURCHASE_INVALID", "App Store purchase is not digital", 400);
  }
  if (!moment || String(moment.id) !== String(purchase.momentId) || String(moment.userId) !== String(authUserId)) {
    throw new MomentCommerceError("PURCHASE_NOT_FOUND", "App Store purchase not found", 404);
  }
}

export async function startAppStoreDigitalPurchase({
  authUserId,
  momentId,
  appAccountToken,
  repo,
  catalog,
  analytics,
  now = () => new Date().toISOString()
}) {
  const moment = await getOwnedMoment({ momentId, authUserId, repo });
  const productType = digitalProductTypeForMoment(moment);
  const product = resolveAppStoreProduct(catalog, productType);
  const accountToken = requireUuid(appAccountToken, "appAccountToken");

  const purchase = await repo.ensurePurchase({
    userId: authUserId,
    momentId: moment.id,
    productType,
    paymentStatus: PAYMENT_STATUS.PENDING,
    amountMinor: product.amountMinor,
    currency: product.currency,
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

  await repo.ensureAppStorePurchaseIntent({
    purchaseId: purchase.id,
    userId: authUserId,
    momentId: moment.id,
    appStoreProductId: product.appStoreProductId,
    appAccountToken: accountToken,
    createdAt: now(),
    updatedAt: now()
  });

  await emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_STARTED, {
    userId: authUserId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    productType,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
    purchaseId: purchase.id,
    amountMinor: product.amountMinor,
    currency: product.currency,
    status: "STOREKIT_READY"
  });

  return Object.freeze({
    status: "STOREKIT_READY",
    purchaseId: purchase.id,
    productType,
    appStoreProductId: product.appStoreProductId,
    appAccountToken: accountToken
  });
}

export async function confirmAppStoreDigitalPurchase({
  authUserId,
  purchaseId,
  signedTransactionInfo,
  repo,
  catalog,
  appleVerifier,
  analytics,
  now = () => new Date().toISOString()
}) {
  if (!appleVerifier || typeof appleVerifier.verifyAndDecodeTransaction !== "function") {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", "App Store transaction verifier is required", 503);
  }

  const purchase = await repo.getPurchase(purchaseId);
  const moment = purchase ? await repo.getMoment(purchase.momentId) : null;
  assertApplePurchaseContext({ purchase, moment, authUserId });

  const product = resolveAppStoreProduct(catalog, purchase.productType);
  const intent = await repo.getAppStorePurchaseIntent(purchase.id);
  if (!intent) throw new MomentCommerceError("APPLE_PURCHASE_INTENT_MISSING", "App Store purchase intent not found", 409);
  if (
    String(intent.userId) !== String(authUserId) ||
    String(intent.momentId) !== String(moment.id) ||
    String(intent.appStoreProductId) !== String(product.appStoreProductId)
  ) {
    throw new MomentCommerceError("APPLE_PURCHASE_INTENT_MISMATCH", "Stored App Store purchase intent does not match purchase", 409);
  }

  const transaction = await appleVerifier.verifyAndDecodeTransaction(signedTransactionInfo);
  const transactionId = transaction?.transactionId;
  if (typeof transactionId !== "string" || !transactionId) {
    throw new MomentCommerceError("APPLE_TRANSACTION_INVALID", "Verified App Store transaction has no transactionId", 400);
  }
  if (String(transaction.productId ?? "") !== String(product.appStoreProductId)) {
    throw new MomentCommerceError("APPLE_PRODUCT_MISMATCH", "App Store product does not match purchase", 400);
  }
  if (String(transaction.appAccountToken ?? "").toLowerCase() !== String(intent.appAccountToken).toLowerCase()) {
    throw new MomentCommerceError("APPLE_ACCOUNT_TOKEN_MISMATCH", "App Store account token does not match purchase", 400);
  }
  if (String(transaction.type ?? "") !== "Consumable") {
    throw new MomentCommerceError("APPLE_PRODUCT_TYPE_INVALID", "Birdie Moment digital edition must be a consumable IAP", 400);
  }
  if (Number(transaction.quantity ?? 1) !== 1) {
    throw new MomentCommerceError("APPLE_QUANTITY_INVALID", "Birdie Moment purchase quantity must be one", 400);
  }
  if (transaction.revocationDate !== undefined && transaction.revocationDate !== null) {
    throw new MomentCommerceError("APPLE_TRANSACTION_REVOKED", "App Store transaction has been revoked", 403);
  }

  const digitalAsset = moment.digitalAsset ?? moment.digital_asset;
  if (!digitalAsset) {
    throw new MomentCommerceError("DIGITAL_ASSET_NOT_READY", "Digital asset is not ready", 409);
  }

  const paidAt = now();
  const result = await repo.confirmAppStorePaidPurchase({
    purchaseId: purchase.id,
    transactionId,
    originalTransactionId: transaction.originalTransactionId ?? null,
    appStoreProductId: transaction.productId,
    appAccountToken: transaction.appAccountToken,
    environment: transaction.environment ?? null,
    quantity: Number(transaction.quantity ?? 1),
    providerPriceMilliunits: Number.isInteger(transaction.price) ? transaction.price : null,
    providerCurrency: typeof transaction.currency === "string" ? transaction.currency : null,
    purchaseDateMs: Number.isFinite(transaction.purchaseDate) ? transaction.purchaseDate : null,
    signedDateMs: Number.isFinite(transaction.signedDate) ? transaction.signedDate : null,
    paymentReference: transactionId,
    paymentStatus: PAYMENT_STATUS.PAID,
    entitlementGrantedAt: paidAt,
    fulfillmentStatus: "READY",
    processedAt: paidAt,
    updatedAt: paidAt
  });

  if (result?.duplicate === true) {
    return {
      processed: true,
      duplicate: true,
      status: PAYMENT_STATUS.PAID,
      purchaseId: purchase.id,
      downloadHref: `/moments/${encodeURIComponent(moment.id)}/download`
    };
  }

  await emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED, {
    userId: authUserId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    productType: purchase.productType,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
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
    transactionId,
    entitlementGrantedAt: paidAt,
    downloadHref: `/moments/${encodeURIComponent(moment.id)}/download`
  };
}
