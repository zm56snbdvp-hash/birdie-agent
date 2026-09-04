import { MomentCommerceError } from "../commerce/contracts.mjs";

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentCommerceError("GELATO_NOT_CONFIGURED", `${name} is required`, 503);
  }
  return value.trim();
}

async function jsonOrThrow(response, code) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MomentCommerceError(code, `Gelato HTTP ${response.status}`, 502);
  }
  return body;
}

function recipientParts(address) {
  if (address?.firstName && address?.lastName) {
    return { firstName: address.firstName, lastName: address.lastName };
  }
  const parts = String(address?.recipientName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    throw new MomentCommerceError("GELATO_RECIPIENT_NAME_INVALID", "Gelato requires first and last name", 400);
  }
  return { firstName: parts.shift(), lastName: parts.join(" ") };
}

function gelatoAddress(address) {
  const { firstName, lastName } = recipientParts(address);
  const email = requireText(address?.email, "Gelato recipient email");
  return {
    firstName,
    lastName,
    companyName: address.company || undefined,
    addressLine1: address.line1,
    addressLine2: address.line2 || undefined,
    city: address.city,
    postCode: address.postalCode,
    state: address.region || undefined,
    country: address.countryCode,
    email
  };
}

function normalizeGelatoStatus(status) {
  switch (status) {
    case "created":
    case "uploading":
    case "passed": return "ORDER_ACCEPTED";
    case "in_production":
    case "printed": return "IN_PRODUCTION";
    case "shipped":
    case "in_transit": return "SHIPPED";
    case "delivered": return "DELIVERED";
    case "failed":
    case "returned":
    case "on_hold":
    case "not_connected": return "FAILED";
    case "canceled": return "CANCELLED";
    default: return null;
  }
}

function firstTrackingReference(event) {
  for (const item of event?.items ?? []) {
    for (const fulfillment of item?.fulfillments ?? []) {
      if (fulfillment?.trackingUrl) return fulfillment.trackingUrl;
      if (fulfillment?.trackingCode) return fulfillment.trackingCode;
    }
  }
  return null;
}

