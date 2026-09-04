import {
  getPostRoundUpsell,
  handleMomentCollectionRequest,
  handleMomentDetailRequest
} from "../ui/routes.mjs";
import { handleDigitalCheckoutRequest } from "../commerce/routes.mjs";
import {
  getFreePrivateMomentDownload,
  isFreeMomentAccessError
} from "../digital/free-download.mjs";

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

export async function handleLiveMomentCollectionRequest({
  request,
  resolveAuthenticatedUserId,
  repo
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  const response = await handleMomentCollectionRequest({ authUserId, repo });
  return {
    status: response.status,
    headers: { "Cache-Control": response.cacheControl },
    body: response.body
  };
}

export async function handleLiveMomentDetailRequest({
  request,
  momentId,
  resolveAuthenticatedUserId,
  repo
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  const response = await handleMomentDetailRequest({
    momentId,
    authUserId,
    repo
  });

  return {
    status: response.status,
    headers: { "Cache-Control": response.cacheControl },
    body: response.body
  };
}

/**
 * Retained legacy Phase-4 commerce adapter.
 * Birdie Moments Digital v1 does not call this route.
 */
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

/**
 * Birdie Moments Digital v1 download route: free but private.
 * No payment or entitlement lookup is performed.
 */
export async function handleLiveDigitalDownloadRequest({
  request,
  momentId,
  resolveAuthenticatedUserId,
  repo,
  assetSigner
}) {
  const authUserId = await authenticatedUserId(request, resolveAuthenticatedUserId);
  if (!authUserId) return privateResponse(401, { error: "AUTH_REQUIRED" });

  try {
    return await getFreePrivateMomentDownload({
      authUserId,
      momentId,
      repo,
      assetSigner
    });
  } catch (error) {
    if (isFreeMomentAccessError(error)) {
      return privateResponse(error.status, { error: error.code });
    }
    throw error;
  }
}
