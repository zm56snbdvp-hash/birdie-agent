import test from "node:test";
import assert from "node:assert/strict";
import {
  MOMENTS_CONFIG_KEY,
  buildBirdieMomentsCatalogFromConfig,
  evaluateBirdieMomentsStagingReadiness
} from "../src/moments/integration/staging-readiness.mjs";

function fullRuntime() {
  return {
    authAdapter: true,
    roundSource: true,
    d1: true,
    assetSigner: true,
    appleRootCertificates: true,
    appleServerLibrary: true,
    printPaymentProvider: true,
    gelatoWebhookVerifier: true
  };
}

function sandboxEnv() {
  return {
    [MOMENTS_CONFIG_KEY.IAP_ROUND_PRODUCT_ID]: "de.birdieandbreakfast.birdie.moment.round",
    [MOMENTS_CONFIG_KEY.IAP_PB_PRODUCT_ID]: "de.birdieandbreakfast.birdie.moment.pb",
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
  assert.ok(result.digital.missing.includes("IAP_ROUND_PRODUCT_ID"));
  assert.ok(result.print.missing.includes("GELATO_API_KEY"));
});

test("complete sandbox configuration is READY without production appAppleId", () => {
  const result = evaluateBirdieMomentsStagingReadiness({ env: sandboxEnv(), runtime: fullRuntime() });
  assert.equal(result.ready, true);
  assert.equal(result.digital.bundleId, "de.birdieandbreakfast.birdie");
  assert.equal(result.digital.environment, "SANDBOX");
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

test("readiness result never leaks Gelato key, product UID or IAP product identifiers", () => {
  const env = sandboxEnv();
  const result = evaluateBirdieMomentsStagingReadiness({ env, runtime: fullRuntime() });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.GELATO_API_KEY]), false);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.GELATO_A3_PRODUCT_UID]), false);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.IAP_ROUND_PRODUCT_ID]), false);
  assert.equal(serialized.includes(env[MOMENTS_CONFIG_KEY.IAP_PB_PRODUCT_ID]), false);
});

test("catalog uses centralized defaults but never invents missing App Store product IDs", () => {
  const missing = buildBirdieMomentsCatalogFromConfig();
  assert.equal(missing.DIGITAL_ROUND.amountMinor, 690);
  assert.equal(missing.DIGITAL_PERSONAL_BEST.amountMinor, 990);
  assert.equal(missing.PRINT_A3.amountMinor, 3490);
  assert.equal(missing.DIGITAL_ROUND.appStoreProductId, null);

  const configured = buildBirdieMomentsCatalogFromConfig({ env: sandboxEnv() });
  assert.equal(configured.DIGITAL_ROUND.appStoreProductId, "de.birdieandbreakfast.birdie.moment.round");
  assert.equal(configured.DIGITAL_PERSONAL_BEST.appStoreProductId, "de.birdieandbreakfast.birdie.moment.pb");
});
