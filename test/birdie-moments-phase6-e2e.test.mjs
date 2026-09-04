import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_STATUS, MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { evaluateCompletedRound } from "../src/moments/evaluate-round.mjs";
import { renderMomentForStorage } from "../src/moments/rendering/render-job.mjs";
import {
  MOMENT_ANALYTICS_EVENT,
  sanitizeMomentAnalyticsPayload
} from "../src/moments/analytics/events.mjs";
import {
  trackMomentOfferClosed,
  trackMomentPreviewViewed
} from "../src/moments/analytics/interactions.mjs";
import { computeBirdieMomentsKpis } from "../src/moments/analytics/kpis.mjs";
import { startDigitalCheckout } from "../src/moments/commerce/checkout.mjs";
import { handlePaymentWebhook } from "../src/moments/commerce/payment-webhook.mjs";
import { getDigitalDownload } from "../src/moments/commerce/download.mjs";
import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  PRODUCT_TYPE
} from "../src/moments/commerce/contracts.mjs";
import { startPrintCheckout } from "../src/moments/print/checkout.mjs";
import { submitPaidPrintOrder } from "../src/moments/print/fulfillment.mjs";
import { handlePrintProviderWebhook } from "../src/moments/print/webhook.mjs";

const currentRound = Object.freeze({
  id: "round-1",
  userId: "user-1",
  displayName: "Kevin",
  courseName: "Gut Testhof",
  playedAt: "2026-09-04T10:00:00+02:00",
  totalScore: 82,
  holesPlayed: 18,
  birdieCount: 3,
  isCompleted: true
});

const previousRound = Object.freeze({
  ...currentRound,
  id: "round-0",
  playedAt: "2026-08-04T10:00:00+02:00",
  totalScore: 86,
  birdieCount: 1
});

const catalog = Object.freeze({
  [PRODUCT_TYPE.DIGITAL_ROUND]: { amountMinor: 690, currency: "EUR" },
  [PRODUCT_TYPE.DIGITAL_PERSONAL_BEST]: { amountMinor: 990, currency: "EUR" },
  [PRODUCT_TYPE.PRINT_A3]: { amountMinor: 3490, currency: "EUR" }
});

const address = Object.freeze({
  recipientName: "Kevin Test",
  line1: "Teststr. 1",
  postalCode: "12345",
  city: "Berlin",
  countryCode: "DE"
});

function createAnalytics() {
  const events = [];
  return {
    events,
    async track(name, payload) {
      events.push({ name, payload });
    }
  };
}

