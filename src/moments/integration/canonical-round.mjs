function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function finite(value) {
  return Number.isFinite(value) ? value : undefined;
}

function integer(value) {
  return Number.isInteger(value) ? value : undefined;
}

function completeHoleArrays(round) {
  if (!Array.isArray(round?.holes) || round.holes.length === 0) return null;
  const holes = [...round.holes].sort((a, b) => Number(a?.hole) - Number(b?.hole));
  if (!holes.every((hole) => Number.isFinite(hole?.strokes) && hole.strokes > 0 && Number.isFinite(hole?.par) && hole.par > 0)) {
    return null;
  }
  return {
    scores: holes.map((hole) => hole.strokes),
    pars: holes.map((hole) => hole.par)
  };
}

function countDelta(scores, pars, predicate) {
  if (!scores || !pars || scores.length !== pars.length) return undefined;
  let count = 0;
  for (let i = 0; i < scores.length; i += 1) {
    if (predicate(scores[i] - pars[i])) count += 1;
  }
  return count;
}

/**
 * Maps the persisted BirdieWorld /api/round result into Moment canonical data.
 * Browser request JSON is never an authority source here.
 */
export function toCanonicalMomentRound(persistedRound, { authenticatedUser } = {}) {
  if (!persistedRound || typeof persistedRound !== "object") return null;

  const complete = completeHoleArrays(persistedRound);
  const holesPlayed = integer(persistedRound.holesPlayed ?? persistedRound.holeCount);
  const totalScore = finite(persistedRound.totalScore ?? (complete ? sum(complete.scores) : undefined));
  const coursePar = finite(persistedRound.coursePar ?? (complete ? sum(complete.pars) : undefined));
  const userId = persistedRound.userId ?? persistedRound.user_id ?? authenticatedUser?.id ?? authenticatedUser?.userId;
  const displayName = persistedRound.displayName ?? persistedRound.display_name ?? authenticatedUser?.displayName ?? authenticatedUser?.name;

  const canonical = {
    id: persistedRound.id,
    userId,
    displayName,
    courseName: persistedRound.courseName ?? persistedRound.course_name,
    playedAt: persistedRound.playedAt ?? persistedRound.played_at,
    totalScore,
    holesPlayed,
    birdieCount: integer(persistedRound.birdieCount ?? (complete ? countDelta(complete.scores, complete.pars, (delta) => delta === -1) : undefined)),
    isCompleted: persistedRound.status === "completed" || persistedRound.isCompleted === true
  };

  if (Number.isFinite(coursePar)) canonical.coursePar = coursePar;
  if (Number.isFinite(totalScore) && Number.isFinite(coursePar)) canonical.scoreVsPar = totalScore - coursePar;

  if (complete) {
    canonical.holeScores = complete.scores;
    canonical.holePars = complete.pars;
    canonical.eagleCount = countDelta(complete.scores, complete.pars, (delta) => delta <= -2);
    canonical.parCount = countDelta(complete.scores, complete.pars, (delta) => delta === 0);
    if (holesPlayed === 18 && complete.scores.length >= 18) {
      canonical.frontNineScore = sum(complete.scores.slice(0, 9));
      canonical.backNineScore = sum(complete.scores.slice(9, 18));
    }
  }

  return canonical;
}

export function sameAuthenticatedOwner(persistedRound, authenticatedUser) {
  const authId = authenticatedUser?.id ?? authenticatedUser?.userId;
  const persistedId = persistedRound?.userId ?? persistedRound?.user_id;
  if (!authId) return false;
  return !persistedId || String(persistedId) === String(authId);
}
