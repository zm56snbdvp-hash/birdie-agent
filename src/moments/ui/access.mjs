export class MomentAccessError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "MomentAccessError";
    this.code = code;
    this.status = status;
  }
}

function requireId(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentAccessError("AUTH_REQUIRED", `${field} is required`, 401);
  }
  return value.trim();
}

function userIdOf(value) {
  return value?.userId ?? value?.user_id ?? null;
}

function roundIdOf(moment) {
  return moment?.roundId ?? moment?.round_id ?? null;
}

/**
 * Loads a Moment only when the authenticated user owns it.
 * Owner mismatch intentionally resolves as NOT_FOUND so the route
 * does not disclose another user's Moment identifiers.
 *
 * Kept as the narrow legacy Moment-only access helper because the retained
 * Phase-4 commerce code still imports it. Birdie Moments Digital v1 uses
 * getOwnedMomentForOwnedRound below and therefore also proves round ownership.
 */
export async function getOwnedMoment({ momentId, authUserId, repo }) {
  const userId = requireId(authUserId, "authUserId");
  const id = requireId(momentId, "momentId");
  const moment = await repo.getMoment(id);

  if (!moment || userIdOf(moment) !== userId) {
    throw new MomentAccessError("MOMENT_NOT_FOUND", "Moment not found", 404);
  }

  return moment;
}

/**
 * Birdie Moments Digital v1 access boundary.
 * A free Moment is still private: both the Moment row and its persisted
 * source round must belong to the authenticated Site user.
 */
export async function getOwnedMomentForOwnedRound({ momentId, authUserId, repo }) {
  const userId = requireId(authUserId, "authUserId");
  const moment = await getOwnedMoment({ momentId, authUserId: userId, repo });
  const roundId = roundIdOf(moment);

  if (!roundId) {
    throw new MomentAccessError("MOMENT_NOT_FOUND", "Moment not found", 404);
  }

  if (typeof repo?.getRound !== "function") {
    throw new MomentAccessError(
      "ROUND_OWNERSHIP_UNAVAILABLE",
      "Authoritative round ownership lookup is required",
      500
    );
  }

  const round = await repo.getRound(roundId);
  if (!round || userIdOf(round) !== userId) {
    throw new MomentAccessError("MOMENT_NOT_FOUND", "Moment not found", 404);
  }

  return { moment, round };
}
