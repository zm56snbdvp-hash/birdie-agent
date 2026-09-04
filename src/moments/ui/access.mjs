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

/**
 * Loads a Moment only when the authenticated user owns it.
 * Owner mismatch intentionally resolves as NOT_FOUND so the route
 * does not disclose another user's Moment identifiers.
 */
export async function getOwnedMoment({ momentId, authUserId, repo }) {
  const userId = requireId(authUserId, "authUserId");
  const id = requireId(momentId, "momentId");
  const moment = await repo.getMoment(id);

  if (!moment || moment.userId !== userId) {
    throw new MomentAccessError("MOMENT_NOT_FOUND", "Moment not found", 404);
  }

  return moment;
}
