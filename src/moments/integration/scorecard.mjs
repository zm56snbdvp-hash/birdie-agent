import { processRoundCompleted } from "../pipeline.mjs";

/**
 * Drop-in post-commit wrapper for the recovered BirdieWorld POST /api/round flow.
 *
 * Recovered browser contract:
 *   { id?, courseName, playedAt, holeCount, holes }
 *
 * Security contract:
 * - authenticate/saveRound remain existing BirdieWorld responsibilities.
 * - completion authority comes only from the persisted server result.
 * - user ownership remains server-session/repository-derived.
 * - Birdie Moments never changes a successful Scorecard response into an error.
 */
export function createRoundSaveWithMoments({
  saveRound,
  momentsRepo,
  storage,
  analytics = null,
  logger = console,
  now = () => new Date().toISOString()
}) {
  if (typeof saveRound !== "function") throw new TypeError("saveRound must be a function");
  if (!momentsRepo) throw new TypeError("momentsRepo is required");
  if (!storage) throw new TypeError("storage is required");

  return async function saveRoundWithMoments(context) {
    const saved = await saveRound(context);
    const persisted = saved?.round ?? saved;

    if (!persisted?.id || persisted.status !== "completed") return saved;

    try {
      await processRoundCompleted(
        { type: "round_completed", roundId: persisted.id },
        { repo: momentsRepo, storage, analytics, logger, now }
      );
    } catch (error) {
      // Final safety boundary: Birdie Moments is downstream of the committed round.
      logger.error?.("birdie_moments_post_commit_failed", {
        roundId: persisted.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Preserve the exact existing /api/round response shape.
    return saved;
  };
}

export function isRecoveredBirdieWorldRoundRequest(body) {
  if (!body || typeof body !== "object") return false;
  if (body.id !== undefined && typeof body.id !== "string") return false;
  if (typeof body.courseName !== "string") return false;
  if (typeof body.playedAt !== "string") return false;
  if (![9, 18].includes(body.holeCount)) return false;
  if (!Array.isArray(body.holes)) return false;
  return body.holes.every((hole) =>
    Number.isInteger(hole?.hole) &&
    Number.isInteger(hole?.par) &&
    Number.isInteger(hole?.strokes)
  );
}
