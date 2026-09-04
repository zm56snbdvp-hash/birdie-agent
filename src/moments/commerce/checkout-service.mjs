import { MOMENT_STATUS } from "../contracts.mjs";
import { FULFILLMENT_TYPE, getProduct } from "./catalog.mjs";
import { assertOwnership } from "./security.mjs";
import { assertPaymentProvider } from "./provider-contract.mjs";

export class MomentCheckoutError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.name = "MomentCheckoutError";
    this.code = code;
    this.status = status;
  }
}

const PURCHASABLE = new Set([
  MOMENT_STATUS.PREVIEW_READY,
  MOMENT_STATUS.PURCHASED,
  MOMENT_STATUS.FULFILLED
]);

function requireAuth(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new MomentCheckoutError("AUTH_REQUIRED", 401);
  }
  return userId.trim();
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentCheckoutError("IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  const key = value.trim();
  if (key.length > 160) throw new MomentCheckoutError("IDEMPOTENCY_KEY_INVALID", 400);
  return key;
}

function normalizeShippingAddress(address) {
  if (!address || typeof address !== "object") {
    throw new MomentCheckoutError("SHIPPING_ADDRESS_REQUIRED", 400);
  }
  const required = ["firstName", "lastName", "addressLine1", "city", "postCode", "country", "email"];
  const missing = required.filter((field) => typeof address[field] !== "string" || !address[field].trim());
  if (missing.length) throw new MomentCheckoutError("SHIPPING_ADDRESS_INCOMPLETE", 400);
  const country = address.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new MomentCheckoutError("SHIPPING_COUNTRY_INVALID", 400);
  return Object.freeze({
    firstName: address.firstName.trim(),
    lastName: address.lastName.trim(),
    company: typeof address.company === "string" && address.company.trim() ? address.company.trim() : null,
    addressLine1: address.addressLine1.trim(),
    addressLine2: typeof address.addressLine2 === "string" && address.addressLine2.trim() ? address.addressLine2.trim() : null,
    city: address.city.trim(),
    state: typeof address.state === "string" && address.state.trim() ? address.state.trim() : null,
    postCode: address.postCode.trim(),
    country,
    email: address.email.trim(),
    phone: typeof address.phone === "string" && address.phone.trim() ? address.phone.trim() : null
  });
}

function assetFor(moment, fulfillmentType) {
  return fulfillmentType === FULFILLMENT_TYPE.DIGITAL
    ? (moment.digitalAsset ?? moment.digital_asset)
    : (moment.printAsset ?? moment.print_asset);
}

function isAlreadyOwned(purchase) {
  if (!purchase || purchase.paymentStatus !== "PAID") return false;
  return ["AWAITING_ORDER", "FULFILLING", "FULFILLED"].includes(purchase.fulfillmentStatus);
}

function publicPurchase(purchase) {
  if (!purchase) return null;
  return Object.freeze({
    id: purchase.id,
    momentId: purchase.momentId ?? purchase.moment_id,
    productType: purchase.productType ?? purchase.product_type,
    paymentStatus: purchase.paymentStatus ?? purchase.payment_status,
    fulfillmentType: purchase.fulfillmentType ?? purchase.fulfillment_type,
    fulfillmentStatus: purchase.fulfillmentStatus ?? purchase.fulfillment_status,
    amount: purchase.amount,
    currency: purchase.currency
  });
}

function metadataFor({ purchaseId, userId, moment, product }) {
  return Object.freeze({
    user_id: userId,
    round_id: String(moment.roundId ?? moment.round_id),
    moment_id: String(moment.id),
    purchase_id: purchaseId,
    product_type: product.sku,
    fulfillment_type: product.fulfillmentType
  });
}

