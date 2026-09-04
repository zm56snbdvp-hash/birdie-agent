import { MomentAccessError, getMomentDetail, getPostRoundMomentOffer } from "./service.mjs";

function decode(value) {
  try { return decodeURIComponent(value); }
  catch { throw new MomentAccessError("INVALID_PATH", 400); }
}

/**
 * Framework-neutral adapter for the existing BirdieWorld server router.
 * authenticate(req) MUST return a server-verified { userId }.
 */
export async function routeMomentRequest({ req, url, authenticate, repo, assetGateway, json }) {
  const detail = url.pathname.match(/^\/api\/moments\/([^/]+)$/);
  const offer = url.pathname.match(/^\/api\/round\/([^/]+)\/moment-offer$/);
  if (!detail && !offer) return false;

  try {
    const auth = await authenticate(req);
    const authenticatedUserId = auth?.userId;

    if (req.method === "GET" && detail) {
      const data = await getMomentDetail({
        momentId: decode(detail[1]), authenticatedUserId, repo, assetGateway
      });
      json(200, { success: true, data });
      return true;
    }

    if (req.method === "GET" && offer) {
      const data = await getPostRoundMomentOffer({
        roundId: decode(offer[1]), authenticatedUserId, repo, assetGateway
      });
      json(200, { success: true, data });
      return true;
    }

    json(405, { success: false, error: "METHOD_NOT_ALLOWED" });
    return true;
  } catch (error) {
    if (error instanceof MomentAccessError) {
      json(error.status, { success: false, error: error.code });
      return true;
    }
    throw error;
  }
}
