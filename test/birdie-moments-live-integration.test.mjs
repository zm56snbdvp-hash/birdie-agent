import test from "node:test";
import assert from "node:assert/strict";

import { MOMENT_STATUS, MOMENT_TYPE, buildRenderData } from "../src/moments/contracts.mjs";
import { PRODUCT_SKU } from "../src/moments/commerce/catalog.mjs";
import {
  MomentCheckoutError,
  getDigitalDownload,
  getDigitalEntitlement,
  handleMomentPaymentWebhook,
  startMomentCheckout
} from "../src/moments/commerce/checkout-service.mjs";
import { sanitizeMomentAnalyticsPayload } from "../src/moments/analytics/events.mjs";
import { toCanonicalMomentRound } from "../src/moments/integration/canonical-round.mjs";
import { createRoundSaveWithMoments, isRecoveredBirdieWorldRoundRequest } from "../src/moments/integration/scorecard.mjs";
import { getMomentDetail, getPostRoundMomentOffer } from "../src/moments/ui/service.mjs";
import { createPrintFulfillmentService } from "../src/moments/fulfillment/print-service.mjs";

function canonicalRound(overrides = {}) {
  return {
    id: "round-1",
    userId: "user-1",
    displayName: "Kevin",
    courseName: "Golfpark Test",
    playedAt: "2026-09-04T18:00:00+02:00",
    totalScore: 82,
    holesPlayed: 18,
    birdieCount: 3,
    parCount: 8,
    scoreVsPar: 10,
    isCompleted: true,
    status: "completed",
    ...overrides
  };
}

function readyMoment(overrides = {}) {
  const r = canonicalRound();
  return {
    id: "moment-round",
    userId: r.userId,
    roundId: r.id,
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PREVIEW_READY,
    templateVersion: "birdie-moment-round-v1",
    renderData: buildRenderData(r, MOMENT_TYPE.ROUND),
    previewAsset: "private://preview.svg",
    digitalAsset: "private://digital.svg",
    printAsset: "private://print.svg",
    ...overrides
  };
}