async function createProviderCheckout({
  provider,
  repo,
  purchase,
  moment,
  product,
  userId,
  idempotencyKey,
  successUrl,
  cancelUrl,
  now
}) {
  let checkout;
  try {
    checkout = await provider.createCheckoutSession({
      amountMinor: product.amountMinor,
      currency: product.currency,
      metadata: metadataFor({ purchaseId: purchase.id, userId, moment, product }),
      successUrl,
      cancelUrl,
      idempotencyKey: `${userId}:${idempotencyKey}`
    });
  } catch {
    await repo.markPurchasePaymentFailed?.({
      purchaseId: purchase.id,
      reason: "CHECKOUT_CREATION_FAILED",
      updatedAt: now()
    });
    throw new MomentCheckoutError("CHECKOUT_CREATION_FAILED", 502);
  }

  if (!checkout?.checkoutReference || !checkout?.redirectUrl) {
    await repo.markPurchasePaymentFailed?.({
      purchaseId: purchase.id,
      reason: "INVALID_PROVIDER_CHECKOUT",
      updatedAt: now()
    });
    throw new MomentCheckoutError("INVALID_PROVIDER_CHECKOUT", 502);
  }

  await repo.attachCheckout({
    purchaseId: purchase.id,
    checkoutReference: checkout.checkoutReference,
    checkoutUrl: checkout.redirectUrl,
    updatedAt: now()
  });
  return checkout;
}

