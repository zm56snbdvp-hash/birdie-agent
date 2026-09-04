import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { BIRDIE_IOS_APP } from "../commerce/apple-app-config.mjs";
import { BIRDIE_MOMENTS_APP_STORE_PRODUCTS } from "../commerce/apple-products.mjs";

const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";

export const BIRDIE_MOMENTS_APP_STORE_TARGET = Object.freeze({
  bundleId: BIRDIE_IOS_APP.bundleId,
  baseTerritory: "DEU",
  locale: "de-DE",
  products: Object.freeze(Object.values(BIRDIE_MOMENTS_APP_STORE_PRODUCTS))
});

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createAppStoreConnectJWT({
  issuerId,
  keyId,
  privateKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  lifetimeSeconds = 120
}) {
  const iss = requireText(issuerId, "App Store Connect issuer ID");
  const kid = requireText(keyId, "App Store Connect key ID");
  const pem = requireText(privateKey, "App Store Connect private key");
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 30 || lifetimeSeconds > 1200) {
    throw new Error("App Store Connect JWT lifetime must be 30–1200 seconds");
  }

  const header = { alg: "ES256", kid, typ: "JWT" };
  const payload = {
    iss,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
    aud: "appstoreconnect-v1"
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363"
  });
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

export function createAppStoreConnectClient({
  issuerId,
  keyId,
  privateKey,
  fetchImpl = globalThis.fetch,
  nowSeconds
}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const jwt = createAppStoreConnectJWT({ issuerId, keyId, privateKey, nowSeconds });

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${ASC_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`App Store Connect HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return Object.freeze({ request });
}

export function buildCreateInAppPurchaseRequest({ appId, product }) {
  return {
    data: {
      type: "inAppPurchases",
      attributes: {
        name: product.referenceName,
        productId: product.productId,
        inAppPurchaseType: product.inAppPurchaseType
      },
      relationships: {
        app: { data: { type: "apps", id: appId } }
      }
    }
  };
}

export function buildCreateLocalizationRequest({ iapId, locale, localization }) {
  return {
    data: {
      type: "inAppPurchaseLocalizations",
      attributes: {
        locale,
        name: localization.name,
        description: localization.description
      },
      relationships: {
        inAppPurchase: { data: { type: "inAppPurchases", id: iapId } }
      }
    }
  };
}

export function buildCreatePriceScheduleRequest({ iapId, baseTerritory, pricePointId }) {
  const localPriceId = "${birdieMomentPrice1}";
  return {
    data: {
      type: "inAppPurchasePriceSchedules",
      relationships: {
        baseTerritory: { data: { type: "territories", id: baseTerritory } },
        inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
        manualPrices: { data: [{ type: "inAppPurchasePrices", id: localPriceId }] }
      }
    },
    included: [{
      type: "inAppPurchasePrices",
      id: localPriceId,
      attributes: { startDate: null, endDate: null },
      relationships: {
        inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } },
        inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } }
      }
    }]
  };
}

function exactPricePoint(data, targetCustomerPrice) {
  const target = Number(targetCustomerPrice);
  const rows = Array.isArray(data) ? data : [];
  const exact = rows.find((row) => Number(row?.attributes?.customerPrice) === target);
  if (exact) return { exact, nearest: [] };
  const nearest = rows
    .filter((row) => Number.isFinite(Number(row?.attributes?.customerPrice)))
    .map((row) => ({ row, delta: Math.abs(Number(row.attributes.customerPrice) - target) }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5)
    .map(({ row }) => ({ id: row.id, customerPrice: row.attributes.customerPrice }));
  return { exact: null, nearest };
}

async function findApp(client, bundleId) {
  const query = new URLSearchParams({ "filter[bundleId]": bundleId, limit: "2" });
  const response = await client.request(`/v1/apps?${query}`);
  const apps = response?.data ?? [];
  if (apps.length !== 1) throw new Error(`Expected exactly one App Store app for ${bundleId}; found ${apps.length}`);
  return apps[0];
}

async function listIaps(client, appId) {
  const query = new URLSearchParams({ limit: "200", "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state" });
  return (await client.request(`/v1/apps/${encodeURIComponent(appId)}/inAppPurchasesV2?${query}`))?.data ?? [];
}

async function findGermanPricePoint(client, iapId, product, target) {
  const query = new URLSearchParams({
    "filter[territory]": target.baseTerritory,
    "fields[inAppPurchasePricePoints]": "customerPrice",
    limit: "8000"
  });
  const response = await client.request(`/v2/inAppPurchases/${encodeURIComponent(iapId)}/pricePoints?${query}`);
  return exactPricePoint(response?.data ?? [], product.targetCustomerPrice);
}

async function hasPriceSchedule(client, iapId) {
  try {
    await client.request(`/v2/inAppPurchases/${encodeURIComponent(iapId)}/iapPriceSchedule?fields[inAppPurchasePriceSchedules]=baseTerritory`);
    return true;
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
}

async function hasLocalization(client, iapId, locale) {
  const response = await client.request(`/v2/inAppPurchases/${encodeURIComponent(iapId)}?include=inAppPurchaseLocalizations&limit[inAppPurchaseLocalizations]=50`);
  const included = response?.included ?? [];
  return included.some((item) => item?.type === "inAppPurchaseLocalizations" && item?.attributes?.locale === locale);
}

export async function planOrApplyAppStoreConnectBootstrap({
  client,
  apply = false,
  target = BIRDIE_MOMENTS_APP_STORE_TARGET
}) {
  const app = await findApp(client, target.bundleId);
  let iaps = await listIaps(client, app.id);
  const results = [];

  for (const product of target.products) {
    let iap = iaps.find((item) => item?.attributes?.productId === product.productId) ?? null;
    let created = false;
    if (!iap && apply) {
      const createdResponse = await client.request("/v2/inAppPurchases", {
        method: "POST",
        body: buildCreateInAppPurchaseRequest({ appId: app.id, product })
      });
      iap = createdResponse?.data ?? null;
      created = true;
      iaps = [...iaps, iap];
    }

    if (!iap) {
      results.push({
        productType: product.productType,
        productId: product.productId,
        status: "CREATE_REQUIRED",
        targetCustomerPrice: product.targetCustomerPrice
      });
      continue;
    }

    if (iap.attributes?.inAppPurchaseType !== "CONSUMABLE") {
      results.push({ productType: product.productType, productId: product.productId, status: "TYPE_MISMATCH" });
      continue;
    }

    const pricePoint = await findGermanPricePoint(client, iap.id, product, target);
    if (!pricePoint.exact) {
      results.push({
        productType: product.productType,
        productId: product.productId,
        appStoreResourceId: iap.id,
        status: "EXACT_PRICE_POINT_UNAVAILABLE",
        targetCustomerPrice: product.targetCustomerPrice,
        nearestPricePoints: pricePoint.nearest
      });
      continue;
    }

    const locale = product.localization?.locale || target.locale;
    const [localized, priced] = await Promise.all([
      hasLocalization(client, iap.id, locale),
      hasPriceSchedule(client, iap.id)
    ]);

    if (apply && !localized) {
      await client.request("/v1/inAppPurchaseLocalizations", {
        method: "POST",
        body: buildCreateLocalizationRequest({
          iapId: iap.id,
          locale,
          localization: product.localization
        })
      });
    }

    if (apply && !priced) {
      await client.request("/v1/inAppPurchasePriceSchedules", {
        method: "POST",
        body: buildCreatePriceScheduleRequest({
          iapId: iap.id,
          baseTerritory: target.baseTerritory,
          pricePointId: pricePoint.exact.id
        })
      });
    }

    results.push({
      productType: product.productType,
      productId: product.productId,
      appStoreResourceId: iap.id,
      status: apply ? "CONFIGURED_OR_PRESERVED" : (localized && priced ? "READY" : "CONFIGURATION_REQUIRED"),
      created,
      localizationPresent: localized,
      priceSchedulePresent: priced,
      targetCustomerPrice: product.targetCustomerPrice,
      exactPricePointId: pricePoint.exact.id
    });
  }

  return Object.freeze({
    mode: apply ? "APPLY" : "DRY_RUN",
    app: { id: app.id, bundleId: target.bundleId },
    products: results
  });
}