function createRepo({ round = currentRound, previous = [previousRound] } = {}) {
  const moments = new Map();
  const momentKeys = new Map();
  const purchases = new Map();
  const paymentEvents = new Set();
  const failures = [];
  const printEvents = new Set();
  let purchaseSequence = 0;
  let printOrder = null;

  function purchaseById(id) {
    return [...purchases.values()].find((purchase) => purchase.id === id) ?? null;
  }

  return {
    moments,
    purchases,
    failures,
    get printOrder() { return printOrder; },

    async getRound(id) {
      return id === round.id ? round : null;
    },
    async listPreviousComparableRounds({ userId, holesPlayed, excludeRoundId }) {
      return previous.filter((item) =>
        item.userId === userId &&
        item.holesPlayed === holesPlayed &&
        item.id !== excludeRoundId
      );
    },
    async ensureMoment(input) {
      const key = `${input.roundId}|${input.momentType}|${input.templateVersion}`;
      const existingId = momentKeys.get(key);
      if (existingId) return moments.get(existingId);
      const id = input.momentType === MOMENT_TYPE.PERSONAL_BEST ? "moment-pb" : "moment-round";
      const moment = { id, ...input };
      moments.set(id, moment);
      momentKeys.set(key, id);
      return moment;
    },
    async getMoment(id) {
      return moments.get(id) ?? null;
    },
    async setMomentStatus(id, status) {
      moments.get(id).status = status;
    },
    async markMomentPreviewReady({ momentId, generatedAt, previewAsset, digitalAsset, printAsset }) {
      Object.assign(moments.get(momentId), {
        status: MOMENT_STATUS.PREVIEW_READY,
        generatedAt,
        previewAsset,
        digitalAsset,
        printAsset
      });
    },
    async markMomentFailed({ momentId }) {
      moments.get(momentId).status = MOMENT_STATUS.FAILED;
    },
    async recordMomentFailure(failure) {
      failures.push(failure);
    },

    async ensurePurchase(input) {
      const key = `${input.userId}|${input.momentId}|${input.productType}|${input.fulfillmentType}`;
      if (purchases.has(key)) return purchases.get(key);
      purchaseSequence += 1;
      const purchase = {
        id: `purchase-${purchaseSequence}`,
        paymentReference: null,
        entitlementGrantedAt: null,
        ...input
      };
      purchases.set(key, purchase);
      return purchase;
    },
    async attachPaymentReference({ purchaseId, paymentReference }) {
      purchaseById(purchaseId).paymentReference = paymentReference;
    },
    async getPurchase(id) {
      return purchaseById(id);
    },
    async getPurchaseByPaymentReference(reference) {
      return [...purchases.values()].find((purchase) => purchase.paymentReference === reference) ?? null;
    },
    async confirmPaidPurchase(input) {
      if (paymentEvents.has(input.providerEventId)) return { duplicate: true };
      paymentEvents.add(input.providerEventId);
      const purchase = purchaseById(input.purchaseId);
      Object.assign(purchase, {
        paymentStatus: input.paymentStatus,
        entitlementGrantedAt: input.entitlementGrantedAt,
        fulfillmentStatus: input.fulfillmentStatus
      });
      return { duplicate: false, purchase };
    },
    async markPurchaseFailed({ purchaseId }) {
      purchaseById(purchaseId).paymentStatus = PAYMENT_STATUS.FAILED;
    },
    async getPurchaseForProduct({ userId, momentId, productType, fulfillmentType }) {
      return [...purchases.values()].find((purchase) =>
        purchase.userId === userId &&
        purchase.momentId === momentId &&
        purchase.productType === productType &&
        purchase.fulfillmentType === fulfillmentType
      ) ?? null;
    },

    async getPrintOrderByPurchaseId(purchaseId) {
      return printOrder?.purchaseId === purchaseId ? printOrder : null;
    },
    async ensurePrintOrder(input) {
      printOrder ??= { id: "print-order-1", ...input };
      return printOrder;
    },
    async markPrintOrderSubmitted(input) {
      Object.assign(printOrder, {
        providerOrderId: input.providerOrderId,
        status: input.status
      });
      purchaseById(printOrder.purchaseId).fulfillmentStatus = input.fulfillmentStatus;
      return printOrder;
    },
    async markPrintOrderFailed(input) {
      Object.assign(printOrder, {
        status: input.status,
        failureCode: input.failureCode
      });
      purchaseById(input.purchaseId).fulfillmentStatus = input.fulfillmentStatus;
    },
    async getPrintOrderByProviderOrderId(providerName, providerOrderId) {
      return printOrder?.providerName === providerName && printOrder?.providerOrderId === providerOrderId
        ? printOrder
        : null;
    },
    async claimPrintProviderEvent(input) {
      const key = `${input.providerName}:${input.providerEventId}`;
      if (printEvents.has(key)) return { duplicate: true };
      printEvents.add(key);
      return { duplicate: false };
    },
    async updatePrintOrderStatus(input) {
      printOrder.status = input.status;
      purchaseById(printOrder.purchaseId).fulfillmentStatus = input.fulfillmentStatus;
      return printOrder;
    }
  };
}

function createPaymentProvider() {
  let sequence = 0;
  const sessions = new Map();
  return {
    sessions,
    async createCheckoutSession(input) {
      sequence += 1;
      const paymentReference = `pay-${sequence}`;
      sessions.set(paymentReference, input);
      return {
        paymentReference,
        checkoutUrl: `https://checkout.test/${paymentReference}`
      };
    },
    async verifyWebhook({ rawBody }) {
      const session = sessions.get(rawBody);
      if (!session) throw new Error("Unknown payment session");
      return {
        id: `evt-${rawBody}`,
        type: "PAYMENT_SUCCEEDED",
        paymentReference: rawBody,
        paid: true,
        amountMinor: session.amountMinor,
        currency: session.currency,
        metadata: session.metadata
      };
    }
  };
}

function createPrintProvider(counter = { creates: 0 }) {
  return {
    name: "TEST_PRINT",
    async validateProduct() { return true; },
    async createOrder({ idempotencyKey }) {
      counter.creates += 1;
      assert.match(idempotencyKey, /^birdie-moment-print:purchase-/);
      return { id: "provider-order-1" };
    },
    async handleWebhook() {
      return {
        id: "print-event-1",
        providerOrderId: "provider-order-1",
        type: "SHIPPED",
        trackingReference: "TRACK-1"
      };
    }
  };
}

const storage = {
  async putAsset({ momentId, target }) {
    return `private://moments/${momentId}/${target}.svg`;
  }
};

