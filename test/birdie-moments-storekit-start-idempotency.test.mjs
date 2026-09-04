import test from "node:test";
import assert from "node:assert/strict";
import { startAppStoreDigitalPurchase } from "../src/moments/commerce/apple-iap.mjs";

const TOKEN_ONE = "123e4567-e89b-42d3-a456-426614174001";
const TOKEN_TWO = "123e4567-e89b-42d3-a456-426614174002";
const moment = {
  id: "m1",
  userId: "u1",
  roundId: "r1",
  momentType: "ROUND",
  digitalAsset: "private://digital.svg"
};
const catalog = {
  DIGITAL_ROUND: {
    amountMinor: 690,
    currency: "EUR",
    appStoreProductId: "configured.birdieworld.moment.round.v1"
  }
};

test("repeated StoreKit start reuses the original purchase intent and account token", async () => {
  let purchase;
  let intent;
  let intentCreates = 0;
  const repo = {
    async getMoment(id) { return id === moment.id ? moment : null; },
    async ensurePurchase(input) {
      purchase ??= { id: "p1", entitlementGrantedAt: null, ...input };
      return purchase;
    },
    async getAppStorePurchaseIntent(id) {
      return id === "p1" ? intent : null;
    },
    async ensureAppStorePurchaseIntent(input) {
      intentCreates += 1;
      intent ??= { ...input };
      return intent;
    }
  };

  const first = await startAppStoreDigitalPurchase({
    authUserId: "u1",
    momentId: "m1",
    appAccountToken: TOKEN_ONE,
    repo,
    catalog
  });
  const second = await startAppStoreDigitalPurchase({
    authUserId: "u1",
    momentId: "m1",
    appAccountToken: TOKEN_TWO,
    repo,
    catalog
  });

  assert.equal(first.purchaseId, "p1");
  assert.equal(second.purchaseId, "p1");
  assert.equal(first.appAccountToken, TOKEN_ONE);
  assert.equal(second.appAccountToken, TOKEN_ONE);
  assert.equal(intentCreates, 1);
});
