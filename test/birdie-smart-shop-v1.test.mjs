import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMERCE_CATEGORY,
  PLAYER_FOCUS,
  validateAffiliateProduct
} from "../src/affiliate-commerce/contracts.mjs";
import { recommendAffiliateProducts } from "../src/affiliate-commerce/recommend.mjs";
import { buildAffiliateClick, buildCommerceDisclosure } from "../src/affiliate-commerce/click.mjs";
import { createAffiliateCommerceService } from "../src/affiliate-commerce/service.mjs";
import {
  createCommerceRecommendationsHttpHandler,
  createCommerceOutboundHttpHandler
} from "../src/affiliate-commerce/integration/live-routes.mjs";
import {
  createAwinCatalogProvider,
  inferGolfCommerceCategory,
  mapAwinProduct
} from "../src/affiliate-commerce/providers/awin.mjs";

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

test("service hides raw affiliate URL from recommendation payload", async () => {
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [product()]; } },
    playerContextProvider: { async getContext() { return { region: "DE", focuses: [PLAYER_FOCUS.ESSENTIALS] }; } }
  });
  const result = await commerce.getRecommendations({ authUserId: "u-1" });
  assert.equal(result.items.length, 1);
  assert.equal("affiliateUrl" in result.items[0], false);
  assert.match(result.items[0].outboundPath, /^\/api\/commerce\/out\//);
});

test("outbound click resolves product server-side and records attribution before redirect", async () => {
  const recorded = [];
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [product()]; } },
    playerContextProvider: { async getContext() { return { region: "DE" }; } },
    clickIdFactory: async () => "click-fixed",
    clickSink: { async record(event) { recorded.push(event); } }
  });
  const result = await commerce.createOutboundClick({ authUserId: "u-1", productId: "balls-1", placement: "post-round" });
  assert.equal(result.destinationUrl, "https://example.com/affiliate/balls");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].clickId, "click-fixed");
  assert.equal(recorded[0].placement, "post-round");
});

test("outbound click fails closed for a product outside player region", async () => {
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [product({ regions: ["US"] })]; } },
    playerContextProvider: { async getContext() { return { region: "DE" }; } }
  });
  await assert.rejects(
    commerce.createOutboundClick({ authUserId: "u-1", productId: "balls-1" }),
    (error) => error.code === "PRODUCT_NOT_AVAILABLE" && error.status === 404
  );
});

test("recommendations HTTP handler requires authenticated app user", async () => {
  const handler = createCommerceRecommendationsHttpHandler({
    authenticate: async () => null,
    service: {},
    json(_res, status, body) { return { status, body }; }
  });
  const result = await handler({ url: "/api/commerce/recommendations" }, {});
  assert.deepEqual(result, { status: 401, body: { error: "AUTH_REQUIRED" } });
});

test("outbound HTTP handler records then returns 302 to provider", async () => {
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [product()]; } },
    playerContextProvider: { async getContext() { return { region: "DE" }; } },
    clickIdFactory: async () => "click-fixed"
  });
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name] = value; },
    end() { return "ended"; }
  };
  const handler = createCommerceOutboundHttpHandler({
    authenticate: async () => ({ id: "u-1" }),
    service: commerce
  });
  await handler({ url: "/api/commerce/out/balls-1?placement=for-your-game" }, res, { productId: "balls-1" });
  assert.equal(res.statusCode, 302);
  assert.equal(headers.Location, "https://example.com/affiliate/balls");
  assert.equal(headers["Cache-Control"], "private, no-store");
});

test("Awin mapper recognizes golf retail categories from feed fields", () => {
  assert.equal(inferGolfCommerceCategory({ product_name: "Tour Golf Balls 12 Pack" }), COMMERCE_CATEGORY.BALLS);
  assert.equal(inferGolfCommerceCategory({ category_name: "Golf Gloves" }), COMMERCE_CATEGORY.GLOVES);
  assert.equal(inferGolfCommerceCategory({ merchant_category: "Laser Rangefinder" }), COMMERCE_CATEGORY.RANGEFINDER);
  assert.equal(inferGolfCommerceCategory({ product_name: "Unrelated Polo Shirt" }), null);
});

test("Awin mapper uses tracked deep link, price and stock fields", () => {
  const mapped = mapAwinProduct({
    merchant_id: "11593",
    merchant_name: "Golf Retailer",
    aw_product_id: "p-1",
    product_name: "Premium Golf Balls",
    aw_deep_link: "https://www.awin1.com/cread.php?awinmid=11593&awinaffid=123",
    search_price: "39.99",
    currency: "EUR",
    in_stock: "1",
    is_for_sale: "1",
    aw_image_url: "https://images.example.com/balls.jpg"
  });
  assert.equal(mapped.id, "awin:11593:p-1");
  assert.equal(mapped.price, 39.99);
  assert.equal(mapped.available, true);
  assert.equal(mapped.active, true);
});

test("Awin mapper keeps out-of-stock products fail-closed", () => {
  const mapped = mapAwinProduct({
    merchant_id: "11593",
    aw_product_id: "p-1",
    product_name: "Premium Golf Balls",
    aw_deep_link: "https://www.awin1.com/cread.php?x=1",
    search_price: "39,99",
    stock_status: "out of stock"
  });
  assert.equal(mapped.available, false);
});

test("Awin mapper drops unrelated or unsafe feed rows", () => {
  assert.equal(mapAwinProduct({
    merchant_id: "1",
    aw_product_id: "x",
    product_name: "Polo Shirt",
    aw_deep_link: "https://example.com/x",
    search_price: "20"
  }), null);
  assert.equal(mapAwinProduct({
    merchant_id: "1",
    aw_product_id: "x",
    product_name: "Golf Balls",
    aw_deep_link: "javascript:alert(1)",
    search_price: "20"
  }), null);
});

test("Awin catalog provider combines feeds and deduplicates by canonical product id", async () => {
  const row = {
    merchant_id: "11593",
    aw_product_id: "p-1",
    product_name: "Premium Golf Balls",
    aw_deep_link: "https://www.awin1.com/cread.php?x=1",
    search_price: "39.99",
    in_stock: "1"
  };
  const provider = createAwinCatalogProvider({
    feeds: [{ id: "feed-a" }, { id: "feed-b" }],
    loadRows: async () => [row]
  });
  const products = await provider.listProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "awin:11593:p-1");
});
