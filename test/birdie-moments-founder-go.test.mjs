import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderData, MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { processRoundCompleted } from "../src/moments/pipeline.mjs";
import { PRODUCT_SKU } from "../src/moments/commerce/catalog.mjs";
import { finalizeVerifiedPurchase, issueDigitalAssetAccess } from "../src/moments/commerce/purchases.mjs";
import { MomentAuthorizationError } from "../src/moments/commerce/security.mjs";
import { createGelatoPrintProvider } from "../src/moments/fulfillment/gelato-provider.mjs";
import { createPrintFulfillmentService } from "../src/moments/fulfillment/print-service.mjs";

function round(overrides = {}) {
  return {
    id: "round-1", userId: "user-1", displayName: "Kevin Birdie",
    courseName: "Golfpark Gudensberg", playedAt: "2026-09-04T23:30:00-10:00",
    totalScore: 82, holesPlayed: 18, birdieCount: 3, parCount: 8,
    scoreVsPar: 10, isCompleted: true, ...overrides
  };
}

function moment(overrides = {}) {
  const renderData = buildRenderData(round(), MOMENT_TYPE.ROUND);
  return {
    id: "moment-1", userId: "user-1", roundId: "round-1",
    momentType: MOMENT_TYPE.ROUND, renderData,
    digitalAsset: "private://digital.svg", printAsset: "private://print.svg",
    ...overrides
  };
}

function purchaseFixture({ paid = true, amountMinor = 690, sku = PRODUCT_SKU.ROUND_DIGITAL, fulfillment = "DIGITAL" } = {}) {
  const m = moment();
  const purchases = new Map();
  return {
    purchases,
    repo: {
      async getMoment(id) { return id === m.id ? m : null; },
      async ensurePurchase(input) {
        const existing = [...purchases.values()].find((x) => x.paymentReference === input.paymentReference);
        if (existing) return existing;
        const value = { id: `purchase-${purchases.size + 1}`, ...input };
        purchases.set(value.id, value);
        return value;
      },
      async getPurchase(id) { return purchases.get(id) || null; },
      async setMomentStatus() {}
    },
    verifier: {
      async verifyPayment(reference) {
        return {
          reference, status: paid ? "PAID" : "FAILED", amountMinor, currency: "EUR",
          metadata: {
            user_id: "user-1", round_id: "round-1", moment_id: "moment-1",
            product_type: sku, fulfillment_type: fulfillment
          }
        };
      }
    }
  };
}

