import test from "node:test";
import assert from "node:assert/strict";
import { submitPaidPrintOrder } from "../src/moments/print/fulfillment.mjs";
import { MOMENT_ANALYTICS_EVENT } from "../src/moments/analytics/events.mjs";

const moment = {
  id: "m1",
  userId: "u1",
  roundId: "r1",
  momentType: "ROUND",
  printAsset: "private://print.svg"
};

const purchase = {
  id: "p1",
  userId: "u1",
  momentId: "m1",
  productType: "PRINT_A3",
  fulfillmentType: "PRINT",
  paymentStatus: "PAID",
  fulfillmentStatus: "AWAITING_ORDER",
  shippingAddress: {
    recipientName: "Kevin Test",
    line1: "Teststr. 1",
    postalCode: "12345",
    city: "Berlin",
    countryCode: "DE"
  }
};

test("provider create failure emits fulfillment_failed and preserves paid purchase", async () => {
  let order = null;
  const failures = [];
  const analyticsEvents = [];
  const repo = {
    async getPurchase(id) { return id === purchase.id ? purchase : null; },
    async getMoment(id) { return id === moment.id ? moment : null; },
    async getPrintOrderByPurchaseId() { return order; },
    async ensurePrintOrder(input) { order = { id: "o1", ...input }; return order; },
    async markPrintOrderFailed(input) {
      order.status = input.status;
      purchase.fulfillmentStatus = input.fulfillmentStatus;
    },
    async recordMomentFailure(failure) { failures.push(failure); }
  };
  const analytics = {
    async track(name, payload) { analyticsEvents.push({ name, payload }); }
  };
  const printProvider = {
    name: "TEST_PRINT",
    async validateProduct() {},
    async createOrder() { throw Object.assign(new Error("provider down"), { code: "PROVIDER_DOWN" }); }
  };

  const result = await submitPaidPrintOrder({
    purchaseId: purchase.id,
    repo,
    printProvider,
    analytics
  });

  assert.equal(result.status, "FULFILLMENT_FAILED");
  assert.equal(purchase.paymentStatus, "PAID");
  assert.equal(purchase.fulfillmentStatus, "FULFILLMENT_FAILED");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "PROVIDER_DOWN");
  assert.equal(analyticsEvents.length, 1);
  assert.equal(analyticsEvents[0].name, MOMENT_ANALYTICS_EVENT.FULFILLMENT_FAILED);
  assert.equal(analyticsEvents[0].payload.reason, "PROVIDER_DOWN");
});
