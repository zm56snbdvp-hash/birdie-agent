import test from "node:test";
import assert from "node:assert/strict";
import {
  MOMENTS_CONFIG_KEY,
  buildBirdieMomentsCatalogFromConfig,
  evaluateBirdieMomentsStagingReadiness
} from "../src/moments/integration/staging-readiness.mjs";

const ROUND_IAP = "de.birdieandbreakfast.birdie.moments.round.v1";
const PB_IAP = "de.birdieandbreakfast.birdie.moments.personalbest.v1";

function fullRuntime() {
  return {
    authAdapter: true,
    roundSource: true,
    d1: true,
    assetSigner: true,
    appStoreProductsConfigured: true,
    appleRootCertificates: true,
    appleServerLibrary: true,
    printPaymentProvider: true,
    gelatoWebhookVerifier: true
  };
}

function sandboxEnv() {
  return {
    [MOMENTS_CONFIG_KEY.APP_STORE_ENVIRONMENT]: "SANDBOX",
    [MOMENTS_CONFIG_KEY.GELATO_API_KEY]: "super-secret-key",
    [MOMENTS_CONFIG_KEY.GELATO_A3_PRODUCT_UID]: "gelato-a3-uid"
  };
}

test("empty staging configuration fails closed with named gates only", () => {
  const result = evaluateBirdieMomentsStagingReadiness();
  assert.equal(result.ready, false);
  assert.equal(result.status, "CONFIGURATION_REQUIRED");
  assert.ok(result.core.missing.includes("ROUND_SOURCE"));
  assert.ok(result.digital.missing.includes("APP_STORE_PRODUCTS_CONFIGURED"));
  assert.ok(result.print.missing.includes("GELATO_API_KEY"));
});

test("known product IDs alone never imply App Store configuration", () => {
  const runtime = fullRuntime();
  runtime.appStoreProductsConfigured = false;
  const result = evaluateBirdieMomentsStagingReadiness({ env: sandboxEnv(), runtime });
  assert.equal(result.digital.ready, false);
  assert.ok(result.digital.missing.includes("APP_STORE_PRODUCTS_CONFIGURED"));
  assert.deepEqual(result.digital.productIds, { round: ROUND_IAP, personalBest: PB_IAP });
});

test("complete sandbox configuration is READY without production appAppleId", () => {
  const result = evaluateBirdieMomentsStagingReadiness({ env: sandboxEnv(), runtime: fullRuntime() });
  assert.equal(result.ready, true);
  assert.equal(result.digital.bundleId, "de.birdieandbreakfast.birdie");
  assert.equal(result.digital.environment, "SANDBOX");
  assert.deepEqual(result.digital.productIds, { round: ROUND_IAP, personalBest: PB_IAP });
  assert.deepEqual(result.digital.missing, []);
});

test("production requires numeric App Apple ID", () => {
  const env = { ...sandboxEnv(), [MOMENTS_CONFIG_KEY.APP_STORE_ENVIRONMENT]: "PRODUCTION" };
  const result = evaluateBirdieMomentsStagingReadiness({ env, runtime: fullRuntime() });
  assert.equal(result.ready, false);
  assert.ok(result.digital.missing.includes("APP_APPLE_ID"));

  env[MOMENTS_CONFIG_KEY.APP_APPLE_ID] = "1234567890";
  assert.equal(evaluateBirdieMomentsStagingReadiness({ env, runtime: fullRuntime() }).ready, true);
});

test("readiness result leaks no provider secrets while public IAP identifiers remain observable", () => {
  const env = sandboxEnv();
  const result = evaluateBirdieMomentsStagingReadiness({ env, runtime: fullRuntime() });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.GELATO_API_KEY]), false);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.GELATO_A3_PRODUCT_UID]), false);
  assert.equal(serialized.includes(ROUND_IAP), true);
  assert.equal(serialized.includes(PB_IAP), true);
});

test("catalog pins canonical App Store IDs and centralized default prices", () => {
  const catalog = buildBirdieMomentsCatalogFromConfig();
  assert.equal(catalog.DIGITAL_ROUND.amountMinor, 690);
  assert.equal(catalog.DIGITAL_PERSONAL_BEST.amountMinor, 990);
  assert.equal(catalog.PRINT_A3.amountMinor, 3490);
  assert.equal(catalog.DIGITAL_ROUND.appStoreProductId, ROUND_IAP);
  assert.equal(catalog.DIGITAL_PERSONAL_BEST.appStoreProductId, PB_IAP);

  const customPricing = buildBirdieMomentsCatalogFromConfig({
    pricing: { digitalRoundMinor: 700, personalBestDigitalMinor: 1000, premiumA3PrintMinor: 3200, currency: "eur" }
  });
  assert.equal(customPricing.DIGITAL_ROUND.amountMinor, 700);
  assert.equal(customPricing.DIGITAL_PERSONAL_BEST.amountMinor, 1000);
  assert.equal(customPricing.PRINT_A3.amountMinor, 3200);
  assert.equal(customPricing.DIGITAL_ROUND.currency, "eur");
});
