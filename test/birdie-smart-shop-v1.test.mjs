import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMERCE_CATEGORY,
  PLAYER_FOCUS,
  validateAffiliateProduct
} from "../src/affiliate-commerce/contracts.mjs";
import { recommendAffiliateProducts } from "../src/affiliate-commerce/recommend.mjs";
import { buildAffiliateClick, buildCommerceDisclosure } from "../src/affiliate-commerce/click.mjs";

function product(overrides = {}) {
  return {
    id: "balls-1",
    provider: "golf-house",
    title: "Golf Balls",
    category: COMMERCE_CATEGORY.BALLS,
    price: 39.99,
    currency: "EUR",
    active: true,
    available: true,
    regions: ["DE"],
    affiliateUrl: "https://example.com/affiliate/balls",
    priority: 0,
    ...overrides
  };
}

test("valid product passes the fail-closed catalog contract", () => {
  assert.deepEqual(validateAffiliateProduct(product()), { valid: true, missing: [] });
});

test("inactive, unavailable or unsafe URL products fail closed", () => {
  assert.equal(validateAffiliateProduct(product({ active: false })).valid, false);
  assert.equal(validateAffiliateProduct(product({ available: false })).valid, false);
  assert.equal(validateAffiliateProduct(product({ affiliateUrl: "javascript:alert(1)" })).valid, false);
});

test("recommendations exclude products unavailable in the player's region", () => {
  const result = recommendAffiliateProducts({
    products: [product({ regions: ["US"] })],
    playerContext: { region: "DE", focuses: [PLAYER_FOCUS.ESSENTIALS] }
  });
  assert.equal(result.length, 0);
});

test("essentials focus ranks balls and gloves above unrelated training products", () => {
  const products = [
    product(),
    product({ id: "glove-1", provider: "decathlon", category: COMMERCE_CATEGORY.GLOVES, title: "Golf Glove", price: 14.99 }),
    product({ id: "training-1", provider: "superspeed", category: COMMERCE_CATEGORY.TRAINING, title: "Training Aid", price: 199 })
  ];
  const result = recommendAffiliateProducts({
    products,
    playerContext: { region: "DE", focuses: [PLAYER_FOCUS.ESSENTIALS] },
    limit: 3
  });
  assert.equal(result[0].category, COMMERCE_CATEGORY.BALLS);
  assert.equal(result[1].category, COMMERCE_CATEGORY.GLOVES);
});

test("distance focus ranks rangefinder first", () => {
  const products = [
    product(),
    product({ id: "range-1", provider: "shot-scope", category: COMMERCE_CATEGORY.RANGEFINDER, title: "Rangefinder", price: 199 })
  ];
  const result = recommendAffiliateProducts({
    products,
    playerContext: { region: "DE", focuses: [PLAYER_FOCUS.DISTANCE] }
  });
  assert.equal(result[0].id, "range-1");
});

test("recent-round signal gently boosts consumable balls without overriding explicit focus", () => {
  const products = [
    product(),
    product({ id: "range-1", provider: "shot-scope", category: COMMERCE_CATEGORY.RANGEFINDER, title: "Rangefinder", price: 199 })
  ];
  const result = recommendAffiliateProducts({
    products,
    playerContext: { region: "DE", focuses: [PLAYER_FOCUS.DISTANCE], recentRoundCompleted: true }
  });
  assert.equal(result[0].id, "range-1");
});

test("top recommendations prefer provider diversity when scores are comparable", () => {
  const products = [
    product({ id: "a1", provider: "a", priority: 30 }),
    product({ id: "a2", provider: "a", category: COMMERCE_CATEGORY.GLOVES, title: "Glove A", priority: 29 }),
    product({ id: "b1", provider: "b", category: COMMERCE_CATEGORY.TEES, title: "Tees B", priority: 28 })
  ];
  const result = recommendAffiliateProducts({ products, playerContext: { region: "DE" }, limit: 2 });
  assert.deepEqual(result.map((x) => x.provider), ["a", "b"]);
});

test("click event keeps attribution data internal and returns the provider destination", () => {
  const click = buildAffiliateClick({
    product: product(),
    userId: "u-1",
    placement: "for-your-game",
    clickId: "click-1",
    occurredAt: "2026-09-04T03:30:00+02:00"
  });
  assert.equal(click.productId, "balls-1");
  assert.equal(click.provider, "golf-house");
  assert.equal(click.destinationUrl, "https://example.com/affiliate/balls");
});

test("German disclosure clearly identifies the commercial relationship", () => {
  assert.match(buildCommerceDisclosure("de-DE"), /Provision/);
  assert.match(buildCommerceDisclosure("de-DE"), /Preis nicht/);
});
