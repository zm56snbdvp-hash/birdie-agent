import test from "node:test";
import assert from "node:assert/strict";
import { startAppStoreDigitalPurchase } from "../src/moments/commerce/apple-iap.mjs";
import { recoverAppStoreDigitalPurchase } from "../src/moments/commerce/apple-iap-recovery.mjs";

const TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const catalog = {
  DIGITAL_ROUND: {
    amountMinor: 690,
    currency: "EUR",
    appStoreProductId: "configured.birdieworld.moment.round.v1"
  }
};
const moment = {
  id: "m1",
  userId: "u1",
  roundId: "r1",
  momentType: "ROUND",
  digitalAsset: "private://digital.svg"
};

function makeRepo() {
  let purchase;
  let intent;
  const transactions = new Set();
  return {
    get purchase() { return purchase; },
    get intent() { return intent; },
    async getMoment(id) { return id === "m1" ? moment : null; },
    async ensurePurchase(input) {
      purchase ??= { id: "p1", entitlementGrantedAt: null, ...input };
      return purchase;
    },
    async getPurchase(id) { return id === "p1" ? purchase : null; },
    async getAppStorePurchaseIntent(id) { return id === "p1" ? intent : null; },
    async ensureAppStorePurchaseIntent(input) { intent ??= { ...input }; return intent; },
    async confirmAppStorePaidPurchase(input) {
      if (transactions.has(input.transactionId)) return { duplicate: true };
      transactions.add(input.transactionId);
      Object.assign(purchase, {
        paymentReference: input.paymentReference,
        paymentStatus: input.paymentStatus,
        entitlementGrantedAt: input.entitlementGrantedAt,
        fulfillmentStatus: input.fulfillmentStatus
      });
      return { duplicate: false };
    }
  };
}

function verifiedTransaction(overrides = {}) {
  return {
    transactionId: "tx-recover-1",
    originalTransactionId: "tx-recover-1",
    productId: catalog.DIGITAL_ROUND.appStoreProductId,
    appAccountToken: TOKEN,
    type: "Consumable",
    quantity: 1,
    environment: "Sandbox",
    price: 6900,
    currency: "EUR",
    ...overrides
  };
}

test("unfinished verified StoreKit transaction recovers the exact pending Moment purchase", async () => {
  const repo = makeRepo();
  await startAppStoreDigitalPurchase({
    authUserId: "u1",
    momentId: "m1",
    appAccountToken: TOKEN,
    repo,
    catalog
  });

  const result = await recoverAppStoreDigitalPurchase({
    authUserId: "u1",
    signedTransactionInfo: "signed-jws",
    repo,
    catalog,
    appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction(); } },
    intentLookup: {
      async getByAppAccountToken(token) {
        return token === TOKEN ? repo.intent : null;
      }
    },
    now: () => "2026-09-04T02:00:00Z"
  });

  assert.equal(result.processed, true);
  assert.equal(result.status, "PAID");
  assert.equal(result.purchaseId, "p1");
  assert.equal(repo.purchase.entitlementGrantedAt, "2026-09-04T02:00:00Z");
});

test("recovery does not disclose or grant another user's StoreKit intent", async () => {
  const repo = makeRepo();
  await startAppStoreDigitalPurchase({
    authUserId: "u1",
    momentId: "m1",
    appAccountToken: TOKEN,
    repo,
    catalog
  });

  await assert.rejects(
    recoverAppStoreDigitalPurchase({
      authUserId: "u2",
      signedTransactionInfo: "signed-jws",
      repo,
      catalog,
      appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction(); } },
      intentLookup: { async getByAppAccountToken() { return repo.intent; } }
    }),
    (error) => error.code === "APPLE_PURCHASE_INTENT_MISSING" && error.status === 404
  );

  assert.equal(repo.purchase.entitlementGrantedAt, null);
});

test("recovery rejects a verified transaction whose token has no purchase intent", async () => {
  const repo = makeRepo();
  await assert.rejects(
    recoverAppStoreDigitalPurchase({
      authUserId: "u1",
      signedTransactionInfo: "signed-jws",
      repo,
      catalog,
      appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction(); } },
      intentLookup: { async getByAppAccountToken() { return null; } }
    }),
    (error) => error.code === "APPLE_PURCHASE_INTENT_MISSING" && error.status === 404
  );
});