function createRepo({ round = canonicalRound(), moments = [readyMoment()] } = {}) {
  const rounds = new Map([[round.id, round]]);
  const momentMap = new Map(moments.map((item) => [item.id, item]));
  const momentKeys = new Map();
  for (const item of moments) {
    momentKeys.set(`${item.roundId}|${item.momentType}|${item.templateVersion}`, item.id);
  }

  const purchases = new Map();
  const idempotency = new Map();
  const checkouts = new Map();
  const paymentEvents = new Set();
  const printEvents = new Set();
  let printOrder = null;

  function purchase(id) { return purchases.get(id) ?? null; }

  return {
    rounds,
    moments: momentMap,
    purchases,
    paymentEvents,
    get printOrder() { return printOrder; },

    async getRound(id) { return rounds.get(id) ?? null; },
    async listPreviousComparableRounds() { return []; },
    async ensureMoment(input) {
      const key = `${input.roundId}|${input.momentType}|${input.templateVersion}`;
      const existingId = momentKeys.get(key);
      if (existingId) return momentMap.get(existingId);
      const id = input.momentType === MOMENT_TYPE.PERSONAL_BEST ? "moment-pb" : "moment-round-generated";
      const value = { id, ...input };
      momentMap.set(id, value);
      momentKeys.set(key, id);
      return value;
    },
    async getMoment(id) { return momentMap.get(id) ?? null; },
    async listMomentsForRound(roundId) { return [...momentMap.values()].filter((m) => m.roundId === roundId); },
    async setMomentStatus(id, status) { momentMap.get(id).status = status; },
    async markMomentPreviewReady(input) {
      Object.assign(momentMap.get(input.momentId), {
        status: MOMENT_STATUS.PREVIEW_READY,
        generatedAt: input.generatedAt,
        thumbnailAsset: input.thumbnailAsset,
        previewAsset: input.previewAsset,
        digitalAsset: input.digitalAsset,
        printAsset: input.printAsset
      });
    },
    async markMomentFailed({ momentId }) { momentMap.get(momentId).status = MOMENT_STATUS.FAILED; },

    async getPurchase(id) { return purchase(id); },
    async findPurchaseByIdempotencyKey({ userId, idempotencyKey }) {
      const id = idempotency.get(`${userId}:${idempotencyKey}`);
      return id ? purchase(id) : null;
    },
    async createPurchase(input) {
      purchases.set(input.id, input);
      idempotency.set(`${input.userId}:${input.idempotencyKey}`, input.id);
      return input;
    },
    async attachCheckout({ purchaseId, checkoutReference, checkoutUrl }) {
      Object.assign(purchase(purchaseId), { checkoutReference, checkoutUrl });
      checkouts.set(checkoutReference, purchaseId);
    },
    async getPurchaseByCheckoutReference({ provider, checkoutReference }) {
      const id = checkouts.get(checkoutReference);
      const value = id ? purchase(id) : null;
      return value?.paymentProvider === provider ? value : null;
    },
    async getPurchaseForProduct({ userId, momentId, productType, fulfillmentType }) {
      return [...purchases.values()].find((p) =>
        p.userId === userId && p.momentId === momentId && p.productType === productType && p.fulfillmentType === fulfillmentType
      ) ?? null;
    },
    async claimPaymentEvent({ provider, eventId }) {
      const key = `${provider}:${eventId}`;
      if (paymentEvents.has(key)) return false;
      paymentEvents.add(key);
      return true;
    },
    async markPurchasePaymentFailed({ purchaseId, paymentReference = null }) {
      Object.assign(purchase(purchaseId), { paymentStatus: "FAILED", paymentReference });
      return purchase(purchaseId);
    },
    async markPurchasePaidAndFulfilled({ purchaseId, paymentReference, fulfillmentReference }) {
      Object.assign(purchase(purchaseId), {
        paymentStatus: "PAID",
        paymentReference,
        fulfillmentStatus: "FULFILLED",
        fulfillmentReference
      });
      return purchase(purchaseId);
    },
    async markPurchasePaidAwaitingOrder({ purchaseId, paymentReference }) {
      Object.assign(purchase(purchaseId), {
        paymentStatus: "PAID",
        paymentReference,
        fulfillmentStatus: "AWAITING_ORDER"
      });
      return purchase(purchaseId);
    },
    async markPurchaseFulfillment({ purchaseId, status, reference = null }) {
      Object.assign(purchase(purchaseId), { fulfillmentStatus: status, fulfillmentReference: reference });
      return purchase(purchaseId);
    },

    async claimPrintOrder(input) {
      if (printOrder) return { created: false, order: printOrder };
      printOrder = {
        id: "print-order-1",
        purchaseId: input.purchaseId,
        momentId: input.momentId,
        provider: input.provider,
        providerOrderReference: null,
        status: "CLAIMED"
      };
      return { created: true, order: printOrder };
    },
    async attachProviderOrder({ providerOrderReference, status }) {
      Object.assign(printOrder, { providerOrderReference, status });
      return printOrder;
    },
    async markPrintOrderFailed({ reason }) { Object.assign(printOrder, { status: "FAILED", failureReason: reason }); },
    async getPrintOrder(id) { return printOrder?.id === id ? printOrder : null; },
    async hasProcessedWebhook(provider, eventId) { return printEvents.has(`${provider}:${eventId}`); },
    async recordProcessedWebhook({ provider, eventId }) { printEvents.add(`${provider}:${eventId}`); },
    async updatePrintOrderFromWebhook({ providerOrderReference, status }) {
      Object.assign(printOrder, { providerOrderReference, status });
      return printOrder;
    }
  };
}

