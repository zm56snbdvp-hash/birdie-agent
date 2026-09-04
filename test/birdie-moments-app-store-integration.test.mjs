import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_ANALYTICS_EVENT } from "../src/moments/analytics/events.mjs";
import { PRODUCT_TYPE, PAYMENT_STATUS } from "../src/moments/commerce/contracts.mjs";
import { startAppStoreDigitalPurchase, confirmAppStoreDigitalPurchase } from "../src/moments/commerce/apple-iap.mjs";
import { createAppleSignedTransactionVerifier } from "../src/moments/commerce/apple-verifier.mjs";
import { createAppStoreDigitalPurchaseStartHandler } from "../src/moments/integration/app-store-routes.mjs";

const TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const moment = {
  id: "m1",
  userId: "u1",
  roundId: "r1",
  momentType: "ROUND",
  digitalAsset: "private://moments/m1/digital.svg"
};
const catalog = {
  DIGITAL_ROUND: {
    amountMinor: 690,
    currency: "EUR",
    appStoreProductId: "configured.birdieworld.moment.round.v1"
  },
  DIGITAL_PERSONAL_BEST: {
    amountMinor: 990,
    currency: "EUR",
    appStoreProductId: "configured.birdieworld.moment.pb.v1"
  }
};

function makeRepo() {
  let purchase = null;
  let intent = null;
  const transactions = new Set();
  return {
    get purchase() { return purchase; },
    get intent() { return intent; },
    async getMoment(id) { return id === moment.id ? moment : null; },
    async ensurePurchase(input) {
      purchase ??= { id: "p1", entitlementGrantedAt: null, paymentReference: null, ...input };
      return purchase;
    },
    async getPurchase(id) { return id === "p1" ? purchase : null; },
    async ensureAppStorePurchaseIntent(input) { intent ??= { ...input }; return intent; },
    async getAppStorePurchaseIntent(id) { return id === "p1" ? intent : null; },
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

function analyticsSink() {
  const events = [];
  return {
    events,
    async track(name, payload) { events.push({ name, payload }); }
  };
}

function verifiedTransaction(overrides = {}) {
  return {
    transactionId: "tx-1",
    originalTransactionId: "tx-1",
    productId: catalog.DIGITAL_ROUND.appStoreProductId,
    appAccountToken: TOKEN,
    type: "Consumable",
    quantity: 1,
    environment: "Sandbox",
    price: 6900,
    currency: "EUR",
    purchaseDate: 1788480000000,
    signedDate: 1788480000500,
    ...overrides
  };
}

test("server creates StoreKit intent with configured product id and server account token", async () => {
  const repo = makeRepo();
  const analytics = analyticsSink();
  const result = await startAppStoreDigitalPurchase({
    authUserId: "u1",
    momentId: "m1",
    appAccountToken: TOKEN,
    repo,
    catalog,
    analytics
  });
  assert.equal(result.status, "STOREKIT_READY");
  assert.equal(result.appStoreProductId, catalog.DIGITAL_ROUND.appStoreProductId);
  assert.equal(result.appAccountToken, TOKEN);
  assert.equal(repo.intent.appAccountToken, TOKEN);
  assert.equal(repo.purchase.amountMinor, 690);
  assert.equal(analytics.events[0].name, MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_STARTED);
});

test("invalid appAccountToken is rejected before an IAP intent exists", async () => {
  await assert.rejects(
    startAppStoreDigitalPurchase({
      authUserId: "u1", momentId: "m1", appAccountToken: "not-a-uuid", repo: makeRepo(), catalog
    }),
    (error) => error.code === "APPLE_ACCOUNT_TOKEN_INVALID"
  );
});

test("verified consumable Apple transaction grants digital entitlement exactly once", async () => {
  const repo = makeRepo();
  const analytics = analyticsSink();
  await startAppStoreDigitalPurchase({ authUserId: "u1", momentId: "m1", appAccountToken: TOKEN, repo, catalog, analytics });
  const args = {
    authUserId: "u1",
    purchaseId: "p1",
    signedTransactionInfo: "verified-jws",
    repo,
    catalog,
    analytics,
    appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction(); } },
    now: () => "2026-09-04T01:00:00Z"
  };
  const first = await confirmAppStoreDigitalPurchase(args);
  const second = await confirmAppStoreDigitalPurchase(args);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(repo.purchase.paymentStatus, PAYMENT_STATUS.PAID);
  assert.equal(repo.purchase.entitlementGrantedAt, "2026-09-04T01:00:00Z");
  assert.equal(analytics.events.filter((event) => event.name === MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED).length, 1);
});

