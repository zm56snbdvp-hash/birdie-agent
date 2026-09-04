import {
  MomentCheckoutError,
  getDigitalDownload,
  getDigitalEntitlement,
  handleMomentPaymentWebhook,
  startMomentCheckout
} from "./checkout-service.mjs";
import { MomentAuthorizationError } from "./security.mjs";

function decode(value) {
  try { return decodeURIComponent(value); }
  catch { throw new MomentCheckoutError("INVALID_PATH", 400); }
}

/**
 * Framework-neutral commerce adapter for the existing BirdieWorld server router.
 * - authenticate(req) returns server-verified { userId }
 * - readJson(req) parses ordinary JSON bodies
 * - readRawBody(req) returns exact webhook bytes/string for provider signature verification
 */
export async function routeMomentCommerceRequest({
  req,
  url,
  authenticate,
  readJson,
  readRawBody,
  repo,
  paymentProvider,
  printFulfillment = null,
  assetGateway,
  analytics = null,
  json,
  publicBaseUrl = ""
}) {
  const checkout = url.pathname.match(/^\/api\/moments\/([^/]+)\/checkout$/);
  const entitlement = url.pathname.match(/^\/api\/moments\/([^/]+)\/digital-entitlement$/);
  const download = url.pathname.match(/^\/api\/moments\/([^/]+)\/digital-download$/);
  const webhook = url.pathname === "/api/moments/payment-webhook";
  if (!checkout && !entitlement && !download && !webhook) return false;

  try {
    if (webhook) {
      if (req.method !== "POST") {
        json(405, { success: false, error: "METHOD_NOT_ALLOWED" });
        return true;
      }
      const rawBody = await readRawBody(req);
      const data = await handleMomentPaymentWebhook({
        rawBody,
        headers: req.headers,
        repo,
        paymentProvider,
        printFulfillment,
        analytics
      });
      json(200, { success: true, data });
      return true;
    }

    const auth = await authenticate(req);
    const authenticatedUserId = auth?.userId;

    if (checkout && req.method === "POST") {
      const momentId = decode(checkout[1]);
      const body = await readJson(req);
      const data = await startMomentCheckout({
        momentId,
        authenticatedUserId,
        sku: body?.sku,
        idempotencyKey: body?.idempotencyKey,
        shippingAddress: body?.shippingAddress ?? null,
        successUrl: `${publicBaseUrl}/moments/${encodeURIComponent(momentId)}?payment=success`,
        cancelUrl: `${publicBaseUrl}/moments/${encodeURIComponent(momentId)}?payment=cancelled`,
        repo,
        paymentProvider,
        analytics
      });
      json(200, { success: true, data });
      return true;
    }

    if (entitlement && req.method === "GET") {
      const data = await getDigitalEntitlement({
        momentId: decode(entitlement[1]), authenticatedUserId, repo
      });
      json(200, { success: true, data });
      return true;
    }

    if (download && req.method === "GET") {
      const data = await getDigitalDownload({
        momentId: decode(download[1]), authenticatedUserId, repo, assetGateway
      });
      json(200, { success: true, data });
      return true;
    }

    json(405, { success: false, error: "METHOD_NOT_ALLOWED" });
    return true;
  } catch (error) {
    if (error instanceof MomentCheckoutError) {
      json(error.status, { success: false, error: error.code });
      return true;
    }
    if (error instanceof MomentAuthorizationError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : 404;
      json(status, { success: false, error: error.code });
      return true;
    }
    throw error;
  }
}
