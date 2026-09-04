import {
  getOwnedMomentForOwnedRound,
  MomentAccessError
} from "./access.mjs";
import {
  buildMomentCollectionViewModel,
  buildMomentDetailViewModel,
  buildPostRoundUpsellViewModel,
  selectPrimaryPostRoundMoment
} from "./view-models.mjs";

function userIdOf(value) { return value?.userId ?? value?.user_id ?? null; }
function roundIdOf(moment) { return moment?.roundId ?? moment?.round_id ?? null; }
function previewAssetOf(moment) { return moment?.previewAsset ?? moment?.preview_asset ?? null; }

async function authorizedPreviewUrl(moment, assetGateway) {
  const previewAsset = previewAssetOf(moment);
  if (!previewAsset || typeof assetGateway?.getAuthorizedPreviewUrl !== "function") return null;
  return assetGateway.getAuthorizedPreviewUrl({ momentId: moment.id, previewAsset });
}

export async function getPostRoundUpsell({ roundId, authUserId, repo, assetGateway }) {
  if (!authUserId) return null;
  if (typeof repo?.getRound !== "function") {
    throw new TypeError("repo.getRound is required for Reveal round-ownership verification");
  }

  const round = await repo.getRound(roundId);
  if (!round || userIdOf(round) !== authUserId) return null;

  const moments = await repo.listMomentsForRound(roundId);
  const owned = (moments ?? []).filter((moment) => userIdOf(moment) === authUserId);
  const selected = selectPrimaryPostRoundMoment(owned);
  if (!selected) return null;
  const previewUrl = await authorizedPreviewUrl(selected, assetGateway);
  return buildPostRoundUpsellViewModel(selected, { previewUrl });
}

export async function handleMomentDetailRequest({ momentId, authUserId, repo, assetGateway }) {
  try {
    const { moment } = await getOwnedMomentForOwnedRound({ momentId, authUserId, repo });
    const previewUrl = await authorizedPreviewUrl(moment, assetGateway);
    return {
      status: 200,
      cacheControl: "private, no-store",
      body: buildMomentDetailViewModel(moment, { previewUrl })
    };
  } catch (error) {
    if (error instanceof MomentAccessError) {
      return {
        status: error.status,
        cacheControl: "private, no-store",
        body: { error: error.code }
      };
    }
    throw error;
  }
}

/**
 * Collection is a private read model over existing Birdie Moment rows.
 * No purchase/entitlement record is created for Digital v1.
 */
export async function handleMomentCollectionRequest({ authUserId, repo, assetGateway }) {
  if (!authUserId) {
    return { status: 401, cacheControl: "private, no-store", body: { error: "AUTH_REQUIRED" } };
  }
  if (typeof repo?.listMomentsForUser !== "function") {
    throw new TypeError("repo.listMomentsForUser is required for the Moments collection");
  }
  if (typeof repo?.getRound !== "function") {
    throw new TypeError("repo.getRound is required for Collection round-ownership verification");
  }

  const moments = await repo.listMomentsForUser(authUserId);
  const momentOwned = (moments ?? []).filter((moment) => userIdOf(moment) === authUserId);
  const roundOwnership = new Map();

  for (const moment of momentOwned) {
    const roundId = roundIdOf(moment);
    if (!roundId || roundOwnership.has(roundId)) continue;
    const round = await repo.getRound(roundId);
    roundOwnership.set(roundId, Boolean(round && userIdOf(round) === authUserId));
  }

  const fullyOwned = momentOwned.filter((moment) => roundOwnership.get(roundIdOf(moment)) === true);
  const previewUrlsByMomentId = new Map();
  for (const moment of fullyOwned) {
    const previewUrl = await authorizedPreviewUrl(moment, assetGateway);
    if (previewUrl) previewUrlsByMomentId.set(moment.id, previewUrl);
  }

  return {
    status: 200,
    cacheControl: "private, no-store",
    body: buildMomentCollectionViewModel(fullyOwned, { previewUrlsByMomentId })
  };
}
