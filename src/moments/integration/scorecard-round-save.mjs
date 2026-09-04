import { afterRoundCommitted } from "../round-completion.mjs";
import { sameAuthenticatedOwner, toCanonicalMomentRound } from "./canonical-round.mjs";

function summarizeMomentResult(result) {
  return {
    evaluated: result?.accepted === true,
    roundId: result?.roundId ?? null,
    momentIds: Array.isArray(result?.moments) ? result.moments.map((moment) => moment?.id).filter(Boolean) : [],
    personalBest: result?.personalBest?.isPersonalBest === true,
    warning: result?.warning,
    reason: result?.reason
  };
}

function requestScopedMomentsRepo(baseRepo, { persistedRound, authenticatedUser }) {
  return {
    async getRound(roundId) {
      if (String(roundId) === String(persistedRound.id)) {
        return toCanonicalMomentRound(persistedRound, { authenticatedUser });
      }
      const loaded = await baseRepo.getRound(roundId);
      return toCanonicalMomentRound(loaded, { authenticatedUser });
    },
    async ensureMoment(input) {
      return baseRepo.ensureMoment(input);
    },
    async listPreviousComparableRounds(query) {
      const rounds = await baseRepo.listPreviousComparableRounds(query);
      return (rounds ?? []).map((round) => toCanonicalMomentRound(round, { authenticatedUser })).filter(Boolean);
    },
    async recordMomentEvaluationFailure(details) {
      return baseRepo.recordMomentEvaluationFailure?.(details);
    }
  };
}

/**
 * Drop-in wrapper for the recovered BirdieWorld POST /api/round server save service.
 *
 * Invariants:
 * - core save/persistence resolves first;
 * - only the persisted result can authorize completion;
 * - server-authenticated user owns the context;
 * - Moments failures never fail a successful Scorecard save.
 */
export function createRoundSaveWithBirdieMoments({
  saveRound,
  momentsRepo,
  logger = console,
  includeMomentSummary = false
}) {
  if (typeof saveRound !== "function") throw new TypeError("saveRound must be a function");
  if (!momentsRepo) throw new TypeError("momentsRepo is required");

  return async function saveRoundWithBirdieMoments(context) {
    const saved = await saveRound(context);
    const persistedRound = saved?.round ?? saved;

    if (!persistedRound?.id || persistedRound.status !== "completed") return saved;

    const authenticatedUser = context?.authenticatedUser;
    if (!sameAuthenticatedOwner(persistedRound, authenticatedUser)) {
      logger.error?.("birdie_moments_round_owner_unproven", { roundId: persistedRound.id });
      return saved;
    }

    const scopedRepo = requestScopedMomentsRepo(momentsRepo, { persistedRound, authenticatedUser });
    const momentResult = await afterRoundCommitted({
      roundId: persistedRound.id,
      momentsRepo: scopedRepo,
      logger
    });

    if (!includeMomentSummary || !saved || typeof saved !== "object" || Array.isArray(saved) || !saved.round) {
      return saved;
    }

    return { ...saved, birdieMoment: summarizeMomentResult(momentResult) };
  };
}

/** Minimal recovered POST /api/round route composition example. */
export function createRecoveredRoundPostHandler({ authenticate, parseBody, saveRoundWithBirdieMoments, json }) {
  return async function postRound(req, res) {
    const authenticatedUser = await authenticate(req);
    const input = await parseBody(req);
    const result = await saveRoundWithBirdieMoments({ authenticatedUser, input });
    return json(res, 200, result);
  };
}
