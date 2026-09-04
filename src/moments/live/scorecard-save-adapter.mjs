import { afterRoundCommitted } from "../round-completion.mjs";

/**
 * Wrap the existing POST /api/round persistence operation without taking ownership
 * of Scorecard validation or persistence.
 *
 * Invariants:
 * - core save completes first;
 * - completion is decided from the server persistence result, never request JSON;
 * - only completed persisted rounds trigger Moments;
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
  return String(round?.status ?? "").toLowerCase() === "completed"
    || round?.isCompleted === true
    || round?.is_completed === true;
}