test("mismatched App Store product never grants entitlement", async () => {
  const repo = makeRepo();
  await startAppStoreDigitalPurchase({ authUserId: "u1", momentId: "m1", appAccountToken: TOKEN, repo, catalog });
  await assert.rejects(
    confirmAppStoreDigitalPurchase({
      authUserId: "u1", purchaseId: "p1", signedTransactionInfo: "jws", repo, catalog,
      appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction({ productId: "attacker.product" }); } }
    }),
    (error) => error.code === "APPLE_PRODUCT_MISMATCH"
  );
  assert.equal(repo.purchase.entitlementGrantedAt, null);
});

test("mismatched App Store account token never grants entitlement", async () => {
  const repo = makeRepo();
  await startAppStoreDigitalPurchase({ authUserId: "u1", momentId: "m1", appAccountToken: TOKEN, repo, catalog });
  await assert.rejects(
    confirmAppStoreDigitalPurchase({
      authUserId: "u1", purchaseId: "p1", signedTransactionInfo: "jws", repo, catalog,
      appleVerifier: { async verifyAndDecodeTransaction() { return verifiedTransaction({ appAccountToken: "123e4567-e89b-42d3-a456-426614174999" }); } }
    }),
    (error) => error.code === "APPLE_ACCOUNT_TOKEN_MISMATCH"
  );
});

test("non-consumable and revoked transactions fail closed", async () => {
  for (const transaction of [
    verifiedTransaction({ type: "Non-Consumable" }),
    verifiedTransaction({ revocationDate: 1788480001000 })
  ]) {
    const repo = makeRepo();
    await startAppStoreDigitalPurchase({ authUserId: "u1", momentId: "m1", appAccountToken: TOKEN, repo, catalog });
    await assert.rejects(
      confirmAppStoreDigitalPurchase({
        authUserId: "u1", purchaseId: "p1", signedTransactionInfo: "jws", repo, catalog,
        appleVerifier: { async verifyAndDecodeTransaction() { return transaction; } }
      }),
      (error) => ["APPLE_PRODUCT_TYPE_INVALID", "APPLE_TRANSACTION_REVOKED"].includes(error.code)
    );
  }
});

test("native start route creates server-only per-purchase appAccountToken and ignores request body", async () => {
  const repo = makeRepo();
  let jsonBody;
  const handler = createAppStoreDigitalPurchaseStartHandler({
    authenticate: async () => ({ id: "u1" }),
    purchaseTokenFactory: async () => TOKEN,
    repo,
    catalog,
    json(_res, _status, body) { jsonBody = body; return body; }
  });
  await handler({ body: { appAccountToken: "attacker" }, params: { momentId: "m1" } }, {}, { momentId: "m1" });
  assert.equal(jsonBody.appAccountToken, TOKEN);
  assert.equal(repo.intent.appAccountToken, TOKEN);
});

test("official Apple server-library adapter delegates to SignedDataVerifier for BirdiePhone bundle", async () => {
  const captured = {};
  class FakeVerifier {
    constructor(...args) { captured.args = args; }
    async verifyAndDecodeTransaction(jws) { captured.jws = jws; return verifiedTransaction(); }
  }
  const verifier = await createAppleSignedTransactionVerifier({
    appleRootCertificates: [Buffer.from("root")],
    environment: "SANDBOX",
    bundleId: "de.birdieandbreakfast.birdie",
    libraryLoader: async () => ({
      SignedDataVerifier: FakeVerifier,
      Environment: { SANDBOX: "Sandbox", PRODUCTION: "Production" }
    })
  });
  const decoded = await verifier.verifyAndDecodeTransaction("signed-jws");
  assert.equal(decoded.transactionId, "tx-1");
  assert.equal(captured.jws, "signed-jws");
  assert.equal(captured.args[3], "de.birdieandbreakfast.birdie");
});
