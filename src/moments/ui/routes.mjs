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

function userIdOf(value) {
  return value?.userId ?? value?.user_id ?? null;
}

function roundIdOf(moment) {
  return moment?.roundId ?? moment?.round_id ?? null;
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
 * - getRound(roundId): authoritative persisted source-round lookup
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

  return {
    status: 200,
    cacheControl: "private, no-store",
    body: buildMomentCollectionViewModel(fullyOwned)
  };
}