function createPaymentProvider() {
  const sessions = new Map();
  let seq = 0;
  return {
    name: "TEST_PAY",
    sessions,
    async createCheckoutSession(input) {
      seq += 1;
      const checkoutReference = `checkout-${seq}`;
      sessions.set(checkoutReference, input);
      return { checkoutReference, redirectUrl: `https://pay.test/${checkoutReference}` };
    },
    async verifyWebhook({ rawBody, headers }) {
      if (headers?.signature !== "valid") throw new Error("bad signature");
      const session = sessions.get(rawBody);
      if (!session) throw new Error("unknown checkout");
      return {
        eventId: `event-${rawBody}`,
        type: "PAYMENT_SUCCEEDED",
        checkoutReference: rawBody,
        paymentReference: `payment-${rawBody}`,
        amountMinor: session.amountMinor,
        currency: session.currency,
        metadata: session.metadata
      };
    }
  };
}

const digitalGateway = {
  async getAuthorizedPreviewUrl() { return "https://assets.test/preview/signed"; },
  async getAuthorizedDigitalUrl() { return "https://assets.test/digital/signed"; }
};

const shippingAddress = {
  firstName: "Kevin",
  lastName: "Birdie",
  addressLine1: "Teststrasse 1",
  city: "Berlin",
  postCode: "10115",
  country: "DE",
  email: "kevin@example.test"
};

test("recovered /api/round request contract is accepted without client user id", () => {
  assert.equal(isRecoveredBirdieWorldRoundRequest({
    courseName: "Test Course",
    playedAt: "2026-09-04",
    holeCount: 9,
    holes: [{ hole: 1, par: 4, strokes: 4 }]
  }), true);
});

test("persisted BirdieWorld holes map to canonical real Moment data", () => {
  const mapped = toCanonicalMomentRound({
    id: "round-9",
    userId: "user-1",
    displayName: "Kevin",
    courseName: "Nine Hole Test",
    playedAt: "2026-09-04",
    holeCount: 9,
    status: "completed",
    holes: [
      { hole: 1, par: 4, strokes: 4 }, { hole: 2, par: 4, strokes: 3 },
      { hole: 3, par: 3, strokes: 3 }, { hole: 4, par: 5, strokes: 5 },
      { hole: 5, par: 4, strokes: 5 }, { hole: 6, par: 4, strokes: 4 },
      { hole: 7, par: 3, strokes: 2 }, { hole: 8, par: 5, strokes: 6 },
      { hole: 9, par: 4, strokes: 4 }
    ]
  });
  assert.equal(mapped.totalScore, 36);
  assert.equal(mapped.coursePar, 36);
  assert.equal(mapped.scoreVsPar, 0);
  assert.equal(mapped.birdieCount, 2);
  assert.equal(mapped.parCount, 5);
  assert.equal(mapped.holesPlayed, 9);
  assert.equal(mapped.isCompleted, true);
});

test("scorecard response is preserved and Moments starts only after persisted completed round", async () => {
  const round = canonicalRound();
  const repo = createRepo({ round, moments: [] });
  const response = { success: true, round };
  const save = createRoundSaveWithMoments({
    saveRound: async () => response,
    momentsRepo: repo,
    storage: { async putAsset(input) { return `private://${input.fileName}`; } }
  });
  const result = await save({ body: {} });
  assert.equal(result, response);
  assert.equal([...repo.moments.values()].length, 1);
  assert.equal([...repo.moments.values()][0].status, MOMENT_STATUS.PREVIEW_READY);
});

test("Birdie Moments failure never changes successful Scorecard save", async () => {
  const round = canonicalRound();
  const repo = createRepo({ round, moments: [] });
  const response = { success: true, round };
  const save = createRoundSaveWithMoments({
    saveRound: async () => response,
    momentsRepo: repo,
    storage: { async putAsset() { throw new Error("storage down"); } },
    logger: { error() {} }
  });
  assert.equal(await save({}), response);
});

test("post-round offer and detail expose authorized preview URL, not private asset ref", async () => {
  const repo = createRepo();
  const offer = await getPostRoundMomentOffer({
    roundId: "round-1", authenticatedUserId: "user-1", repo, assetGateway: digitalGateway
  });
  assert.equal(offer.available, true);
  assert.equal(offer.offer.primaryCta.label, "Moment ansehen");
  assert.equal(JSON.stringify(offer).includes("private://"), false);

  const detail = await getMomentDetail({
    momentId: "moment-round", authenticatedUserId: "user-1", repo, assetGateway: digitalGateway
  });
  assert.deepEqual(detail.products.map((p) => p.sku), [PRODUCT_SKU.ROUND_DIGITAL, PRODUCT_SKU.ROUND_A3]);
  assert.equal(JSON.stringify(detail).includes("private://"), false);
});

