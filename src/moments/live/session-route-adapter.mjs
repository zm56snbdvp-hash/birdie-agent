import {
  getPostRoundUpsell,
  handleMomentDetailRequest
} from "../ui/routes.mjs";
import {
  handleDigitalCheckoutRequest,
  handleDigitalDownloadRequest
} from "../commerce/routes.mjs";

function privateResponse(status, body) {
  return {
    status,
    headers: { "Cache-Control": "private, no-store" },
    body
  };
}

async function authenticatedUserId(request, resolveAuthenticatedUserId) {
  if (typeof resolveAuthenticatedUserId !== "function") {
    throw new TypeError("resolveAuthenticatedUserId must be provided by the authoritative app runtime");
  }

  const value = await resolveAuthenticatedUserId(request);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function handleLivePostRoundRevealRequest({
  request,
  roundId,
  resolveAuthenticatedUserId,
  repo
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  const reveal = await getPostRoundUpsell({ roundId, authUserId, repo });
  return privateResponse(200, { reveal });
}

export async function handleLiveMomentDetailRequest({
  request,
  momentId,
  resolveAuthenticatedUserId,
  repo,
  pricing
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  const response = await handleMomentDetailRequest({
    momentId,
    authUserId,
    repo,
    pricing
  });

  return {
    status: response.status,
    headers: { "Cache-Control": response.cacheControl },
    body: response.body
  };
}

export async function handleLiveDigitalCheckoutRequest({
  request,
  momentId,
  resolveAuthenticatedUserId,
  repo,
  paymentProvider,
  catalog,
  successUrl,
  cancelUrl
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  return handleDigitalCheckoutRequest({
    authUserId,
    momentId,
    repo,
    paymentProvider,
    catalog,
    successUrl,
    cancelUrl
  });
}

export async function handleLiveDigitalDownloadRequest({
  request,
  momentId,
  resolveAuthenticatedUserId,
  repo,
  assetSigner
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  return handleDigitalDownloadRequest({
    authUserId,
    momentId,
    repo,
    assetSigner
  });
}
