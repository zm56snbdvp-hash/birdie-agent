import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_TYPE } from "../src/moments/contracts.mjs";
import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  PRODUCT_TYPE
} from "../src/moments/commerce/contracts.mjs";
import { startDigitalCheckout } from "../src/moments/commerce/checkout.mjs";
import { handlePaymentWebhook } from "../src/moments/commerce/payment-webhook.mjs";
import { getDigitalDownload } from "../src/moments/commerce/download.mjs";

const catalog = Object.freeze({
  [PRODUCT_TYPE.DIGITAL_ROUND]: { amountMinor: 690, currency: "EUR" },
  [PRODUCT_TYPE.DIGITAL_PERSONAL_BEST]: { amountMinor: 990, currency: "EUR" }
});

function makeMoment(overrides = {}) {
  return {
    id: "moment-1",
    userId: "user-1",
    roundId: "round-1",
    momentType: MOMENT_TYPE.ROUND,
    previewAsset: "private://moments/moment-1/preview.svg",
    digitalAsset: "private://moments/moment-1/digital.svg",
    renderData: {
      courseName: "Gut Testhof",
      playedAt: "2026-09-04T10:00:00+02:00",
      totalScore: 82,
      holesPlayed: 18,
      birdieCount: 3
    },
    ...overrides
  };
}

function makeRepo(moment = makeMoment()) {
  const purchases = new Map();
  const events = new Set();
  let sequence = 0;

  return {
    moment,
    purchases,
    events,
    async getMoment(id) {
      return id === moment.id ? moment : null;
    },
    async ensurePurchase(input) {
      const key = `${input.userId}|${input.momentId}|${input.productType}|${input.fulfillmentType}`;
      if (purchases.has(key)) return purchases.get(key);
      sequence += 1;
      const purchase = {
        id: `purchase-${sequence}`,
        paymentReference: null,
        entitlementGrantedAt: null,
        ...input
      };
      purchases.set(key, purchase);
      return purchase;
    },
    async attachPaymentReference({ purchaseId, paymentReference }) {
      for (const purchase of purchases.values()) {
        if (purchase.id === purchaseId) purchase.paymentReference = paymentReference;
      }
    },
    async getPurchaseByPaymentReference(reference) {
      return [...purchases.values()].find((item) => item.paymentReference === reference) ?? null;
    },
    async confirmPaidPurchase(input) {
      if (events.has(input.providerEventId)) return { duplicate: true };
      events.add(input.providerEventId);
      const purchase = [...purchases.values()].find((item) => item.id === input.purchaseId);
      Object.assign(purchase, {
        paymentStatus: input.paymentStatus,
        entitlementGrantedAt: input.entitlementGrantedAt,
        fulfillmentStatus: input.fulfillmentStatus
      });
      return { duplicate: false, purchase };
    },
    async markPurchaseFailed({ purchaseId }) {
      const purchase = [...purchases.values()].find((item) => item.id === purchaseId);
      if (purchase) purchase.paymentStatus = PAYMENT_STATUS.FAILED;
    },
    async getPurchaseForProduct({ userId, momentId, productType, fulfillmentType }) {
      return [...purchases.values()].find((item) =>
        item.userId === userId &&
        item.momentId === momentId &&
        item.productType === productType &&
        item.fulfillmentType === fulfillmentType
      ) ?? null;
    }
  };
}

function checkoutProvider(capture = {}) {
  return {
    async createCheckoutSession(input) {
      capture.input = input;
      return { paymentReference: "pay-ref-1", checkoutUrl: "https://checkout.test/session-1" };
    }
  };
}

async function createPendingPurchase(repo, moment = repo.moment, capture = {}) {
  await startDigitalCheckout({
    authUserId: moment.userId,
    momentId: moment.id,
    repo,
    paymentProvider: checkoutProvider(capture),
    catalog,
    successUrl: "https://app.test/success",
    cancelUrl: "https://app.test/cancel"
  });
  return [...repo.purchases.values()][0];
}

function paidEvent(purchase, overrides = {}) {
  return {
    id: "evt-1",
    type: "PAYMENT_SUCCEEDED",
    paymentReference: purchase.paymentReference,
    paid: true,
    amountMinor: purchase.amountMinor,
    currency: purchase.currency,
    metadata: {
      user_id: purchase.userId,
      round_id: "round-1",
      moment_id: purchase.momentId,
      product_type: purchase.productType,
      fulfillment_type: purchase.fulfillmentType
    },
    ...overrides
  };
}

test("checkout price comes from the server catalog and metadata is canonical", async () => {
  const repo = makeRepo();
  const capture = {};
  const result = await startDigitalCheckout({
    authUserId: "user-1",
    momentId: "moment-1",
    repo,
    paymentProvider: checkoutProvider(capture),
    catalog,
    successUrl: "https://app.test/success",
    cancelUrl: "https://app.test/cancel"
  });

  assert.equal(result.status, "CHECKOUT_READY");
  assert.equal(capture.input.amountMinor, 690);
  assert.equal(capture.input.currency, "EUR");
  assert.deepEqual(capture.input.metadata, {
    user_id: "user-1",
    round_id: "round-1",
    moment_id: "moment-1",
    product_type: PRODUCT_TYPE.DIGITAL_ROUND,
    fulfillment_type: FULFILLMENT_TYPE.DIGITAL
  });
});