test("foreign user cannot access a Moment detail", async () => {
  const repo = createRepo();
  await assert.rejects(
    () => getMomentDetail({ momentId: "moment-round", authenticatedUserId: "user-2", repo, assetGateway: digitalGateway }),
    (error) => error.code === "MOMENT_NOT_FOUND" && error.status === 404
  );
});

test("digital checkout uses server catalog price and is idempotent", async () => {
  const repo = createRepo();
  const paymentProvider = createPaymentProvider();
  const first = await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-1", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c",
    repo, paymentProvider, createId: () => "purchase-1"
  });
  assert.equal(paymentProvider.sessions.get("checkout-1").amountMinor, 690);
  const second = await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-1", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c",
    repo, paymentProvider
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.checkoutUrl, first.checkoutUrl);
  assert.equal(repo.purchases.size, 1);
});

test("success redirect alone never creates digital entitlement", async () => {
  const repo = createRepo();
  const paymentProvider = createPaymentProvider();
  await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-no-webhook", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c",
    repo, paymentProvider, createId: () => "purchase-no-webhook"
  });
  assert.deepEqual(await getDigitalEntitlement({ momentId: "moment-round", authenticatedUserId: "user-1", repo }), {
    entitled: false,
    purchase: expectPublicPurchase(repo.purchases.get("purchase-no-webhook"))
  });
});

function expectPublicPurchase(purchase) {
  return {
    id: purchase.id,
    momentId: purchase.momentId,
    productType: purchase.productType,
    paymentStatus: purchase.paymentStatus,
    fulfillmentType: purchase.fulfillmentType,
    fulfillmentStatus: purchase.fulfillmentStatus,
    amount: purchase.amount,
    currency: purchase.currency
  };
}

test("invalid payment webhook signature grants nothing", async () => {
  const repo = createRepo();
  const paymentProvider = createPaymentProvider();
  await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-sig", successUrl: "s", cancelUrl: "c", repo, paymentProvider,
    createId: () => "purchase-sig"
  });
  await assert.rejects(
    () => handleMomentPaymentWebhook({ rawBody: "checkout-1", headers: { signature: "bad" }, repo, paymentProvider }),
    (error) => error instanceof MomentCheckoutError && error.code === "INVALID_PAYMENT_WEBHOOK"
  );
  assert.equal(repo.purchases.get("purchase-sig").paymentStatus, "PENDING");
  assert.equal(repo.paymentEvents.size, 0);
});

test("payment amount mismatch fails before event id is consumed", async () => {
  const repo = createRepo();
  const base = createPaymentProvider();
  await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-money", successUrl: "s", cancelUrl: "c", repo, paymentProvider: base,
    createId: () => "purchase-money"
  });
  const badProvider = {
    ...base,
    async verifyWebhook(input) {
      const event = await base.verifyWebhook(input);
      return { ...event, amountMinor: event.amountMinor + 1 };
    }
  };
  await assert.rejects(
    () => handleMomentPaymentWebhook({ rawBody: "checkout-1", headers: { signature: "valid" }, repo, paymentProvider: badProvider }),
    (error) => error.code === "PAYMENT_INTEGRITY_MISMATCH"
  );
  assert.equal(repo.paymentEvents.size, 0);
});

test("verified digital webhook unlocks only an authorized signed master URL", async () => {
  const repo = createRepo();
  const paymentProvider = createPaymentProvider();
  await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    idempotencyKey: "idem-paid", successUrl: "s", cancelUrl: "c", repo, paymentProvider,
    createId: () => "purchase-paid"
  });
  await handleMomentPaymentWebhook({
    rawBody: "checkout-1", headers: { signature: "valid" }, repo, paymentProvider
  });
  assert.equal((await getDigitalEntitlement({ momentId: "moment-round", authenticatedUserId: "user-1", repo })).entitled, true);
  const download = await getDigitalDownload({
    momentId: "moment-round", authenticatedUserId: "user-1", repo, assetGateway: digitalGateway
  });
  assert.equal(download.downloadUrl, "https://assets.test/digital/signed");
  assert.equal(JSON.stringify(download).includes("private://"), false);
});

