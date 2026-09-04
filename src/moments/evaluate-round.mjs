import {
  MOMENT_STATUS,
  MOMENT_TYPE,
  TEMPLATE_VERSION,
  buildRenderData,
  validateCompletedRound
} from "./contracts.mjs";
import { detectPersonalBest } from "./personal-best.mjs";

/**
 * Required repository contract:
 * - getRound(roundId)
 * - ensureMoment(input): idempotent INSERT/UPSERT using
 *   (roundId, momentType, templateVersion)
 * - listPreviousComparableRounds({ userId, holesPlayed, excludeRoundId })
 *
 * Optional:
 * - recordMomentEvaluationFailure({ roundId, stage, error })
 */
export async function evaluateCompletedRound(roundId, repo) {
  const round = await repo.getRound(roundId);
  const validation = validateCompletedRound(round);

  if (!validation.valid) {
    return {
      accepted: false,
      roundId,
      reason: "ROUND_INVALID_OR_INCOMPLETE",
      missing: validation.missing,
      moments: []
    };
  }

  const roundMoment = await repo.ensureMoment({
    userId: round.userId,
    roundId: round.id,
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PENDING,
    templateVersion: TEMPLATE_VERSION.ROUND,
    renderData: buildRenderData(round, MOMENT_TYPE.ROUND),
    isPersonalBest: false
  });

  const moments = [roundMoment];

  try {
    const previousRounds = await repo.listPreviousComparableRounds({
      userId: round.userId,
      holesPlayed: round.holesPlayed,
      excludeRoundId: round.id
    });

    const pb = detectPersonalBest(round, previousRounds);
    if (!pb.isPersonalBest) {
      return { accepted: true, roundId, personalBest: pb, moments };
    }

    const pbMoment = await repo.ensureMoment({
      userId: round.userId,
      roundId: round.id,
      momentType: MOMENT_TYPE.PERSONAL_BEST,
      status: MOMENT_STATUS.PENDING,
      templateVersion: TEMPLATE_VERSION.PERSONAL_BEST,
      renderData: buildRenderData(round, MOMENT_TYPE.PERSONAL_BEST, pb),
      isPersonalBest: true
    });

    moments.push(pbMoment);
    return { accepted: true, roundId, personalBest: pb, moments };
  } catch (error) {
    await repo.recordMomentEvaluationFailure?.({
      roundId: round.id,
      stage: "PERSONAL_BEST",
      error
    });

    return {
      accepted: true,
      roundId,
      personalBest: { isPersonalBest: false, reason: "PB_EVALUATION_UNPROVEN" },
      moments,
      warning: "PB_EVALUATION_FAILED"
    };
  }
}

/**
 * Post-commit adapter for round_completed.
 * Intentionally never rethrows into the Scorecard save path.
 */
export async function handleRoundCompleted(event, repo, logger = console) {
  try {
    return await evaluateCompletedRound(event.roundId, repo);
  } catch (error) {
    logger.error?.("birdie_moments_round_completed_failed", {
      roundId: event?.roundId,
      error
    });
    return {
      accepted: false,
      roundId: event?.roundId,
      reason: "MOMENT_PIPELINE_FAILED"
    };
  }
}
