export function isPersistedCompletedRound(round) {
  return Boolean(round?.id && round?.status === "completed");
}

/**
 * Client-side bridge for the recovered golf-scorecard bundle.
 * It runs only after POST /api/round returned a persisted completed round.
 * A missing/unready offer is a no-op so Scorecard UX remains healthy.
 */
export async function fetchPostRoundMomentOffer({
  savedRound,
  fetchImpl = globalThis.fetch,
  signal
}) {
  if (!isPersistedCompletedRound(savedRound)) return null;
  if (typeof fetchImpl !== "function") return null;

  try {
    const response = await fetchImpl(`/api/round/${encodeURIComponent(savedRound.id)}/moment-offer`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body?.momentOffer ?? body?.offer ?? body ?? null;
  } catch {
    return null;
  }
}

/**
 * Exact insertion point in recovered Scorecard save flow:
 * after `const payload = await response.json()` and after `payload.round` was accepted.
 */
export async function afterRecoveredScorecardSave(payload, options = {}) {
  const round = payload?.round;
  if (!isPersistedCompletedRound(round)) return { round, momentOffer: null };
  const momentOffer = await fetchPostRoundMomentOffer({ savedRound: round, ...options });
  return { round, momentOffer };
}