test("verified print payment automatically creates exactly one physical order", async () => {
  const repo = createRepo();
  const paymentProvider = createPaymentProvider();
  let creates = 0;
  const printProvider = {
    name: "GELATO",
    async validateProduct() { return { valid: true }; },
    async createOrder() {
      creates += 1;
      return { providerOrderReference: "gelato-1", status: "created", recovered: false };
    },
    async handleWebhook(event) { return event; }
  };
  const printFulfillment = createPrintFulfillmentService({
    provider: printProvider,
    repo,
    assetUrlSigner: { async signProviderAsset() { return "https://assets.test/print/signed"; } }
  });

  await startMomentCheckout({
    momentId: "moment-round", authenticatedUserId: "user-1", sku: PRODUCT_SKU.ROUND_A3,
    idempotencyKey: "idem-print", shippingAddress, successUrl: "s", cancelUrl: "c",
    repo, paymentProvider, createId: () => "purchase-print"
  });
  await handleMomentPaymentWebhook({
    rawBody: "checkout-1", headers: { signature: "valid" }, repo, paymentProvider, printFulfillment
  });
  assert.equal(creates, 1);
  assert.equal(repo.purchases.get("purchase-print").paymentStatus, "PAID");
  assert.equal(repo.purchases.get("purchase-print").fulfillmentStatus, "FULFILLING");

  const duplicate = await handleMomentPaymentWebhook({
    rawBody: "checkout-1", headers: { signature: "valid" }, repo, paymentProvider, printFulfillment
  });
  assert.equal(duplicate.idempotent, true);
  assert.equal(creates, 1);
});

test("print provider failure preserves paid purchase and retries same internal claim", async () => {
  const repo = createRepo();
  const p = {
    id: "purchase-print-retry", userId: "user-1", momentId: "moment-round",
    productType: PRODUCT_SKU.ROUND_A3, paymentProvider: "TEST_PAY", paymentStatus: "PAID",
    amount: 3490, currency: "EUR", fulfillmentType: "PRINT", fulfillmentStatus: "AWAITING_ORDER",
    shippingAddress, idempotencyKey: "retry"
  };
  repo.purchases.set(p.id, p);
  let calls = 0;
  const provider = {
    name: "GELATO",
    async validateProduct() {},
    async createOrder() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("temporary"), { code: "PROVIDER_CREATE_FAILED" });
      return { providerOrderReference: "gelato-recovered", status: "created", recovered: true };
    },
    async handleWebhook(e) { return e; }
  };
  const service = createPrintFulfillmentService({
    provider, repo,
    assetUrlSigner: { async signProviderAsset() { return "https://assets.test/print/signed"; } }
  });
  const first = await service.createOrderForPaidPurchase(p.id);
  assert.equal(first.status, "FULFILLMENT_FAILED");
  assert.equal(p.paymentStatus, "PAID");
  assert.equal(p.fulfillmentStatus, "FULFILLMENT_FAILED");
  const second = await service.createOrderForPaidPurchase(p.id);
  assert.equal(second.ok, true);
  assert.equal(second.duplicatePrevented, true);
  assert.equal(repo.printOrder.id, "print-order-1");
});

test("analytics sanitizer drops payment and shipping secrets", () => {
  assert.deepEqual(sanitizeMomentAnalyticsPayload({
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    amountMinor: 690, currency: "EUR", paymentReference: "secret-pay",
    signature: "secret-signature", shippingAddress
  }), {
    userId: "user-1", momentId: "moment-1", sku: PRODUCT_SKU.ROUND_DIGITAL,
    amountMinor: 690, currency: "EUR"
  });
});
