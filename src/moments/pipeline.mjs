import { handleRoundCompleted } from "./evaluate-round.mjs";
import { renderMomentForStorage } from "./rendering/render-job.mjs";

/**
 * Complete downstream round_completed pipeline.
 * The caller must invoke this only after the canonical round transaction has
 * committed successfully. Every failure is contained inside Birdie Moments;
 * nothing is rethrown into the Scorecard save path.
 */
export async function processRoundCompleted(event, {
  repo,
  storage,
  analytics = null,
  logger = console,
  now = () => new Date().toISOString()
}) {
  const evaluation = await handleRoundCompleted(event, repo, logger);
  if (!evaluation.accepted) return { ...evaluation, rendered: [] };

  const rendered = [];
  for (const moment of evaluation.moments) {
    const result = await renderMomentForStorage(moment.id, { repo, storage, now });
    rendered.push(result);
    if (result.ok) {
      await analytics?.track?.("moment_generated", {
        userId: moment.userId,
        momentId: moment.id,
        roundId: moment.roundId,
        momentType: moment.momentType
      });
    } else {
      await analytics?.track?.("moment_generation_failed", {
        userId: moment.userId,
        momentId: moment.id,
        roundId: moment.roundId,
        momentType: moment.momentType,
        reason: result.reason
      });
    }
  }

  return {
    ...evaluation,
    rendered,
    previewReadyMomentIds: rendered.filter((item) => item.ok).map((item) => item.momentId)
  };
}

/**
 * Boundary helper for the real /api/round persistence handler.
 * It deliberately returns a promise that resolves to a contained result.
 * The live server should schedule/await it only AFTER successful DB commit.
 */
export async function afterPersistedRoundCommit({ roundId }, dependencies) {
  return processRoundCompleted({ type: "round_completed", roundId }, dependencies);
}
