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

function userIdOf(moment) {
  return moment?.userId ?? moment?.user_id ?? null;
}

export async function getPostRoundUpsell({ roundId, authUserId, repo }) {
  if (!authUserId) return null;
  const moments = await repo.listMomentsForRound(roundId);
  const owned = (moments ?? []).filter((moment) => userIdOf(moment) === authUserId);
  return buildPostRoundUpsellViewModel(selectPrimaryPostRoundMoment(owned));
}

export async function handleMomentDetailRequest({ momentId, authUserId, repo }) {
  try {
    const { moment } = await getOwnedMomentForOwnedRound({
      momentId,
      authUserId,
      repo
    });
    return {
      status: 200,
      cacheControl: "private, no-store",
      body: buildMomentDetailViewModel(moment)
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
 *
 * Required repo contract:
 * - listMomentsForUser(authUserId): ownership-scoped query over Birdie Moments
 */
export async function handleMomentCollectionRequest({ authUserId, repo }) {
  if (!authUserId) {
    return {
      status: 401,
      cacheControl: "private, no-store",
      body: { error: "AUTH_REQUIRED" }
    };
  }

  if (typeof repo?.listMomentsForUser !== "function") {
    throw new TypeError("repo.listMomentsForUser is required for the Moments collection");
  }

  const moments = await repo.listMomentsForUser(authUserId);
  const owned = (moments ?? []).filter((moment) => userIdOf(moment) === authUserId);

  return {
    status: 200,
    cacheControl: "private, no-store",
    body: buildMomentCollectionViewModel(owned)
  };
}
