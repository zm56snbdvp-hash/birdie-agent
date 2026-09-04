import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { PRODUCT_TYPE } from "../src/moments/commerce/contracts.mjs";
import {
  handleLivePostRoundRevealRequest,
  handleLiveMomentDetailRequest,
  handleLiveDigitalCheckoutRequest,
  handleLiveDigitalDownloadRequest
} from "../src/moments/live/session-route-adapter.mjs";

function moment(overrides = {}) {
  return {
    id: "moment-1",
    roundId: "round-1",
    userId: "site-user-1",
    momentType: MOMENT_TYPE.ROUND,
    status: "PREVIEW_READY",
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

function repoFor(items = [moment()]) {
  const purchases = [];
  return {
    purchases,
    async listMomentsForRound(roundId) {
      return items.filter((item) => item.roundId === roundId);
    },
    async getMoment(id) {
      return items.find((item) => item.id === id) ?? null;
    },
    async ensurePurchase(input) {
      const existing = purchases.find((item) =>
        item.userId === input.userId && item.momentId === input.momentId
      );
      if (existing) return existing;
      const purchase = {
        id: `purchase-${purchases.length + 1}`,
        paymentReference: null,
        entitlementGrantedAt: null,
        ...input
      };
      purchases.push(purchase);
      return purchase;
    },
    async attachPaymentReference({ purchaseId, paymentReference }) {
      const purchase = purchases.find((item) => item.id === purchaseId);
      if (purchase) purchase.paymentReference = paymentReference;
    },
    async getPurchaseForProduct({ userId, momentId, productType, fulfillmentType }) {
      return purchases.find((item) =>
        item.userId === userId &&
        item.momentId === momentId &&
        item.productType === productType &&
        item.fulfillmentType === fulfillmentType
      ) ?? null;
    }
  };
}

const pricing = {
  roundDigital: 6.9,
  personalBestDigital: 9.9,
  premiumA3Print: 34.9
};

const catalog = {
  [PRODUCT_TYPE.DIGITAL_ROUND]: { amountMinor: 690, currency: "EUR" },
  [PRODUCT_TYPE.DIGITAL_PERSONAL_BEST]: { amountMinor: 990, currency: "EUR" }
};

const noSession = async () => null;
const ownerSession = async () => "site-user-1";
const foreignSession = async () => "site-user-2";

test("live Moments routes fail closed when the ChatGPT Site session has no authenticated user", async () => {
  let touchedRepo = false;
  const response = await handleLiveMomentDetailRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: noSession,
    repo: { async getMoment() { touchedRepo = true; return moment(); } },
    pricing
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: "AUTH_REQUIRED" });
  assert.equal(touchedRepo, false);
});

test("post-round reveal is filtered by the server-resolved Site user", async () => {
  const repo = repoFor([
    moment(),
    moment({ id: "foreign", userId: "site-user-2" })
  ]);

  const response = await handleLivePostRoundRevealRequest({
    request: {},
    roundId: "round-1",
    resolveAuthenticatedUserId: ownerSession,
    repo
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reveal.momentId, "moment-1");
});

test("foreign Site session receives 404 for another user's Moment", async () => {
  const response = await handleLiveMomentDetailRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: foreignSession,
    repo: repoFor(),
    pricing
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "MOMENT_NOT_FOUND" });
});

test("digital checkout purchase ownership comes only from the server Site session", async () => {
  const repo = repoFor();
  const capture = {};
  const response = await handleLiveDigitalCheckoutRequest({
    request: { body: { userId: "attacker" } },
    momentId: "moment-1",
    resolveAuthenticatedUserId: ownerSession,
    repo,
    catalog,
    successUrl: "https://app.test/success",
    cancelUrl: "https://app.test/cancel",
    paymentProvider: {
      async createCheckoutSession(input) {
        capture.input = input;
        return { paymentReference: "pay-1", checkoutUrl: "https://checkout.test/1" };
      }
    }
  });

  assert.equal(response.status, 201);
  assert.equal(repo.purchases.length, 1);
  assert.equal(repo.purchases[0].userId, "site-user-1");
  assert.equal(capture.input.metadata.user_id, "site-user-1");
  assert.notEqual(capture.input.metadata.user_id, "attacker");
});

test("foreign Site session cannot use another user's paid digital entitlement", async () => {
  const repo = repoFor();
  repo.purchases.push({
    id: "purchase-1",
    userId: "site-user-1",
    momentId: "moment-1",
    productType: PRODUCT_TYPE.DIGITAL_ROUND,
    fulfillmentType: "DIGITAL",
    paymentStatus: "PAID",
    entitlementGrantedAt: "2026-09-04T12:00:00Z"
  });

  let signerCalled = false;
  const response = await handleLiveDigitalDownloadRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: foreignSession,
    repo,
    assetSigner: {
      async createSignedReadUrl() {
        signerCalled = true;
        return "https://assets.test/signed";
      }
    }
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "MOMENT_NOT_FOUND");
  assert.equal(signerCalled, false);
});
