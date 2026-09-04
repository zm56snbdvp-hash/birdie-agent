#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  BIRDIE_MOMENTS_APP_STORE_TARGET,
  createAppStoreConnectClient,
  planOrApplyAppStoreConnectBootstrap
} from "../src/moments/staging/app-store-connect-bootstrap.mjs";
import {
  discoverGelatoA3PosterProducts,
  validateConfiguredGelatoA3Product
} from "../src/moments/staging/gelato-catalog-discovery.mjs";

const args = new Set(process.argv.slice(2));
const applyAppStore = args.has("--apply-app-store");

function missing(names) {
  return names.filter((name) => typeof process.env[name] !== "string" || !process.env[name].trim());
}

async function privateKeyFromEnvironment() {
  if (process.env.APP_STORE_CONNECT_PRIVATE_KEY?.trim()) {
    return process.env.APP_STORE_CONNECT_PRIVATE_KEY;
  }
  if (process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH?.trim()) {
    return readFile(process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH, "utf8");
  }
  return null;
}

async function appStoreStatus() {
  const required = ["APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_KEY_ID"];
  const missingNames = missing(required);
  const privateKey = await privateKeyFromEnvironment();
  if (!privateKey) missingNames.push("APP_STORE_CONNECT_PRIVATE_KEY or APP_STORE_CONNECT_PRIVATE_KEY_PATH");
  if (missingNames.length) {
    return {
      status: "NOT_CONFIGURED",
      missing: missingNames,
      desired: {
        bundleId: BIRDIE_MOMENTS_APP_STORE_TARGET.bundleId,
        products: BIRDIE_MOMENTS_APP_STORE_TARGET.products.map((product) => ({
          productType: product.productType,
          productId: product.productId,
          type: product.inAppPurchaseType,
          targetCustomerPriceEUR: product.targetCustomerPrice
        }))
      }
    };
  }

  const client = createAppStoreConnectClient({
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    keyId: process.env.APP_STORE_CONNECT_KEY_ID,
    privateKey
  });
  return planOrApplyAppStoreConnectBootstrap({ client, apply: applyAppStore });
}

async function gelatoStatus() {
  if (!process.env.GELATO_API_KEY?.trim()) {
    return { status: "NOT_CONFIGURED", missing: ["GELATO_API_KEY"] };
  }
  if (process.env.GELATO_PRODUCT_UID?.trim()) {
    return validateConfiguredGelatoA3Product({
      apiKey: process.env.GELATO_API_KEY,
      productUid: process.env.GELATO_PRODUCT_UID
    });
  }
  const discovery = await discoverGelatoA3PosterProducts({ apiKey: process.env.GELATO_API_KEY });
  return {
    status: discovery.candidateCount === 1 ? "ONE_CANDIDATE_FOUND" : "PRODUCT_SELECTION_REQUIRED",
    ...discovery
  };
}

const result = {
  schemaVersion: "birdie-moments-staging-bootstrap/v1",
  mode: applyAppStore ? "APP_STORE_APPLY" : "DRY_RUN",
  appStore: await appStoreStatus().catch((error) => ({
    status: "ERROR",
    message: error?.message ?? String(error),
    httpStatus: error?.status ?? null
  })),
  gelato: await gelatoStatus().catch((error) => ({
    status: "ERROR",
    message: error?.message ?? String(error)
  }))
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.appStore.status === "ERROR" || result.gelato.status === "ERROR") process.exitCode = 1;
