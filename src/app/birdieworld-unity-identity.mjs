function text(value) { return typeof value === "string" ? value.trim() : String(value ?? "").trim(); }

export const UNITY_IDENTITY_PROVIDER = "UNITY_AUTHENTICATION";
export const UNITY_IDENTITY_FIELD = "unityPlayerId";

export function resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId, profiles = [] } = {}) {
  const playerId = text(unityPlayerId);
  if (!playerId) {
    return { status: "UNBOUND", birdieId: null, reason: "UNITY_PLAYER_ID_MISSING", provider: UNITY_IDENTITY_PROVIDER };
  }

  const active = (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    return text(profile?.status).toUpperCase() === "ACTIVE" && text(profile?.unityPlayerId) === playerId;
  });

  if (active.length === 0) {
    return { status: "UNBOUND", birdieId: null, reason: "NO_ACTIVE_CANONICAL_UNITY_LINK", provider: UNITY_IDENTITY_PROVIDER };
  }

  const birdieIds = [...new Set(active.map((profile) => text(profile?.birdieId)).filter(Boolean))];
  if (active.length !== 1 || birdieIds.length !== 1) {
    const error = new Error("UNITY_CANONICAL_PROFILE_LINK_CONFLICT");
    error.code = "UNITY_CANONICAL_PROFILE_LINK_CONFLICT";
    error.unityPlayerId = playerId;
    error.birdieIds = birdieIds;
    throw error;
  }

  return { status: "BOUND", birdieId: birdieIds[0], reason: "EXACT_ACTIVE_CANONICAL_UNITY_LINK", provider: UNITY_IDENTITY_PROVIDER };
}