test("post-commit pipeline renders generated Moment to PREVIEW_READY", async () => {
  const current = round();
  let state = "PENDING";
  const repo = {
    async getRound() { return current; },
    async listPreviousComparableRounds() { return [{ ...round({ id: "old", totalScore: 80 }) }]; },
    async ensureMoment(input) { return { id: "moment-1", ...input }; },
    async getMoment() { return { id: "moment-1", renderData: buildRenderData(current, MOMENT_TYPE.ROUND) }; },
    async setMomentStatus(id, next) { state = next; },
    async markMomentPreviewReady() { state = "PREVIEW_READY"; }
  };
  const result = await processRoundCompleted({ type: "round_completed", roundId: current.id }, {
    repo,
    storage: { async putAsset(input) { return `private://${input.fileName}`; } }
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.previewReadyMomentIds, ["moment-1"]);
  assert.equal(state, "PREVIEW_READY");
});

test("Moments render failure is contained downstream of saved round", async () => {
  const current = round();
  const result = await processRoundCompleted({ type: "round_completed", roundId: current.id }, {
    repo: {
      async getRound() { return current; },
      async listPreviousComparableRounds() { return []; },
      async ensureMoment(input) { return { id: "moment-1", ...input }; },
      async getMoment() { return { id: "moment-1", renderData: buildRenderData(current, MOMENT_TYPE.ROUND) }; },
      async setMomentStatus() {},
      async markMomentFailed() {}
    },
    storage: { async putAsset() { throw new Error("storage unavailable"); } },
    logger: { error() {} }
  });
  assert.equal(result.accepted, true);
  assert.equal(result.rendered[0].status, "FAILED");
});

test("unauthenticated digital master access is rejected", async () => {
  await assert.rejects(
    () => issueDigitalAssetAccess({ userId: "", purchaseId: "x" }, {
      repo: { async getPurchase() { return null; } }, assetSigner: {}
    }),
    (error) => error instanceof MomentAuthorizationError && error.code === "UNAUTHENTICATED"
  );
});

test("foreign user cannot access another user's digital master", async () => {
  const ctx = purchaseFixture();
  ctx.purchases.set("purchase-1", {
    id: "purchase-1", userId: "user-1", momentId: "moment-1",
    productType: PRODUCT_SKU.ROUND_DIGITAL, fulfillmentStatus: "PAID"
  });
  await assert.rejects(
    () => issueDigitalAssetAccess({ userId: "user-2", purchaseId: "purchase-1" }, {
      repo: ctx.repo, assetSigner: { async signPrivateAsset() { return "signed"; } }
    }),
    (error) => error.code === "NOT_FOUND"
  );
});

test("verified digital payment unlocks only through server signer", async () => {
  const ctx = purchaseFixture();
  const finalized = await finalizeVerifiedPurchase({
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_DIGITAL, paymentReference: "pay-1"
  }, { repo: ctx.repo, paymentVerifier: ctx.verifier });
  const access = await issueDigitalAssetAccess({ userId: "user-1", purchaseId: finalized.purchase.id }, {
    repo: ctx.repo,
    assetSigner: { async signPrivateAsset(input) { return `signed:${input.assetReference}`; } }
  });
  assert.equal(access, "signed:private://digital.svg");
});

test("failed payment creates no purchase", async () => {
  const ctx = purchaseFixture({ paid: false });
  await assert.rejects(() => finalizeVerifiedPurchase({
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_DIGITAL, paymentReference: "pay-failed"
  }, { repo: ctx.repo, paymentVerifier: ctx.verifier }), /Payment is not verified/);
  assert.equal(ctx.purchases.size, 0);
});

test("tampered payment amount fails closed", async () => {
  const ctx = purchaseFixture({ amountMinor: 1 });
  await assert.rejects(() => finalizeVerifiedPurchase({
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_DIGITAL, paymentReference: "pay-wrong"
  }, { repo: ctx.repo, paymentVerifier: ctx.verifier }), /Paid amount\/currency/);
});

test("verified print payment persists PAID purchase before provider order", async () => {
  const ctx = purchaseFixture({ amountMinor: 3490, sku: PRODUCT_SKU.ROUND_A3, fulfillment: "PRINT" });
  const finalized = await finalizeVerifiedPurchase({
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_A3, paymentReference: "pay-print",
    shippingAddress: { firstName: "K", lastName: "B", addressLine1: "Street 1", city: "Berlin", postCode: "10115", country: "DE", email: "k@example.test" }
  }, { repo: ctx.repo, paymentVerifier: ctx.verifier });
  assert.equal(finalized.purchase.fulfillmentType, "PRINT");
  assert.equal(finalized.purchase.fulfillmentStatus, "PAID");
});

function printFixture() {
  const m = moment();
  const p = {
    id: "purchase-print", userId: "user-1", momentId: m.id,
    productType: PRODUCT_SKU.ROUND_A3, fulfillmentStatus: "PAID",
    shippingAddress: { firstName: "Kevin", lastName: "Birdie", addressLine1: "Street 1", city: "Berlin", postCode: "10115", country: "DE", email: "k@example.test" }
  };
  let order = null;
  const events = new Set();
  return {
    p,
    repo: {
      async getPurchase(id) { return id === p.id ? p : null; },
      async getMoment(id) { return id === m.id ? m : null; },
      async claimPrintOrder(input) {
        if (order) return { created: false, order };
        order = { id: "po-1", purchaseId: input.purchaseId, momentId: input.momentId, provider: input.provider, providerOrderReference: null };
        return { created: true, order };
      },
      async attachProviderOrder({ providerOrderReference, status }) { order = { ...order, providerOrderReference, status }; return order; },
      async markPrintOrderFailed() {},
      async markPurchaseFulfillment({ status, reference }) { p.fulfillmentStatus = status; p.fulfillmentReference = reference; },
      async hasProcessedWebhook(provider, id) { return events.has(`${provider}:${id}`); },
      async recordProcessedWebhook({ provider, eventId }) { events.add(`${provider}:${eventId}`); },
      async getPrintOrder(id) { return id === order?.id ? order : null; },
      async updatePrintOrderFromWebhook({ status, providerOrderReference }) { order.status = status; order.providerOrderReference ||= providerOrderReference; },
      async setMomentStatus() {}
    }
  };
}

test("print provider failure becomes FULFILLMENT_FAILED", async () => {
  const fixture = printFixture();
  const service = createPrintFulfillmentService({
    provider: {
      name: "GELATO", async validateProduct() {},
      async createOrder() { throw Object.assign(new Error("provider down"), { code: "PROVIDER_CREATE_FAILED" }); },
      async handleWebhook(e) { return e; }
    },
    repo: fixture.repo,
    assetUrlSigner: { async signProviderAsset() { return "https://signed.example/print.svg"; } }
  });
  const result = await service.createOrderForPaidPurchase("purchase-print");
  assert.equal(result.ok, false);
  assert.equal(fixture.p.fulfillmentStatus, "FULFILLMENT_FAILED");
});

test("repeated print trigger cannot create second physical order", async () => {
  const fixture = printFixture();
  let calls = 0;
  const service = createPrintFulfillmentService({
    provider: {
      name: "GELATO", async validateProduct() {},
      async createOrder() { calls += 1; return { providerOrderReference: "gelato-1", status: "created", recovered: false }; },
      async handleWebhook() {}
    },
    repo: fixture.repo,
    assetUrlSigner: { async signProviderAsset() { return "https://signed.example/print.svg"; } }
  });
  await service.createOrderForPaidPurchase("purchase-print");
  const second = await service.createOrderForPaidPurchase("purchase-print");
  assert.equal(second.duplicatePrevented, true);
  assert.equal(calls, 1);
});

test("webhook retry is idempotent", async () => {
  const fixture = printFixture();
  await fixture.repo.claimPrintOrder({ purchaseId: "purchase-print", momentId: "moment-1", provider: "GELATO" });
  await fixture.repo.attachProviderOrder({ providerOrderReference: "gelato-1", status: "created" });
  fixture.p.fulfillmentStatus = "FULFILLING";
  const service = createPrintFulfillmentService({
    provider: {
      name: "GELATO",
      async handleWebhook(e) { return { provider: "GELATO", eventId: e.id, eventType: e.event, providerOrderReference: e.orderId, internalOrderId: "po-1", fulfillmentStatus: e.fulfillmentStatus }; }
    },
    repo: fixture.repo,
    assetUrlSigner: {}
  });
  const event = { id: "evt-1", event: "order_status_updated", orderId: "gelato-1", fulfillmentStatus: "delivered" };
  assert.equal((await service.handleWebhook(event)).duplicatePrevented, false);
  assert.equal((await service.handleWebhook(event)).duplicatePrevented, true);
  assert.equal(fixture.p.fulfillmentStatus, "FULFILLED");
});

test("Gelato adapter recovers existing order before create", async () => {
  const calls = [];
  const provider = createGelatoPrintProvider({
    apiKey: "secret", productUid: "poster-a3-ver",
    fetchImpl: async (url, init) => {
      calls.push([url, init?.method]);
      if (url.includes("orders:search")) {
        return { ok: true, status: 200, async json() { return { orders: [{ id: "gelato-existing", orderReferenceId: "po-1", fulfillmentStatus: "passed" }] }; } };
      }
      throw new Error("create must not be called");
    }
  });
  const result = await provider.createOrder({
    internalOrderId: "po-1", purchaseId: "p1", momentId: "m1", userId: "u1",
    printAssetUrl: "https://signed.example/print.svg",
    recipient: { firstName: "K", lastName: "B", addressLine1: "S 1", city: "Berlin", postCode: "10115", country: "DE", email: "k@example.test" }
  });
  assert.equal(result.recovered, true);
  assert.equal(result.providerOrderReference, "gelato-existing");
  assert.equal(calls.length, 1);
});

test("Gelato product validation requires printable A3 portrait product", async () => {
  const provider = createGelatoPrintProvider({
    apiKey: "secret", productUid: "poster-a3-ver",
    fetchImpl: async () => ({
      ok: true, status: 200,
      async json() { return { attributes: { PaperFormat: "A3", Orientation: "ver" }, isPrintable: true, supportedCountries: ["DE"] }; }
    })
  });
  assert.equal((await provider.validateProduct({ country: "DE" })).valid, true);
});
