import { PLAYER_FOCUS, normalizePlayerContext } from "../contracts.mjs";

/**
 * Builds the smallest recommendation context from BirdieWorld-owned authoritative data.
 * Raw scores, handicap history and profile details never become part of the affiliate catalog request.
 */
export function buildAuthoritativePlayerCommerceContext({
  region = "DE",
  completedRoundCount = 0,
  recentRound = null,
  explicitFocuses = []
} = {}) {
  const focuses = Array.isArray(explicitFocuses) && explicitFocuses.length > 0
    ? explicitFocuses
    : [PLAYER_FOCUS.ESSENTIALS];

  return normalizePlayerContext({
    region,
    focuses,
    roundsPlayed: completedRoundCount,
    recentRoundCompleted: Boolean(recentRound?.id && (recentRound?.status === "completed" || recentRound?.isCompleted === true))
  });
}

export function createAuthoritativePlayerContextProvider({ loadPlayerCommerceSignals }) {
  if (typeof loadPlayerCommerceSignals !== "function") {
    throw new TypeError("loadPlayerCommerceSignals is required");
  }

  return {
    async getContext(authUserId) {
      if (!authUserId) {
        const error = new Error("AUTH_REQUIRED");
        error.code = "AUTH_REQUIRED";
        error.status = 401;
        throw error;
      }
      const signals = await loadPlayerCommerceSignals(authUserId);
      return buildAuthoritativePlayerCommerceContext(signals || {});
    }
  };
}
