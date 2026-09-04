import { startAppStoreDigitalPurchase, confirmAppStoreDigitalPurchase } from "../commerce/apple-iap.mjs";
import { recoverAppStoreDigitalPurchase } from "../commerce/apple-iap-recovery.mjs";

function authUserId(user) {
  return user?.id ?? user?.userId ?? null;
}

function defaultPurchaseTokenFactory() {
  return globalThis.crypto?.randomUUID?.() ?? null;
}

export function createAppStoreDigitalPurchaseStartHandler({
  authenticate,
  purchaseTokenFactory,
  accountTokenProvider,
  repo,
  catalog,
  analytics,
  json
}) {
  const tokenFactory = typeof purchaseTokenFactory === "function"
    ? purchaseTokenFactory
    : accountTokenProvider && typeof accountTokenProvider.getOrCreateForUser === "function"
      ? ({ user }) => accountTokenProvider.getOrCreateForUser(user)
      : defaultPurchaseTokenFactory;

  return async function startHandler(req, res, params = {}) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) return json(res, 401, { error: "AUTH_REQUIRED" });
    if (typeof tokenFactory !== "function") {
      return json(res, 503, { error: "APPLE_PURCHASE_TOKEN_FACTORY_NOT_CONFIGURED" });
    }

    const momentId = params.momentId ?? req?.params?.momentId;
    const appAccountToken = await tokenFactory({ user, userId, momentId });
    if (typeof appAccountToken !== "string" || !appAccountToken) {
      return json(res, 503, { error: "APPLE_PURCHASE_TOKEN_FACTORY_NOT_CONFIGURED" });
    }

    const result = await startAppStoreDigitalPurchase({
      authUserId: userId,
      momentId,
      appAccountToken,
      repo,
      catalog,
      analytics
    });
    if (typeof res?.setHeader === "function") res.setHeader("Cache-Control", "private, no-store");
    return json(res, 200, result);
  };
}

export function createAppStoreDigitalPurchaseConfirmHandler({
  authenticate,
  parseBody,
  repo,
  catalog,
  appleVerifier,
  analytics,
  json
}) {
  return async function confirmHandler(req, res, params = {}) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) return json(res, 401, { error: "AUTH_REQUIRED" });

    const body = await parseBody(req);
    const purchaseId = params.purchaseId ?? req?.params?.purchaseId;
    const signedTransactionInfo = body?.signedTransactionInfo;
    const result = await confirmAppStoreDigitalPurchase({
      authUserId: userId,
      purchaseId,
      signedTransactionInfo,
      repo,
      catalog,
      appleVerifier,
      analytics
    });
    if (typeof res?.setHeader === "function") res.setHeader("Cache-Control", "private, no-store");
    return json(res, 200, result);
  };
}

export function createAppStoreDigitalPurchaseRecoveryHandler({
  authenticate,
  parseBody,
  repo,
  catalog,
  appleVerifier,
  intentLookup,
  analytics,
  json
}) {
  return async function recoveryHandler(req, res) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) return json(res, 401, { error: "AUTH_REQUIRED" });

    const body = await parseBody(req);
    const result = await recoverAppStoreDigitalPurchase({
      authUserId: userId,
      signedTransactionInfo: body?.signedTransactionInfo,
      repo,
      catalog,
      appleVerifier,
      intentLookup,
      analytics
    });
    if (typeof res?.setHeader === "function") res.setHeader("Cache-Control", "private, no-store");
    return json(res, 200, result);
  };
}