export function createGelatoPrintProvider({
  apiKey,
  productUid,
  assetSigner,
  webhookVerifier,
  fetchImpl = globalThis.fetch,
  assetUrlTtlSeconds = 1800
}) {
  const key = requireText(apiKey, "Gelato API key");
  const a3ProductUid = requireText(productUid, "Gelato A3 product UID");
  if (typeof fetchImpl !== "function") throw new MomentCommerceError("GELATO_NOT_CONFIGURED", "fetch implementation is required", 503);
  if (!assetSigner || typeof assetSigner.createSignedReadUrl !== "function") {
    throw new MomentCommerceError("GELATO_NOT_CONFIGURED", "private print asset signer is required", 503);
  }

  const headers = { "content-type": "application/json", "X-API-KEY": key };

  async function findOrderByReference(orderReferenceId) {
    const response = await fetchImpl("https://order.gelatoapis.com/v4/orders:search", {
      method: "POST",
      headers,
      body: JSON.stringify({ orderReferenceId, orderTypes: ["order"], limit: 10 })
    });
    const body = await jsonOrThrow(response, "GELATO_ORDER_SEARCH_FAILED");
    const matches = (body?.orders ?? []).filter((order) => String(order.orderReferenceId) === String(orderReferenceId));
    if (matches.length > 1) {
      throw new MomentCommerceError("GELATO_DUPLICATE_ORDER", `Multiple Gelato orders exist for ${orderReferenceId}`, 409);
    }
    return matches[0] ?? null;
  }

  return Object.freeze({
    name: "GELATO",

    async validateProduct({ format, countryCode }) {
      if (format !== "A3_PORTRAIT_300DPI") {
        throw new MomentCommerceError("GELATO_FORMAT_UNSUPPORTED", "Gelato provider supports only A3 portrait in Birdie Moments v1", 400);
      }
      const response = await fetchImpl(`https://product.gelatoapis.com/v3/products/${encodeURIComponent(a3ProductUid)}`, {
        method: "GET",
        headers
      });
      const product = await jsonOrThrow(response, "GELATO_PRODUCT_VALIDATION_FAILED");
      if (product?.attributes?.PaperFormat !== "A3" || product?.attributes?.Orientation !== "ver" || product?.isPrintable !== true) {
        throw new MomentCommerceError("GELATO_PRODUCT_NOT_A3_PORTRAIT", "Configured Gelato product is not printable A3 portrait", 503);
      }
      if (countryCode && Array.isArray(product.supportedCountries) && !product.supportedCountries.includes(countryCode)) {
        throw new MomentCommerceError("GELATO_PRODUCT_COUNTRY_UNAVAILABLE", `Configured A3 product is not available in ${countryCode}`, 409);
      }
      return { valid: true, productUid: a3ProductUid };
    },

    async createOrder({ idempotencyKey, printAsset, format, address, metadata }) {
      const orderReferenceId = requireText(idempotencyKey, "Gelato order reference");
      const existing = await findOrderByReference(orderReferenceId);
      if (existing) return { id: existing.id, status: existing.fulfillmentStatus, recovered: true };

      if (format !== "A3_PORTRAIT_300DPI") {
        throw new MomentCommerceError("GELATO_FORMAT_UNSUPPORTED", "Only A3 portrait may be ordered", 400);
      }

      const fileUrl = await assetSigner.createSignedReadUrl({
        assetRef: printAsset,
        expiresInSeconds: assetUrlTtlSeconds
      });
      if (typeof fileUrl !== "string" || !fileUrl) {
        throw new MomentCommerceError("GELATO_ASSET_URL_FAILED", "Could not authorize Gelato print asset", 503);
      }

      const purchaseId = requireText(metadata?.purchase_id, "purchase_id");
      const userId = requireText(metadata?.user_id, "user_id");
      const momentId = requireText(metadata?.moment_id, "moment_id");

      const response = await fetchImpl("https://order.gelatoapis.com/v4/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderType: "order",
          orderReferenceId,
          customerReferenceId: userId,
          currency: "EUR",
          items: [{
            itemReferenceId: `${purchaseId}:A3`,
            productUid: a3ProductUid,
            files: [{ type: "default", url: fileUrl }],
            quantity: 1
          }],
          shippingAddress: gelatoAddress(address),
          metadata: [
            { key: "purchase_id", value: purchaseId },
            { key: "moment_id", value: momentId },
            { key: "size", value: "A3" }
          ]
        })
      });
      const order = await jsonOrThrow(response, "GELATO_ORDER_CREATE_FAILED");
      if (!order?.id) throw new MomentCommerceError("GELATO_ORDER_CREATE_FAILED", "Gelato returned no order id", 502);
      return { id: order.id, status: order.fulfillmentStatus, recovered: false };
    },

    async getOrderStatus(providerOrderId) {
      const response = await fetchImpl(`https://order.gelatoapis.com/v4/orders/${encodeURIComponent(providerOrderId)}`, {
        method: "GET",
        headers
      });
      const order = await jsonOrThrow(response, "GELATO_ORDER_STATUS_FAILED");
      return {
        id: order.id,
        status: normalizeGelatoStatus(order.fulfillmentStatus),
        providerStatus: order.fulfillmentStatus,
        financialStatus: order.financialStatus
      };
    },

    async handleWebhook({ rawBody, signature }) {
      if (typeof webhookVerifier !== "function") {
        throw new MomentCommerceError("GELATO_WEBHOOK_VERIFIER_NOT_CONFIGURED", "Gelato webhook verifier must be configured before runtime activation", 503);
      }
      const event = await webhookVerifier({ rawBody, signature });
      if (!event?.id || !event?.orderId || !event?.event) {
        throw new MomentCommerceError("GELATO_WEBHOOK_INVALID", "Verified Gelato webhook is incomplete", 400);
      }
      const type = normalizeGelatoStatus(event.fulfillmentStatus);
      if (!type) {
        return { id: event.id, providerOrderId: event.orderId, type: "IGNORED", providerStatus: event.fulfillmentStatus };
      }
      return {
        id: event.id,
        providerOrderId: event.orderId,
        type,
        providerStatus: event.fulfillmentStatus,
        trackingReference: firstTrackingReference(event),
        internalOrderId: event.orderReferenceId ?? null
      };
    }
  });
}
