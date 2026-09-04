import { handleRoundCompleted } from "./evaluate-round.mjs";

/**
 * Run only AFTER the canonical round transaction has committed.
 * The caller owns round persistence; Birdie Moments is a downstream monetization layer.
 */
export async function afterRoundCommitted({ roundId, momentsRepo, logger = console }) {
  return handleRoundCompleted(
    { type: "round_completed", roundId },
    momentsRepo,
    logger
  );
}

/**
 * Compatibility helper for the historical round-mode sandbox.
 * It demonstrates ordering only: end the round first, then evaluate Moments.
 * Production must use the real persisted round repository instead of sandbox state.
 */
export async function endSandboxRoundAndEvaluateMoments({
  roundMode,
  roundId,
  momentsRepo,
  logger = console
}) {
  const round = roundMode.endRound(roundId);
  const momentResult = await afterRoundCommitted({ roundId, momentsRepo, logger });
  return { round, momentResult };
}
