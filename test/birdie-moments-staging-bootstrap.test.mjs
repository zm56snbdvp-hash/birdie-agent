import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  BIRDIE_MOMENTS_APP_STORE_TARGET,
  createAppStoreConnectJWT,
  buildCreateInAppPurchaseRequest,
  buildCreateLocalizationRequest,
  buildCreatePriceScheduleRequest,
  planOrApplyAppStoreConnectBootstrap
} from "../src/moments/staging/app-store-connect-bootstrap.mjs";
import {
  discoverGelatoA3PosterProducts,
  validateConfiguredGelatoA3Product
} from "../src/moments/staging/gelato-catalog-discovery.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test("canonical Birdie Moments IAP IDs are valid, stable consumables", () => {
  assert.equal(BIRDIE_MOMENTS_APP_STORE_TARGET.bundleId, "de.birdieandbreakfast.birdie");
  assert.deepEqual(
    BIRDIE_MOMENTS_APP_STORE_TARGET.products.map((product) => product.productId),
    [
      "de.birdieandbreakfast.birdie.moments.round.v1",
      "de.birdieandbreakfast.birdie.moments.personalbest.v1"
    ]
  );
  for (const product of BIRDIE_MOMENTS_APP_STORE_TARGET.products) {
    assert.equal(product.inAppPurchaseType, "CONSUMABLE");
    assert.match(product.productId, /^[A-Za-z0-9._-]+$/);
    assert.ok(product.productId.length <= 100);
    assert.ok(product.referenceName.length <= 64);
  }
});

test("App Store Connect JWT uses ES256 team-key claims and short lifetime", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = createAppStoreConnectJWT({
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    privateKey: pem,
    nowSeconds: 1_700_000_000,
    lifetimeSeconds: 120
  });
  const [headerPart, payloadPart, signaturePart] = jwt.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "ES256", kid: "2X9R4HXF34", typ: "JWT" });
  assert.equal(payload.aud, "appstoreconnect-v1");
  assert.equal(payload.iss, "57246542-96fe-1a63-e053-0824d011072a");
  assert.equal(payload.exp - payload.iat, 120);
  assert.ok(signaturePart.length > 20);
});

test("Apple create/localization/price payloads use the canonical resource relationships", () => {
  const product = BIRDIE_MOMENTS_APP_STORE_TARGET.products[0];
  const create = buildCreateInAppPurchaseRequest({ appId: "app-1", product });
  assert.equal(create.data.type, "inAppPurchases");
  assert.equal(create.data.attributes.productId, product.productId);
  assert.equal(create.data.attributes.inAppPurchaseType, "CONSUMABLE");
  assert.deepEqual(create.data.relationships.app.data, { type: "apps", id: "app-1" });

  const localization = buildCreateLocalizationRequest({
    iapId: "iap-1",
    locale: "de-DE",
    localization: product.localization
  });
  assert.equal(localization.data.type, "inAppPurchaseLocalizations");
  assert.equal(localization.data.relationships.inAppPurchase.data.id, "iap-1");

  const price = buildCreatePriceScheduleRequest({
    iapId: "iap-1",
    baseTerritory: "DEU",
    pricePointId: "price-690"
  });
  assert.equal(price.data.type, "inAppPurchasePriceSchedules");
  assert.equal(price.data.relationships.baseTerritory.data.id, "DEU");
  assert.equal(price.included[0].relationships.inAppPurchasePricePoint.data.id, "price-690");
  assert.equal(price.included[0].attributes.startDate, null);
});

test("App Store dry-run never creates missing products", async () => {
  const calls = [];
  const client = {
    async request(path, options = {}) {
      calls.push({ path, method: options.method ?? "GET" });
      if (path.startsWith("/v1/apps?")) return { data: [{ id: "app-1" }] };
      if (path.startsWith("/v1/apps/app-1/inAppPurchasesV2?")) return { data: [] };
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await planOrApplyAppStoreConnectBootstrap({ client, apply: false });
  assert.deepEqual(result.products.map((entry) => entry.status), ["CREATE_REQUIRED", "CREATE_REQUIRED"]);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("App Store dry-run recognizes existing consumables with exact German price points", async () => {
  const target = BIRDIE_MOMENTS_APP_STORE_TARGET;
  const iaps = target.products.map((product, index) => ({
    id: `iap-${index + 1}`,
    attributes: {
      productId: product.productId,
      inAppPurchaseType: "CONSUMABLE",
      state: "READY_TO_SUBMIT"
    }
  }));
  const client = {
    async request(path) {
      if (path.startsWith("/v1/apps?")) return { data: [{ id: "app-1" }] };
      if (path.startsWith("/v1/apps/app-1/inAppPurchasesV2?")) return { data: iaps };
      if (path.includes("/pricePoints?")) {
        const price = path.includes("iap-1") ? "6.90" : "9.90";
        return { data: [{ id: `pp-${price}`, attributes: { customerPrice: price } }] };
      }
      if (path.includes("?include=inAppPurchaseLocalizations")) {
        return { included: [{ type: "inAppPurchaseLocalizations", attributes: { locale: "de-DE" } }] };
      }
      if (path.includes("/iapPriceSchedule?")) return { data: { id: "schedule" } };
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await planOrApplyAppStoreConnectBootstrap({ client, apply: false });
  assert.deepEqual(result.products.map((entry) => entry.status), ["READY", "READY"]);
  assert.deepEqual(result.products.map((entry) => entry.targetCustomerPrice), ["6.90", "9.90"]);
});

test("Gelato discovery requests only A3 portrait poster candidates", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/v3/catalogs/posters")) {
      return jsonResponse(200, {
        productAttributes: [
          { productAttributeUid: "PaperFormat", values: [{ productAttributeValueUid: "A3" }] },
          { productAttributeUid: "Orientation", values: [{ productAttributeValueUid: "ver" }] }
        ]
      });
    }
    if (url.endsWith("/v3/catalogs/posters/products:search")) {
      return jsonResponse(200, {
        products: [
          { productUid: "poster-a3-premium", attributes: { PaperFormat: "A3", Orientation: "ver", PaperType: "premium" } },
          { productUid: "poster-a4-wrong", attributes: { PaperFormat: "A4", Orientation: "ver" } }
        ]
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const result = await discoverGelatoA3PosterProducts({ apiKey: "secret-not-output", fetchImpl });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0].productUid, "poster-a3-premium");
  const searchCall = calls.find((call) => call.url.endsWith("products:search"));
  const body = JSON.parse(searchCall.options.body);
  assert.deepEqual(body.attributeFilters, { PaperFormat: ["A3"], Orientation: ["ver"] });
});

test("configured Gelato UID must validate as printable A3 portrait", async () => {
  const fetchImpl = async () => jsonResponse(200, {
    productUid: "poster-a3",
    isPrintable: true,
    attributes: { PaperFormat: "A3", Orientation: "ver" }
  });
  const result = await validateConfiguredGelatoA3Product({
    apiKey: "secret-not-output",
    productUid: "poster-a3",
    fetchImpl
  });
  assert.equal(result.status, "READY");
});