test("analytics sanitizer excludes payment and personal-address secrets", () => {
  const clean = sanitizeMomentAnalyticsPayload({
    userId: "user-1",
    momentId: "moment-1",
    amountMinor: 990,
    currency: "EUR",
    paymentReference: "pay-secret",
    signature: "sig-secret",
    shippingAddress: { line1: "Secret 1" }
  });
  assert.deepEqual(clean, {
    userId: "user-1",
    momentId: "moment-1",
    amountMinor: 990,
    currency: "EUR"
  });
});

test("PB generation rate counts completed rounds, not number of generated Moments", () => {
  const events = [
    { name: "moment_generated", payload: { roundId: "r1", momentId: "m-round" } },
    { name: "moment_generated", payload: { roundId: "r1", momentId: "m-pb" } }
  ];
  const kpis = computeBirdieMomentsKpis({ completedRounds: 1, events });
  assert.equal(kpis.generatedMoments, 2);
  assert.equal(kpis.generatedRounds, 1);
  assert.equal(kpis.generationRate, 1);
});

test("one preview can convert to Digital plus Print without breaking conversion or attach-rate semantics", () => {
  const events = [
    { name: "moment_generated", payload: { userId: "u1", roundId: "r1", momentId: "m1" } },
    { name: "moment_preview_viewed", payload: { userId: "u1", roundId: "r1", momentId: "m1" } },
    { name: "digital_purchase_completed", payload: { userId: "u1", roundId: "r1", momentId: "m1", amountMinor: 990 } },
    { name: "print_purchase_completed", payload: { userId: "u1", roundId: "r1", momentId: "m1", amountMinor: 3490 } }
  ];
  const kpis = computeBirdieMomentsKpis({ completedRounds: 1, events });
  assert.equal(kpis.purchaseConversion, 1);
  assert.equal(kpis.printAttachRate, 1);
  assert.equal(kpis.revenueMinor, 4480);
});

test("full PB E2E: round -> Moments -> render -> preview -> Digital + Print purchase -> fulfillment", async () => {
  const repo = createRepo();
  const analytics = createAnalytics();
  const paymentProvider = createPaymentProvider();

  const evaluated = await evaluateCompletedRound(currentRound.id, repo);
  assert.equal(evaluated.accepted, true);
  assert.equal(evaluated.moments.length, 2);
  assert.equal(evaluated.personalBest.isPersonalBest, true);
  assert.equal(evaluated.personalBest.improvement, -4);

  for (const moment of evaluated.moments) {
    const rendered = await renderMomentForStorage(moment.id, {
      repo,
      storage,
      analytics,
      now: () => "2026-09-04T10:01:00Z"
    });
    assert.equal(rendered.ok, true);
    assert.equal(repo.moments.get(moment.id).status, MOMENT_STATUS.PREVIEW_READY);
  }

  const pbMoment = repo.moments.get("moment-pb");
  await trackMomentPreviewViewed({ analytics, moment: pbMoment });

  const digitalCheckout = await startDigitalCheckout({
    authUserId: "user-1",
    momentId: pbMoment.id,
    repo,
    paymentProvider,
    catalog,
    analytics,
    successUrl: "https://app.test/success",
    cancelUrl: "https://app.test/cancel"
  });
  const digitalPurchase = [...repo.purchases.values()].find((purchase) => purchase.id === digitalCheckout.purchaseId);
  await handlePaymentWebhook({
    rawBody: digitalPurchase.paymentReference,
    signature: "verified",
    paymentProvider,
    repo,
    analytics,
    now: () => "2026-09-04T10:02:00Z"
  });

  const download = await getDigitalDownload({
    authUserId: "user-1",
    momentId: pbMoment.id,
    repo,
    assetSigner: {
      async createSignedReadUrl({ assetRef, expiresInSeconds }) {
        assert.equal(assetRef, pbMoment.digitalAsset);
        assert.equal(expiresInSeconds, 300);
        return "https://assets.test/signed?expires=300";
      }
    }
  });
  assert.equal(download.status, 200);
  assert.equal(JSON.stringify(download).includes("private://"), false);

  const printCheckout = await startPrintCheckout({
    authUserId: "user-1",
    momentId: pbMoment.id,
    shippingAddress: address,
    repo,
    paymentProvider,
    catalog,
    analytics,
    successUrl: "https://app.test/print-success",
    cancelUrl: "https://app.test/print-cancel"
  });
  const printPurchase = [...repo.purchases.values()].find((purchase) => purchase.id === printCheckout.purchaseId);
  await handlePaymentWebhook({
    rawBody: printPurchase.paymentReference,
    signature: "verified",
    paymentProvider,
    repo,
    analytics,
    now: () => "2026-09-04T10:03:00Z"
  });
  assert.equal(printPurchase.entitlementGrantedAt, null);
  assert.equal(printPurchase.fulfillmentStatus, "AWAITING_ORDER");

  const counter = { creates: 0 };
  const printProvider = createPrintProvider(counter);
  const firstOrder = await submitPaidPrintOrder({
    purchaseId: printPurchase.id,
    repo,
    printProvider,
    analytics
  });
  const repeatedOrder = await submitPaidPrintOrder({
    purchaseId: printPurchase.id,
    repo,
    printProvider,
    analytics
  });
  assert.equal(firstOrder.submitted, true);
  assert.equal(repeatedOrder.duplicate, true);
  assert.equal(counter.creates, 1);

  const shipped = await handlePrintProviderWebhook({
    rawBody: "verified-print-event",
    signature: "verified",
    repo,
    printProvider,
    analytics
  });
  assert.equal(shipped.status, "SHIPPED");
  assert.equal(printPurchase.fulfillmentStatus, "SHIPPED");

  const kpis = computeBirdieMomentsKpis({ completedRounds: 1, events: analytics.events });
  assert.equal(kpis.generationRate, 1);
  assert.equal(kpis.generatedMoments, 2);
  assert.equal(kpis.previewedMoments, 1);
  assert.equal(kpis.purchaseConversion, 1);
  assert.equal(kpis.revenueMinor, 4480);
  assert.equal(kpis.revenuePerCompletedRoundMinor, 4480);
  assert.equal(kpis.printAttachRate, 1);

  const eventNames = analytics.events.map((event) => event.name);
  for (const required of [
    MOMENT_ANALYTICS_EVENT.MOMENT_GENERATED,
    MOMENT_ANALYTICS_EVENT.MOMENT_PREVIEW_VIEWED,
    MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_STARTED,
    MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED,
    MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_STARTED,
    MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_COMPLETED
  ]) {
    assert.equal(eventNames.includes(required), true, `missing ${required}`);
  }
  assert.equal(JSON.stringify(analytics.events).includes("pay-"), false);
});

