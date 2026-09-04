/**
 * Best-effort post-save resolver for the recovered BirdieWorld Scorecard UI.
 * Call only after POST /api/round has already resolved successfully.
 */
export async function resolvePostRoundMomentOffer({
  roundId,
  fetchOffer,
  attempts = 4,
  delayMs = 350,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (!roundId || typeof fetchOffer !== "function") return null;
  const total = Math.max(1, Math.min(Number(attempts) || 1, 8));

  for (let index = 0; index < total; index += 1) {
    try {
      const result = await fetchOffer(roundId);
      if (result?.available && result.offer) return result.offer;
      if (result?.reason && !["MOMENT_NOT_READY", "PREFERRED_MOMENT_NOT_READY"].includes(result.reason)) {
        return null;
      }
    } catch {
      return null;
    }
    if (index < total - 1) await sleep(delayMs);
  }
  return null;
}

export async function fetchPostRoundMomentOffer(roundId, fetchImpl = fetch) {
  return resolvePostRoundMomentOffer({
    roundId,
    fetchOffer: async (id) => {
      const response = await fetchImpl(`/api/round/${encodeURIComponent(id)}/moment-offer`, {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.data ?? null;
    }
  });
}
