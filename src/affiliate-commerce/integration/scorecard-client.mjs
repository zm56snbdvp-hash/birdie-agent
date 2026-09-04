function isCompletedSavedRound(round) {
  return Boolean(round?.id && (round?.status === "completed" || round?.isCompleted === true));
}

/**
 * Client-side no-op-safe bridge after the authoritative scorecard save succeeds.
 * It asks BirdieWorld for internal recommendations only; no merchant request occurs here.
 */
export async function fetchPostRoundCommerceRecommendations({
  savedRound,
  fetchImpl = globalThis.fetch,
  signal,
  limit = 3
}) {
  if (!isCompletedSavedRound(savedRound) || typeof fetchImpl !== "function") return null;

  try {
    const url = new URL("/api/commerce/recommendations", "https://birdieworld.invalid");
    url.searchParams.set("placement", "post-round");
    url.searchParams.set("limit", String(limit));
    const response = await fetchImpl(`${url.pathname}${url.search}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function afterRecoveredScorecardSaveForCommerce(payload, options = {}) {
  const round = payload?.round;
  if (!isCompletedSavedRound(round)) return { round, commerceRecommendations: null };
  const commerceRecommendations = await fetchPostRoundCommerceRecommendations({ savedRound: round, ...options });
  return { round, commerceRecommendations };
}
