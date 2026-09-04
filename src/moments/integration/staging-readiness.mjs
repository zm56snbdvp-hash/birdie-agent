import { BIRDIE_IOS_APP } from "../commerce/apple-app-config.mjs";
import { BIRDIE_MOMENTS_APP_STORE_PRODUCTS } from "../commerce/apple-products.mjs";
import { PRODUCT_TYPE } from "../commerce/contracts.mjs";

export const MOMENTS_CONFIG_KEY = Object.freeze({
  // Deprecated: App Store product IDs are now canonical product constants, not runtime secrets/config.
  IAP_ROUND_PRODUCT_ID: "BIRDIE_MOMENTS_IAP_ROUND_PRODUCT_ID",
  IAP_PB_PRODUCT_ID: "BIRDIE_MOMENTS_IAP_PB_PRODUCT_ID",
  APP_STORE_ENVIRONMENT: "BIRDIE_MOMENTS_APP_STORE_ENVIRONMENT",
  APP_APPLE_ID: "BIRDIE_MOMENTS_APP_APPLE_ID",
  GELATO_API_KEY: "BIRDIE_MOMENTS_GELATO_API_KEY",
  GELATO_A3_PRODUCT_UID: "BIRDIE_MOMENTS_GELATO_A3_PRODUCT_UID"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function configured(value) {
  return Boolean(text(value));
}

function runtimeCheck(value) {
  return value === true;
}

function missingIf(list, condition, code) {
  if (!condition) list.push(code);
}

function normalizeEnvironment(value) {
  const normalized = text(value).toUpperCase();
  return ["SANDBOX", "PRODUCTION"].includes(normalized) ? normalized : null;
}

function validAppAppleId(value) {
  if (Number.isInteger(value) && value > 0) return true;
  const normalized = text(value);
  return /^\d+$/.test(normalized) && Number(normalized) > 0;
}

function canonicalProductIds() {
  return Object.freeze({
    round: BIRDIE_MOMENTS_APP_STORE_PRODUCTS[PRODUCT_TYPE.DIGITAL_ROUND].productId,
    personalBest: BIRDIE_MOMENTS_APP_STORE_PRODUCTS[PRODUCT_TYPE.DIGITAL_PERSONAL_BEST].productId
  });
}

/**
 * Readiness output is deliberately metadata-only. It never returns secret values,
 * certificate contents, provider product UIDs, or payment/provider credentials.
 * App Store product IDs are public product identifiers and are safe to expose.
 */
export function evaluateBirdieMomentsStagingReadiness({ env = {}, runtime = {} } = {}) {
  const coreMissing = [];
  missingIf(coreMissing, runtimeCheck(runtime.authAdapter), "AUTH_ADAPTER");
  missingIf(coreMissing, runtimeCheck(runtime.roundSource), "ROUND_SOURCE");
  missingIf(coreMissing, runtimeCheck(runtime.d1), "D1_DATABASE");
  missingIf(coreMissing, runtimeCheck(runtime.assetSigner), "PRIVATE_ASSET_SIGNER");

  const digitalMissing = [];
  const appStoreEnvironment = normalizeEnvironment(env[MOMENTS_CONFIG_KEY.APP_STORE_ENVIRONMENT]);
  missingIf(digitalMissing, appStoreEnvironment !== null, "APP_STORE_ENVIRONMENT");
  missingIf(digitalMissing, runtimeCheck(runtime.appStoreProductsConfigured), "APP_STORE_PRODUCTS_CONFIGURED");
  missingIf(digitalMissing, runtimeCheck(runtime.appleRootCertificates), "APPLE_ROOT_CERTIFICATES");
  missingIf(digitalMissing, runtimeCheck(runtime.appleServerLibrary), "APPLE_SERVER_LIBRARY");
  if (appStoreEnvironment === "PRODUCTION") {
    missingIf(digitalMissing, validAppAppleId(env[MOMENTS_CONFIG_KEY.APP_APPLE_ID]), "APP_APPLE_ID");
  }

  const printMissing = [];
  missingIf(printMissing, configured(env[MOMENTS_CONFIG_KEY.GELATO_API_KEY]), "GELATO_API_KEY");
  missingIf(printMissing, configured(env[MOMENTS_CONFIG_KEY.GELATO_A3_PRODUCT_UID]), "GELATO_A3_PRODUCT_UID");
  missingIf(printMissing, runtimeCheck(runtime.printPaymentProvider), "PRINT_PAYMENT_PROVIDER");
  missingIf(printMissing, runtimeCheck(runtime.gelatoWebhookVerifier), "GELATO_WEBHOOK_VERIFIER");

  const coreReady = coreMissing.length === 0;
  const digitalReady = coreReady && digitalMissing.length === 0;
  const printReady = coreReady && printMissing.length === 0;

  return Object.freeze({
    status: coreReady && digitalReady && printReady ? "READY" : "CONFIGURATION_REQUIRED",
    ready: coreReady && digitalReady && printReady,
    core: Object.freeze({ ready: coreReady, missing: Object.freeze(coreMissing) }),
    digital: Object.freeze({
      ready: digitalReady,
      missing: Object.freeze(digitalMissing),
      bundleId: BIRDIE_IOS_APP.bundleId,
      environment: appStoreEnvironment,
      productIds: canonicalProductIds()
    }),
    print: Object.freeze({ ready: printReady, missing: Object.freeze(printMissing) })
  });
}

/**
 * Creates the server-authoritative product catalog from canonical product IDs.
 * Product IDs are immutable commerce identifiers; only prices/currency remain deliberate deployment inputs.
 */
export function buildBirdieMomentsCatalogFromConfig({ pricing = {} } = {}) {
  return Object.freeze({
    [PRODUCT_TYPE.DIGITAL_ROUND]: Object.freeze({
      amountMinor: Number.isInteger(pricing.digitalRoundMinor) ? pricing.digitalRoundMinor : 690,
      currency: text(pricing.currency) || "EUR",
      appStoreProductId: BIRDIE_MOMENTS_APP_STORE_PRODUCTS[PRODUCT_TYPE.DIGITAL_ROUND].productId
    }),
    [PRODUCT_TYPE.DIGITAL_PERSONAL_BEST]: Object.freeze({
      amountMinor: Number.isInteger(pricing.personalBestDigitalMinor) ? pricing.personalBestDigitalMinor : 990,
      currency: text(pricing.currency) || "EUR",
      appStoreProductId: BIRDIE_MOMENTS_APP_STORE_PRODUCTS[PRODUCT_TYPE.DIGITAL_PERSONAL_BEST].productId
    }),
    [PRODUCT_TYPE.PRINT_A3]: Object.freeze({
      amountMinor: Number.isInteger(pricing.premiumA3PrintMinor) ? pricing.premiumA3PrintMinor : 3490,
      currency: text(pricing.currency) || "EUR"
    })
  });
}
