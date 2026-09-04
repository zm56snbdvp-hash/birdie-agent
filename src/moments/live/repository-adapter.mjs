import { toCanonicalMomentRound } from "./canonical-round.mjs";

/**
 * Adapter from the real BirdieWorld persistence/auth sources into the existing
 * Birdie Moments repository contract. All callbacks must read server-owned data.
 * This intentionally makes no assumption about ORM, database, or auth framework.
 */
export function createMomentsSourceAdapter({
  loadPersistedRound,
  listPersistedComparableRounds,
  ensureMoment,
  loadDisplayName,
  recordMomentEvaluationFailure
}) {
  requireFunction(loadPersistedRound, "loadPersistedRound");
  requireFunction(listPersistedComparableRounds, "listPersistedComparableRounds");
  requireFunction(ensureMoment, "ensureMoment");

  return {
    async getRound(roundId) {
      const persisted = await loadPersistedRound(roundId);
      if (!persisted) return null;
      const userId = persisted.userId ?? persisted.user_id;
      const displayName = persisted.displayName ?? persisted.display_name
        ?? (typeof loadDisplayName === "function" && userId
          ? await loadDisplayName({ userId, persistedRound: persisted })
          : undefined);
      return toCanonicalMomentRound(persisted, { displayName });
    },

    async listPreviousComparableRounds({ userId, holesPlayed, excludeRoundId }) {
      const persistedRounds = await listPersistedComparableRounds({
        userId,
        holesPlayed,
        excludeRoundId
      });

      return (persistedRounds ?? [])
        .map((persisted) => toCanonicalMomentRound(persisted))
        .filter((round) =>
          round
          && round.id !== excludeRoundId
          && round.userId === userId
          && round.holesPlayed === holesPlayed
          && round.isCompleted === true
          && Number.isFinite(round.totalScore)
        );
    },

    async ensureMoment(input) {
      return ensureMoment(input);
    },

    ...(typeof recordMomentEvaluationFailure === "function"
      ? {
          async recordMomentEvaluationFailure(input) {
            return recordMomentEvaluationFailure(input);
          }
        }
      : {})
  };
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}
