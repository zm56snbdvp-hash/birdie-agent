import { startAppStoreDigitalPurchase, confirmAppStoreDigitalPurchase } from "../commerce/apple-iap.mjs";

function authUserId(user) {
  return user?.id ?? user?.userId ?? null;
}

export function createAppStoreDigitalPurchaseStartHandler({
  authenticate,
  accountTokenProvider,
  repo,
  catalog,
  analytics,
  json
}) {
  return async function startHandler(req, res, params = {}) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) return json(res, 401, { error: "AUTH_REQUIRED" });
    if (!accountTokenProvider || typeof accountTokenProvider.getOrCreateForUser !== "function") {
      return json(res, 503, { error: "APPLE_ACCOUNT_TOKEN_PROVIDER_NOT_CONFIGURED" });
    }

    const momentId = params.momentId ?? req?.params?.momentId;
    const appAccountToken = await accountTokenProvider.getOrCreateForUser(user);
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