export async function startMomentCheckout({
  momentId,
  authenticatedUserId,
  sku,
  idempotencyKey,
  successUrl,
  cancelUrl,
  shippingAddress = null,
  repo,
  paymentProvider,
  analytics = null,
  now = () => new Date().toISOString(),
  createId = () => crypto.randomUUID()
}) {
  const userId = requireAuth(authenticatedUserId);
  const key = requireIdempotencyKey(idempotencyKey);
  const provider = assertPaymentProvider(paymentProvider);
  const product = getProduct(sku);
  const moment = assertOwnership(await repo.getMoment(momentId), userId, "moment");

  if (moment.momentType !== product.momentType) {
    throw new MomentCheckoutError("SKU_MOMENT_MISMATCH", 409);
  }
  if (!PURCHASABLE.has(moment.status)) {
    throw new MomentCheckoutError("MOMENT_NOT_PURCHASABLE", 409);
  }
  if (!assetFor(moment, product.fulfillmentType)) {
    throw new MomentCheckoutError(
      product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL ? "DIGITAL_ASSET_NOT_READY" : "PRINT_ASSET_NOT_READY",
      409
    );
  }

  const normalizedAddress = product.fulfillmentType === FULFILLMENT_TYPE.PRINT
    ? normalizeShippingAddress(shippingAddress)
    : null;

  const existingEntitlement = await repo.getPurchaseForProduct?.({
    userId,
    momentId: moment.id,
    productType: product.sku,
    fulfillmentType: product.fulfillmentType
  });
  if (isAlreadyOwned(existingEntitlement)) {
    return { alreadyPurchased: true, purchase: publicPurchase(existingEntitlement) };
  }

  const previous = await repo.findPurchaseByIdempotencyKey({ userId, idempotencyKey: key });
  if (previous) {
    if ((previous.momentId ?? previous.moment_id) !== moment.id) {
      throw new MomentCheckoutError("IDEMPOTENCY_KEY_CONFLICT", 409);
    }
    if ((previous.productType ?? previous.product_type) !== product.sku) {
      throw new MomentCheckoutError("IDEMPOTENCY_KEY_CONFLICT", 409);
    }
    if ((previous.paymentProvider ?? previous.payment_provider) !== provider.name) {
      throw new MomentCheckoutError("PAYMENT_PROVIDER_MISMATCH", 409);
    }
    if (isAlreadyOwned(previous)) {
      return { alreadyPurchased: true, idempotent: true, purchase: publicPurchase(previous) };
    }
    if ((previous.paymentStatus ?? previous.payment_status) === "FAILED") {
      throw new MomentCheckoutError("PAYMENT_ATTEMPT_FAILED", 409);
    }
    const previousUrl = previous.checkoutUrl ?? previous.checkout_url ?? null;
    if (previousUrl) {
      return {
        alreadyPurchased: false,
        idempotent: true,
        checkoutUrl: previousUrl,
        purchase: publicPurchase(previous)
      };
    }

    const checkout = await createProviderCheckout({
      provider,
      repo,
      purchase: previous,
      moment,
      product,
      userId,
      idempotencyKey: key,
      successUrl,
      cancelUrl,
      now
    });
    return {
      alreadyPurchased: false,
      idempotent: true,
      recoveredCheckout: true,
      checkoutUrl: checkout.redirectUrl,
      purchase: publicPurchase(previous)
    };
  }

  const timestamp = now();
  const purchase = {
    id: createId(),
    userId,
    momentId: moment.id,
    productType: product.sku,
    paymentProvider: provider.name,
    paymentStatus: "PENDING",
    amount: product.amountMinor,
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
    fulfillmentStatus: "PENDING",
    shippingAddress: normalizedAddress,
    idempotencyKey: key,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await repo.createPurchase(purchase);

  await analytics?.track?.(
    product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL ? "digital_purchase_started" : "print_purchase_started",
    { userId, roundId: moment.roundId, momentId: moment.id, sku: product.sku, amountMinor: product.amountMinor, currency: product.currency }
  );

  const checkout = await createProviderCheckout({
    provider,
    repo,
    purchase,
    moment,
    product,
    userId,
    idempotencyKey: key,
    successUrl,
    cancelUrl,
    now
  });

  return {
    alreadyPurchased: false,
    idempotent: false,
    checkoutUrl: checkout.redirectUrl,
    purchase: publicPurchase(purchase)
  };
}

function verifyMoney(event, purchase) {
  return Number(event.amountMinor) === Number(purchase.amount)
    && String(event.currency || "").toUpperCase() === String(purchase.currency || "").toUpperCase();
}

function verifyMetadata(event, purchase, moment) {
  const metadata = event.metadata ?? {};
  return metadata.purchase_id === purchase.id
    && metadata.user_id === purchase.userId
    && metadata.round_id === String(moment.roundId ?? moment.round_id)
    && metadata.moment_id === String(moment.id)
    && metadata.product_type === purchase.productType
    && metadata.fulfillment_type === purchase.fulfillmentType;
}

export async function handleMomentPaymentWebhook({
  rawBody,
  headers,
  repo,
  paymentProvider,
  printFulfillment = null,
  analytics = null,
  now = () => new Date().toISOString()
}) {
  const provider = assertPaymentProvider(paymentProvider);
  let event;
  try {
    event = await provider.verifyWebhook({ rawBody, headers });
  } catch {
    throw new MomentCheckoutError("INVALID_PAYMENT_WEBHOOK", 400);
  }
  if (!event?.eventId) throw new MomentCheckoutError("INVALID_PAYMENT_EVENT", 400);
  if (event.type === "IGNORED") return { accepted: true, ignored: true };

  const purchase = await repo.getPurchaseByCheckoutReference({
    provider: provider.name,
    checkoutReference: event.checkoutReference
  });
  if (!purchase) throw new MomentCheckoutError("PURCHASE_NOT_FOUND", 404);
  const moment = await repo.getMoment(purchase.momentId ?? purchase.moment_id);
  if (!moment || moment.userId !== purchase.userId) {
    throw new MomentCheckoutError("PAYMENT_INTEGRITY_MISMATCH", 409);
  }
  if (!verifyMoney(event, purchase) || !verifyMetadata(event, purchase, moment)) {
    throw new MomentCheckoutError("PAYMENT_INTEGRITY_MISMATCH", 409);
  }

  const first = await repo.claimPaymentEvent({
    provider: provider.name,
    eventId: event.eventId,
    eventType: event.type,
    purchaseId: purchase.id,
    processedAt: now()
  });
  if (!first) return { accepted: true, idempotent: true, purchase: publicPurchase(purchase) };

  if (event.type === "PAYMENT_FAILED") {
    await repo.markPurchasePaymentFailed({
      purchaseId: purchase.id,
      paymentReference: event.paymentReference ?? null,
      reason: event.failureCode ?? "PAYMENT_FAILED",
      updatedAt: now()
    });
    return { accepted: true, paid: false };
  }
  if (event.type !== "PAYMENT_SUCCEEDED") return { accepted: true, ignored: true };

  const product = getProduct(purchase.productType);
  if (!assetFor(moment, product.fulfillmentType)) {
    throw new MomentCheckoutError("FULFILLMENT_ASSET_NOT_READY", 409);
  }

  let updatedPurchase;
  if (product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL) {
    updatedPurchase = await repo.markPurchasePaidAndFulfilled({
      purchaseId: purchase.id,
      paymentReference: event.paymentReference,
      fulfillmentReference: `digital:${purchase.id}`,
      paidAt: now(),
      updatedAt: now()
    });
    await repo.setMomentStatus?.(moment.id, MOMENT_STATUS.PURCHASED);
    await analytics?.track?.("digital_purchase_completed", {
      userId: purchase.userId,
      roundId: moment.roundId,
      momentId: moment.id,
      sku: product.sku,
      amountMinor: product.amountMinor,
      currency: product.currency
    });
  } else {
    if (!purchase.shippingAddress) throw new MomentCheckoutError("SHIPPING_ADDRESS_REQUIRED", 409);
    updatedPurchase = await repo.markPurchasePaidAwaitingOrder({
      purchaseId: purchase.id,
      paymentReference: event.paymentReference,
      paidAt: now(),
      updatedAt: now()
    });
    await repo.setMomentStatus?.(moment.id, MOMENT_STATUS.PURCHASED);
    await analytics?.track?.("print_purchase_completed", {
      userId: purchase.userId,
      roundId: moment.roundId,
      momentId: moment.id,
      sku: product.sku,
      amountMinor: product.amountMinor,
      currency: product.currency
    });
    if (printFulfillment?.createOrderForPaidPurchase) {
      await printFulfillment.createOrderForPaidPurchase(purchase.id);
    }
  }

  return { accepted: true, paid: true, purchase: publicPurchase(updatedPurchase ?? purchase) };
}

export async function getDigitalEntitlement({ momentId, authenticatedUserId, repo }) {
  const userId = requireAuth(authenticatedUserId);
  const moment = assertOwnership(await repo.getMoment(momentId), userId, "moment");
  const products = Object.values((await import("./catalog.mjs")).MOMENT_PRODUCTS)
    .filter((product) => product.momentType === moment.momentType && product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL);
  const product = products[0];
  if (!product) throw new MomentCheckoutError("DIGITAL_PRODUCT_NOT_CONFIGURED", 503);
  const purchase = await repo.getPurchaseForProduct({
    userId,
    momentId: moment.id,
    productType: product.sku,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL
  });
  return { entitled: isAlreadyOwned(purchase), purchase: publicPurchase(purchase) };
}

export async function getDigitalDownload({ momentId, authenticatedUserId, repo, assetGateway }) {
  const userId = requireAuth(authenticatedUserId);
  const moment = assertOwnership(await repo.getMoment(momentId), userId, "moment");
  const products = Object.values((await import("./catalog.mjs")).MOMENT_PRODUCTS)
    .filter((product) => product.momentType === moment.momentType && product.fulfillmentType === FULFILLMENT_TYPE.DIGITAL);
  const product = products[0];
  const purchase = await repo.getPurchaseForProduct({
    userId,
    momentId: moment.id,
    productType: product.sku,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL
  });
  if (!isAlreadyOwned(purchase)) throw new MomentCheckoutError("DIGITAL_PURCHASE_REQUIRED", 402);
  const asset = assetFor(moment, FULFILLMENT_TYPE.DIGITAL);
  if (!asset) throw new MomentCheckoutError("DIGITAL_ASSET_NOT_READY", 409);
  if (!assetGateway?.getAuthorizedDigitalUrl) {
    throw new MomentCheckoutError("DOWNLOAD_GATEWAY_NOT_CONFIGURED", 503);
  }
  const downloadUrl = await assetGateway.getAuthorizedDigitalUrl({
    momentId: moment.id,
    purchaseId: purchase.id,
    digitalAsset: asset,
    userId
  });
  if (!downloadUrl) throw new MomentCheckoutError("DOWNLOAD_URL_UNAVAILABLE", 503);
  return { downloadUrl, purchase: publicPurchase(purchase) };
}
