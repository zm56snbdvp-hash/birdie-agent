import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_SKU } from "../src/moments/commerce/catalog.mjs";
import { createPrintFulfillmentService } from "../src/moments/fulfillment/print-service.mjs";

function fixture({ leaseAcquired = true } = {}) {
  const purchase = {
    id: "purchase-1",
    userId: "user-1",
    momentId: "moment-1",
    productType: PRODUCT_SKU.ROUND_A3,
    paymentStatus: "PAID",
    fulfillmentType: "PRINT",
    fulfillmentStatus: "AWAITING_ORDER",
    shippingAddress: {
      firstName: "Kevin", lastName: "Birdie", addressLine1: "Test 1",
      city: "Berlin", postCode: "10115", country: "DE", email: "k@example.test"
    }
  };
  const moment = {
    id: "moment-1", userId: "user-1", roundId: "round-1",
    printAsset: "private://print.svg"
  };
  const events = new Set();
  const order = {
    id: "print-order-1", purchaseId: purchase.id, momentId: moment.id,
    provider: "GELATO", providerOrderReference: null, status: "PENDING_SUBMISSION"
  };
  return {
    purchase,
    moment,
    order,
    repo: {
      async getPurchase() { return purchase; },
      async getMoment() { return moment; },
      async claimPrintOrder() { return { created: true, order }; },
      async claimPrintSubmission() { return { acquired: leaseAcquired }; },
      async attachProviderOrder(input) {
        order.providerOrderReference = input.providerOrderReference;
        order.status = input.status;
        return order;
      },
      async markPurchaseFulfillment({ status, reference = null }) {
        purchase.fulfillmentStatus = status;
        purchase.fulfillmentReference = reference;
      },
      async markPrintOrderFailed({ reason }) { order.failureReason = reason; },
      async hasProcessedWebhook(provider, eventId) { return events.has(`${provider}:${eventId}`); },
      async recordProcessedWebhook({ provider, eventId }) { events.add(`${provider}:${eventId}`); },
      async getPrintOrder(id) { return id === order.id ? order : null; },
      async updatePrintOrderFromWebhook(input) {
        order.providerOrderReference = input.providerOrderReference;
        order.status = input.status;
        order.providerStatus = input.providerStatus;
      },
      async setMomentStatus() {}
    }
  };
}

test("concurrent worker without submission lease never reaches provider create", async () => {
  const f = fixture({ leaseAcquired: false });
  let creates = 0;
  const service = createPrintFulfillmentService({
    repo: f.repo,
    provider: {
      name: "GELATO",
      async validateProduct() {},
      async createOrder() { creates += 1; },
      async handleWebhook() {},
      async getOrderStatus() {}
    },
    assetUrlSigner: { async signProviderAsset() { return "https://assets.test/print"; } }
  });
  const result = await service.createOrderForPaidPurchase(f.purchase.id);
  assert.equal(result.duplicatePrevented, true);
  assert.equal(result.inProgress, true);
  assert.equal(creates, 0);
});

test("webhook claimed status is ignored in favor of authenticated provider status", async () => {
  const f = fixture();
  f.order.providerOrderReference = "gelato-1";
  f.order.status = "SUBMITTED";
  f.purchase.fulfillmentStatus = "FULFILLING";

  const service = createPrintFulfillmentService({
    repo: f.repo,
    provider: {
      name: "GELATO",
      async handleWebhook() {
        return {
          provider: "GELATO", eventId: "event-1", eventType: "order_updated",
          providerOrderReference: "gelato-1", internalOrderId: f.order.id,
          claimedStatus: "shipped"
        };
      },
      async getOrderStatus() {
        return {
          providerOrderReference: "gelato-1",
          orderReferenceId: f.order.id,
          fulfillmentStatus: "returned"
        };
      }
    },
    assetUrlSigner: {}
  });

  const result = await service.handleWebhook({});
  assert.equal(result.status, "FULFILLMENT_FAILED");
  assert.equal(result.verifiedProviderStatus, "returned");
  assert.equal(f.purchase.fulfillmentStatus, "FULFILLMENT_FAILED");
});

test("provider orderReference mismatch fails closed before webhook state transition", async () => {
  const f = fixture();
  f.order.providerOrderReference = "gelato-1";
  f.purchase.fulfillmentStatus = "FULFILLING";

  const service = createPrintFulfillmentService({
    repo: f.repo,
    provider: {
      name: "GELATO",
      async handleWebhook() {
        return {
          provider: "GELATO", eventId: "event-integrity", eventType: "order_updated",
          providerOrderReference: "gelato-1", internalOrderId: f.order.id,
          claimedStatus: "delivered"
        };
      },
      async getOrderStatus() {
        return {
          providerOrderReference: "gelato-1",
          orderReferenceId: "different-internal-order",
          fulfillmentStatus: "delivered"
        };
      }
    },
    assetUrlSigner: {}
  });

  await assert.rejects(
    () => service.handleWebhook({}),
    (error) => error.code === "PRINT_PROVIDER_INTEGRITY_MISMATCH"
  );
  assert.equal(f.purchase.fulfillmentStatus, "FULFILLING");
  assert.equal(f.events?.size ?? 0, 0);
});
