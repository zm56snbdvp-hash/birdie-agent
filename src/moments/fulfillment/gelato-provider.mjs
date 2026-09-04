export class PrintFulfillmentError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "PrintFulfillmentError";
    this.code = code;
    this.details = details;
  }
}

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new PrintFulfillmentError("PROVIDER_NOT_CONFIGURED", `${name} is required`);
  return text;
}

function validateAddress(address) {
  const needed = ["firstName", "lastName", "addressLine1", "city", "postCode", "country", "email"];
  const missing = needed.filter((key) => !String(address?.[key] ?? "").trim());
  if (missing.length) {
    throw new PrintFulfillmentError("SHIPPING_ADDRESS_INVALID", `Missing shipping fields: ${missing.join(", ")}`);
  }
  return address;
}

async function jsonOrThrow(response, code) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PrintFulfillmentError(code, `Gelato HTTP ${response.status}`, body);
  return body;
}

export function createGelatoPrintProvider({ apiKey, productUid, fetchImpl = globalThis.fetch }) {
  const key = required(apiKey, "Gelato API key");
  const a3ProductUid = required(productUid, "Gelato A3 portrait product UID");
  if (typeof fetchImpl !== "function") {
    throw new PrintFulfillmentError("PROVIDER_NOT_CONFIGURED", "fetch implementation is required");
  }

  const headers = Object.freeze({ "content-type": "application/json", "X-API-KEY": key });

  async function findOrderByReference(orderReferenceId) {
    const response = await fetchImpl("https://order.gelatoapis.com/v4/orders:search", {
      method: "POST",
      headers,
      body: JSON.stringify({ orderReferenceId, orderTypes: ["order"], limit: 10 })
    });
    const body = await jsonOrThrow(response, "PROVIDER_SEARCH_FAILED");
    const matches = (body?.orders ?? []).filter((order) => order.orderReferenceId === orderReferenceId);
    if (matches.length > 1) {
      throw new PrintFulfillmentError(
        "PROVIDER_ORDER_SPLIT_UNSUPPORTED",
        `Multiple Gelato orders exist for ${orderReferenceId}`,
        matches.map((order) => order.id)
      );
    }
    return matches[0] ?? null;
  }

  return Object.freeze({
    name: "GELATO",

    async validateProduct({ country }) {
      const iso = String(country ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(iso)) {
        throw new PrintFulfillmentError("COUNTRY_INVALID", "ISO-3166 alpha-2 country is required");
      }
      const response = await fetchImpl(
        `https://product.gelatoapis.com/v3/products/${encodeURIComponent(a3ProductUid)}`,
        { method: "GET", headers }
      );
      const product = await jsonOrThrow(response, "PRODUCT_VALIDATION_FAILED");
      const attributes = product?.attributes ?? {};
      if (attributes.PaperFormat !== "A3" || attributes.Orientation !== "ver" || product.isPrintable !== true) {
        throw new PrintFulfillmentError(
          "PRODUCT_NOT_A3_PORTRAIT",
          "Configured Gelato product is not printable A3 portrait",
          attributes
        );
      }
      if (Array.isArray(product.supportedCountries) && !product.supportedCountries.includes(iso)) {
        throw new PrintFulfillmentError("PRODUCT_NOT_AVAILABLE_IN_COUNTRY", `A3 product is not available in ${iso}`);
      }
      return { valid: true, provider: "GELATO", productUid: a3ProductUid };
    },

    async createOrder({ internalOrderId, purchaseId, momentId, userId, printAssetUrl, recipient }) {
      required(internalOrderId, "internalOrderId");
      required(purchaseId, "purchaseId");
      required(momentId, "momentId");
      required(userId, "userId");
      required(printAssetUrl, "printAssetUrl");
      validateAddress(recipient);

      // Stable internal order id is the provider recovery/idempotency boundary.
      // Always search before POST create so a crash after provider acceptance can
      // be reconciled instead of producing another physical order.
      const existing = await findOrderByReference(internalOrderId);
      if (existing) {
        return {
          providerOrderReference: existing.id,
          recovered: true,
          status: existing.fulfillmentStatus ?? null
        };
      }

      const response = await fetchImpl("https://order.gelatoapis.com/v4/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderType: "order",
          orderReferenceId: internalOrderId,
          customerReferenceId: userId,
          currency: "EUR",
          items: [{
            itemReferenceId: `${purchaseId}:A3`,
            productUid: a3ProductUid,
            files: [{ type: "default", url: printAssetUrl }],
            quantity: 1
          }],
          shippingAddress: recipient,
          metadata: [
            { key: "purchase_id", value: String(purchaseId) },
            { key: "moment_id", value: String(momentId) },
            { key: "size", value: "A3" }
          ]
        })
      });
      const order = await jsonOrThrow(response, "PROVIDER_CREATE_FAILED");
      if (!order?.id) {
        throw new PrintFulfillmentError("PROVIDER_CREATE_FAILED", "Gelato returned no order id", order);
      }
      return {
        providerOrderReference: order.id,
        recovered: false,
        status: order.fulfillmentStatus ?? null
      };
    },

    async getOrderStatus(providerOrderReference) {
      const id = required(providerOrderReference, "providerOrderReference");
      const response = await fetchImpl(
        `https://order.gelatoapis.com/v4/orders/${encodeURIComponent(id)}`,
        { method: "GET", headers }
      );
      const order = await jsonOrThrow(response, "PROVIDER_STATUS_FAILED");
      return {
        providerOrderReference: order.id,
        orderReferenceId: order.orderReferenceId ?? null,
        fulfillmentStatus: order.fulfillmentStatus ?? null,
        financialStatus: order.financialStatus ?? null,
        connectedOrderIds: order.connectedOrderIds ?? []
      };
    },

    async handleWebhook(eventOrEnvelope) {
      const event = eventOrEnvelope?.body ?? eventOrEnvelope;
      if (!event || typeof event.id !== "string" || typeof event.event !== "string") {
        throw new PrintFulfillmentError("WEBHOOK_INVALID", "Gelato webhook event id/type are required");
      }
      return {
        provider: "GELATO",
        eventId: event.id,
        eventType: event.event,
        providerOrderReference: event.orderId ?? null,
        internalOrderId: event.orderReferenceId ?? null,
        claimedStatus: event.fulfillmentStatus ?? event.status ?? null
      };
    }
  });
}
