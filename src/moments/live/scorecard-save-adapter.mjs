import { afterRoundCommitted } from "../round-completion.mjs";

/**
 * Wrap the existing POST /api/round persistence operation without taking ownership
 * of Scorecard validation or persistence.
 *
 * Invariants:
 * - core save completes first;
 * - completion is decided from the server persistence result, never request JSON;
 * - only persisted rounds with the canonical exact status "completed" may trigger Moments;
 * - the completed persisted round must be owned by the authenticated server user;
 * - missing/mismatched server ownership fails closed for Moments without failing Scorecard;
 * - Moments failures never roll back or replace the successful Scorecard result.
 */
export function createRoundSaveWithMoments({
  saveRound,
  momentsRepo,
  logger = console,
  afterRoundCommittedFn = afterRoundCommitted
}) {
  if (typeof saveRound !== "function") throw new TypeError("saveRound must be a function");
  if (!momentsRepo) throw new TypeError("momentsRepo is required");

  return async function saveRoundWithMoments(context) {
    const saved = await saveRound(context);
    const persistedRound = saved?.round ?? saved;
    const roundId = persistedRound?.id ?? persistedRound?.round_id;

    if (!roundId || !isCompletedPersistedRound(persistedRound)) return saved;

    const persistedOwnerId = roundOwnerId(persistedRound);
    const authenticatedOwnerId = authenticatedUserId(context?.authenticatedUser ?? context?.authUserId);
    if (!persistedOwnerId || !authenticatedOwnerId || persistedOwnerId !== authenticatedOwnerId) {
      logger.error?.("birdie_moments_round_owner_unproven", {
        roundId,
        hasPersistedOwner: Boolean(persistedOwnerId),
        hasAuthenticatedOwner: Boolean(authenticatedOwnerId)
      });
      return saved;
    }

    const momentResult = await afterRoundCommittedFn({
      roundId,
      momentsRepo,
      logger
    });

    if (saved && typeof saved === "object" && !Array.isArray(saved) && saved.round) {
      return {
        ...saved,
        birdieMoment: summarizeMomentResult(momentResult)
      };
    }

    return saved;
  };
}

export function summarizeMomentResult(result) {
  if (!result) return { evaluated: false };
  return {
    evaluated: result.accepted === true,
    roundId: result.roundId,
    momentIds: Array.isArray(result.moments)
      ? result.moments.map((moment) => moment?.id).filter(Boolean)
      : [],
    personalBest: result.personalBest?.isPersonalBest === true,
    warning: result.warning,
    reason: result.reason
  };
}

function isCompletedPersistedRound(round) {
  return round?.status === "completed";
}

function roundOwnerId(round) {
  const candidate = round?.userId ?? round?.user_id ?? null;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function authenticatedUserId(value) {
  if (typeof value === "string") return value.trim() || null;
  const candidate = value?.id ?? value?.userId ?? value?.user_id ?? null;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}
