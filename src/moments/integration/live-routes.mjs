import { getPostRoundUpsell } from "../ui/routes.mjs";

export async function handleRecoveredMomentOfferRequest({ roundId, authUserId, repo }) {
  if (!authUserId) {
    return {
      status: 401,
      cacheControl: "private, no-store",
      body: { error: "AUTH_REQUIRED" }
    };
  }

  const momentOffer = await getPostRoundUpsell({ roundId, authUserId, repo });
  return {
    status: 200,
    cacheControl: "private, no-store",
    body: { momentOffer: momentOffer ?? null }
  };
}

/**
 * Server-framework-neutral handler for GET /api/round/:roundId/moment-offer.
 * Route params identify a candidate round only; the server session remains authority.
 */
export function createRecoveredMomentOfferHttpHandler({ authenticate, repo, json }) {
  return async function momentOfferHandler(req, res, params = {}) {
    const authenticatedUser = await authenticate(req);
    const authUserId = authenticatedUser?.id ?? authenticatedUser?.userId ?? null;
    const roundId = params.roundId ?? req?.params?.roundId ?? null;
    const response = await handleRecoveredMomentOfferRequest({ roundId, authUserId, repo });
    if (typeof res?.setHeader === "function") res.setHeader("Cache-Control", response.cacheControl);
    return json(res, response.status, response.body);
  };
}
