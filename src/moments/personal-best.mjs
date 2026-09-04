/**
 * Birdie Moments v1 — deterministic Personal Best detection.
 * No UI state, no estimates, no cross-hole-count comparisons.
 */

function finiteScore(value) {
  return Number.isFinite(value) && value > 0;
}

export function detectPersonalBest(currentRound, previousRounds) {
  if (!currentRound || !finiteScore(currentRound.totalScore)) {
    return { isPersonalBest: false, reason: "CURRENT_SCORE_INVALID" };
  }

  if (![9, 18].includes(currentRound.holesPlayed)) {
    return { isPersonalBest: false, reason: "CURRENT_HOLE_COUNT_UNSUPPORTED" };
  }

  const comparable = (previousRounds ?? []).filter((round) =>
    round &&
    round.id !== currentRound.id &&
    round.userId === currentRound.userId &&
    round.holesPlayed === currentRound.holesPlayed &&
    round.isCompleted === true &&
    finiteScore(round.totalScore)
  );

  if (comparable.length === 0) {
    return { isPersonalBest: false, reason: "NO_COMPARABLE_HISTORY" };
  }

  const previousBestScore = Math.min(...comparable.map((round) => round.totalScore));
  const isPersonalBest = currentRound.totalScore < previousBestScore;

  if (!isPersonalBest) {
    return {
      isPersonalBest: false,
      reason: currentRound.totalScore === previousBestScore ? "TIED_BEST" : "NOT_BETTER",
      previousBestScore
    };
  }

  return {
    isPersonalBest: true,
    reason: "NEW_PERSONAL_BEST",
    previousBestScore,
    newBestScore: currentRound.totalScore,
    // Canonical v1 convention: improvement is the score delta.
    // Example: 86 -> 82 = -4 strokes.
    improvement: currentRound.totalScore - previousBestScore
  };
}