test("foreign user cannot start checkout for another user's Moment", async () => {
  await assert.rejects(
    startDigitalCheckout({
      authUserId: "user-2",
      momentId: "moment-1",
      repo: makeRepo(),
      paymentProvider: checkoutProvider(),
      catalog
    }),
    (error) => error.code === "MOMENT_NOT_FOUND" && error.status === 404
  );
});

test("PB Moment resolves the PB digital product", async () => {
  const repo = makeRepo(makeMoment({ momentType: MOMENT_TYPE.PERSONAL_BEST }));
  const capture = {};
  await createPendingPurchase(repo, repo.moment, capture);
  assert.equal(capture.input.amountMinor, 990);
  assert.equal(capture.input.metadata.product_type, PRODUCT_TYPE.DIGITAL_PERSONAL_BEST);
});

test("verified paid webhook grants entitlement only after exact amount and metadata match", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);
  const event = paidEvent(purchase);

  const result = await handlePaymentWebhook({
    rawBody: "signed-body",
    signature: "valid-signature",
    paymentProvider: { async verifyWebhook() { return event; } },
    repo,
    now: () => "2026-09-04T12:00:00Z"
  });

  assert.equal(result.status, PAYMENT_STATUS.PAID);
  assert.equal(purchase.paymentStatus, PAYMENT_STATUS.PAID);
  assert.equal(purchase.entitlementGrantedAt, "2026-09-04T12:00:00Z");
  assert.equal(purchase.fulfillmentStatus, "READY");
});

test("amount mismatch never grants entitlement", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);

  await assert.rejects(
    handlePaymentWebhook({
      rawBody: "signed-body",
      signature: "valid-signature",
      paymentProvider: {
        async verifyWebhook() { return paidEvent(purchase, { amountMinor: 1 }); }
      },
      repo
    }),
    (error) => error.code === "PAYMENT_AMOUNT_MISMATCH"
  );

  assert.equal(purchase.paymentStatus, PAYMENT_STATUS.PENDING);
  assert.equal(purchase.entitlementGrantedAt, null);
});

test("metadata mismatch never grants entitlement", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);
  const event = paidEvent(purchase);
  event.metadata = { ...event.metadata, user_id: "attacker" };

  await assert.rejects(
    handlePaymentWebhook({
      rawBody: "signed-body",
      signature: "valid-signature",
      paymentProvider: { async verifyWebhook() { return event; } },
      repo
    }),
    (error) => error.code === "PAYMENT_METADATA_MISMATCH"
  );

  assert.equal(purchase.entitlementGrantedAt, null);
});

test("duplicate payment event is idempotent", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);
  const event = paidEvent(purchase);
  const args = {
    rawBody: "signed-body",
    signature: "valid-signature",
    paymentProvider: { async verifyWebhook() { return event; } },
    repo,
    now: () => "2026-09-04T12:00:00Z"
  };

  const first = await handlePaymentWebhook(args);
  const second = await handlePaymentWebhook(args);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(repo.events.size, 1);
});

test("failed payment does not grant digital entitlement", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);
  const event = {
    id: "evt-failed",
    type: "PAYMENT_FAILED",
    paymentReference: purchase.paymentReference
  };
  await handlePaymentWebhook({
    rawBody: "signed-body",
    signature: "valid-signature",
    paymentProvider: { async verifyWebhook() { return event; } },
    repo
  });
  assert.equal(purchase.paymentStatus, PAYMENT_STATUS.FAILED);
  assert.equal(purchase.entitlementGrantedAt, null);
});

test("legacy paid download still requires entitlement", async () => {
  const repo = makeRepo();
  await createPendingPurchase(repo);
  await assert.rejects(
    getDigitalDownload({
      authUserId: "user-1",
      momentId: "moment-1",
      repo,
      assetSigner: { async createSignedReadUrl() { throw new Error("must not run"); } }
    }),
    (error) => error.code === "DIGITAL_ENTITLEMENT_REQUIRED" && error.status === 403
  );
});

test("legacy paid owner receives only a short-lived signed URL", async () => {
  const repo = makeRepo();
  const purchase = await createPendingPurchase(repo);
  const event = paidEvent(purchase);
  await handlePaymentWebhook({
    rawBody: "signed-body",
    signature: "valid-signature",
    paymentProvider: { async verifyWebhook() { return event; } },
    repo,
    now: () => "2026-09-04T12:00:00Z"
  });

  const response = await getDigitalDownload({
    authUserId: "user-1",
    momentId: "moment-1",
    repo,
    assetSigner: {
      async createSignedReadUrl({ assetRef, expiresInSeconds }) {
        assert.equal(assetRef, "private://moments/moment-1/digital.svg");
        assert.equal(expiresInSeconds, 300);
        return "https://assets.test/signed/download?expires=300";
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.equal(response.body.downloadUrl, "https://assets.test/signed/download?expires=300");
  assert.equal(JSON.stringify(response).includes("private://moments"), false);
});

test("legacy Phase-4 commerce contracts remain intact for future Birdie products", () => {
  assert.equal(PRODUCT_TYPE.DIGITAL_ROUND, "DIGITAL_ROUND");
  assert.equal(PRODUCT_TYPE.DIGITAL_PERSONAL_BEST, "DIGITAL_PERSONAL_BEST");
  assert.equal(FULFILLMENT_TYPE.DIGITAL, "DIGITAL");
});
