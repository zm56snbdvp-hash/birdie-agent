import test from "node:test";
import assert from "node:assert/strict";
import { startPrintCheckout } from "../src/moments/print/checkout.mjs";
import { submitPaidPrintOrder } from "../src/moments/print/fulfillment.mjs";
import { handlePrintProviderWebhook } from "../src/moments/print/webhook.mjs";
import { handlePaymentWebhook } from "../src/moments/commerce/payment-webhook.mjs";

const moment = { id: "m1", userId: "u1", roundId: "r1", momentType: "ROUND", printAsset: "private://print.svg", digitalAsset: "private://digital.svg" };
const catalog = { PRINT_A3: { amountMinor: 3490, currency: "EUR" } };
const address = { recipientName: "Kevin Test", line1: "Teststr. 1", postalCode: "12345", city: "Berlin", countryCode: "DE" };

function baseRepo() {
  let purchase = null;
  let order = null;
  const events = new Set();
  return {
    get purchase() { return purchase; }, get order() { return order; },
    async getMoment(id) { return id === "m1" ? moment : null; },
    async ensurePurchase(input) { purchase ??= { id: "p1", ...input, shippingAddress: input.shippingAddress }; return purchase; },
    async attachPaymentReference({ paymentReference }) { purchase.paymentReference = paymentReference; },
    async getPurchase(id) { return id === "p1" ? purchase : null; },
    async getPurchaseByPaymentReference(ref) { return purchase?.paymentReference === ref ? purchase : null; },
    async confirmPaidPurchase(input) { if (purchase._paidEvent === input.providerEventId) return { duplicate: true }; purchase._paidEvent = input.providerEventId; Object.assign(purchase, { paymentStatus: input.paymentStatus, entitlementGrantedAt: input.entitlementGrantedAt, fulfillmentStatus: input.fulfillmentStatus }); return { duplicate: false }; },
    async getPrintOrderByPurchaseId(id) { return order?.purchaseId === id ? order : null; },
    async ensurePrintOrder(input) { order ??= { id: "o1", ...input }; return order; },
    async markPrintOrderSubmitted(input) { Object.assign(order, { providerOrderId: input.providerOrderId, status: input.status }); purchase.fulfillmentStatus = input.fulfillmentStatus; return order; },
    async markPrintOrderFailed(input) { Object.assign(order, { status: input.status, failureCode: input.failureCode }); purchase.fulfillmentStatus = input.fulfillmentStatus; },
    async claimPrintProviderEvent(input) { const key = `${input.providerName}:${input.providerEventId}`; if (events.has(key)) return { duplicate: true }; events.add(key); return { duplicate: false }; },
    async getPrintOrderByProviderOrderId(name, id) { return order?.providerName === name && order?.providerOrderId === id ? order : null; },
    async updatePrintOrderStatus(input) { order.status = input.status; purchase.fulfillmentStatus = input.fulfillmentStatus; return order; }
  };
}

const paymentProvider = {
  async createCheckoutSession() { return { paymentReference: "pay1", checkoutUrl: "https://checkout.test/1" }; },
  async verifyWebhook() { return { id: "evt-pay-1", type: "PAYMENT_SUCCEEDED", paymentReference: "pay1", paid: true, amountMinor: 3490, currency: "EUR", metadata: { user_id: "u1", round_id: "r1", moment_id: "m1", product_type: "PRINT_A3", fulfillment_type: "PRINT" } }; }
};

function printProvider(counter = { creates: 0 }) {
  return {
    name: "TEST_PRINT",
    async validateProduct() { return true; },
    async createOrder({ idempotencyKey }) { counter.creates += 1; assert.equal(idempotencyKey, "birdie-moment-print:p1"); return { id: "provider-o1" }; },
    async handleWebhook() { return { id: "evt-print-1", providerOrderId: "provider-o1", type: "SHIPPED", trackingReference: "track1" }; }
  };
}

test("print checkout uses server catalog price and PRINT metadata", async () => {
  const repo = baseRepo();
  const result = await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog, successUrl: "ok", cancelUrl: "no" });
  assert.equal(result.status, "CHECKOUT_READY");
  assert.equal(repo.purchase.amountMinor, 3490);
  assert.equal(repo.purchase.fulfillmentType, "PRINT");
});

test("incomplete address fails before checkout", async () => {
  await assert.rejects(startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: {}, repo: baseRepo(), paymentProvider, catalog }), e => e.code === "PRINT_ADDRESS_INCOMPLETE");
});

test("paid print webhook grants no digital entitlement", async () => {
  const repo = baseRepo();
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  const result = await handlePaymentWebhook({ rawBody: "x", signature: "s", paymentProvider, repo });
  assert.equal(result.fulfillmentStatus, "AWAITING_ORDER");
  assert.equal(result.entitlementGrantedAt, null);
});

test("unpaid print purchase cannot create provider order", async () => {
  const repo = baseRepo();
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  await assert.rejects(submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: printProvider() }), e => e.code === "PRINT_PAYMENT_REQUIRED");
});

test("paid print purchase creates exactly one provider order", async () => {
  const repo = baseRepo(); const counter = { creates: 0 }; const provider = printProvider(counter);
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  await handlePaymentWebhook({ rawBody: "x", signature: "s", paymentProvider, repo });
  const first = await submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: provider });
  const second = await submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: provider });
  assert.equal(first.submitted, true); assert.equal(second.duplicate, true); assert.equal(counter.creates, 1);
});

test("provider create failure becomes FULFILLMENT_FAILED without second order", async () => {
  const repo = baseRepo();
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  await handlePaymentWebhook({ rawBody: "x", signature: "s", paymentProvider, repo });
  const provider = { name: "TEST_PRINT", async validateProduct(){}, async createOrder(){ throw new Error("down"); } };
  const result = await submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: provider });
  assert.equal(result.status, "FULFILLMENT_FAILED"); assert.equal(repo.purchase.fulfillmentStatus, "FULFILLMENT_FAILED");
});

test("print provider webhook updates order status", async () => {
  const repo = baseRepo(); const provider = printProvider();
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  await handlePaymentWebhook({ rawBody: "x", signature: "s", paymentProvider, repo });
  await submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: provider });
  const result = await handlePrintProviderWebhook({ rawBody: "x", signature: "s", repo, printProvider: provider });
  assert.equal(result.status, "SHIPPED"); assert.equal(repo.purchase.fulfillmentStatus, "SHIPPED");
});

test("duplicate provider webhook is idempotent", async () => {
  const repo = baseRepo(); const provider = printProvider();
  await startPrintCheckout({ authUserId: "u1", momentId: "m1", shippingAddress: address, repo, paymentProvider, catalog });
  await handlePaymentWebhook({ rawBody: "x", signature: "s", paymentProvider, repo });
  await submitPaidPrintOrder({ purchaseId: "p1", repo, printProvider: provider });
  await handlePrintProviderWebhook({ rawBody: "x", signature: "s", repo, printProvider: provider });
  const again = await handlePrintProviderWebhook({ rawBody: "x", signature: "s", repo, printProvider: provider });
  assert.equal(again.duplicate, true);
});