test("render failure keeps canonical round completed and emits generation failure", async () => {
  const repo = createRepo({ previous: [] });
  const analytics = createAnalytics();
  const evaluated = await evaluateCompletedRound(currentRound.id, repo);
  const roundMoment = evaluated.moments[0];
  const failed = await renderMomentForStorage(roundMoment.id, {
    repo,
    analytics,
    storage: { async putAsset() { throw Object.assign(new Error("storage down"), { code: "STORAGE_DOWN" }); } }
  });
  assert.equal(currentRound.isCompleted, true);
  assert.equal(failed.status, MOMENT_STATUS.FAILED);
  assert.equal(repo.moments.get(roundMoment.id).status, MOMENT_STATUS.FAILED);
  assert.equal(analytics.events.some((event) => event.name === MOMENT_ANALYTICS_EVENT.MOMENT_GENERATION_FAILED), true);
});

test("duplicate payment webhook does not double-count purchase completion", async () => {
  const repo = createRepo({ previous: [] });
  const analytics = createAnalytics();
  const paymentProvider = createPaymentProvider();
  const evaluated = await evaluateCompletedRound(currentRound.id, repo);
  const moment = evaluated.moments[0];
  await renderMomentForStorage(moment.id, { repo, storage, analytics });
  const checkout = await startDigitalCheckout({
    authUserId: "user-1",
    momentId: moment.id,
    repo,
    paymentProvider,
    catalog,
    analytics
  });
  const purchase = [...repo.purchases.values()].find((item) => item.id === checkout.purchaseId);
  const args = {
    rawBody: purchase.paymentReference,
    signature: "verified",
    paymentProvider,
    repo,
    analytics
  };
  const first = await handlePaymentWebhook(args);
  const second = await handlePaymentWebhook(args);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(
    analytics.events.filter((event) => event.name === MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED).length,
    1
  );
});

test("offer close is measurable without forcing purchase", async () => {
  const analytics = createAnalytics();
  await trackMomentOfferClosed({
    analytics,
    moment: {
      id: "m1",
      userId: "u1",
      roundId: "r1",
      momentType: MOMENT_TYPE.ROUND,
      templateVersion: "birdie-moment-round-v1",
      status: MOMENT_STATUS.PREVIEW_READY
    }
  });
  assert.deepEqual(analytics.events.map((event) => event.name), [MOMENT_ANALYTICS_EVENT.MOMENT_OFFER_CLOSED]);
});
