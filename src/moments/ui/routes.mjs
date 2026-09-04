import { getOwnedMoment, MomentAccessError } from "./access.mjs";
import {
  buildMomentDetailViewModel,
  buildPostRoundUpsellViewModel,
  selectPrimaryPostRoundMoment
} from "./view-models.mjs";

export async function getPostRoundUpsell({ roundId, authUserId, repo }) {
  if (!authUserId) return null;
  const moments = await repo.listMomentsForRound(roundId);
  const owned = (moments ?? []).filter((moment) => moment?.userId === authUserId);
  return buildPostRoundUpsellViewModel(selectPrimaryPostRoundMoment(owned));
}

export async function handleMomentDetailRequest({ momentId, authUserId, repo, pricing }) {
  try {
    const moment = await getOwnedMoment({ momentId, authUserId, repo });
    return {
      status: 200,
      cacheControl: "private, no-store",
      body: buildMomentDetailViewModel(moment, pricing)
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
