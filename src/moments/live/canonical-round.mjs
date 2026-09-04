/**
 * Convert a server-loaded, persisted BirdieWorld Scorecard record into the
 * canonical Birdie Moments round contract. Never pass request-body data here.
 */
export function toCanonicalMomentRound(persistedRound, { displayName } = {}) {
  if (!persistedRound || typeof persistedRound !== "object") return null;

  const holes = Array.isArray(persistedRound.holes) ? persistedRound.holes : null;
  const holesPlayed = integerOrUndefined(
    persistedRound.holesPlayed ?? persistedRound.holes_played ?? persistedRound.holeCount
  );

  const holeScores = completeHoleValues(holes, "strokes")
    ?? arrayOfFiniteNumbersOrUndefined(persistedRound.holeScores ?? persistedRound.hole_scores);
  const holePars = completeHoleValues(holes, "par")
    ?? arrayOfFiniteNumbersOrUndefined(persistedRound.holePars ?? persistedRound.hole_pars);

  const totalScore = finiteOrUndefined(
    persistedRound.totalScore ?? persistedRound.total_score ?? (holeScores ? sum(holeScores) : undefined)
  );
  const coursePar = finiteOrUndefined(
    persistedRound.coursePar ?? persistedRound.course_par ?? (holePars ? sum(holePars) : undefined)
  );
  const birdieCount = integerOrUndefined(
    persistedRound.birdieCount ?? persistedRound.birdie_count ?? deriveRelativeCount(holeScores, holePars, -1)
  );

  const round = {
    id: persistedRound.id ?? persistedRound.round_id,
    userId: persistedRound.userId ?? persistedRound.user_id,
    displayName: persistedRound.displayName ?? persistedRound.display_name ?? displayName,
    courseName: persistedRound.courseName ?? persistedRound.course_name,
    playedAt: persistedRound.playedAt ?? persistedRound.played_at,
    totalScore,
    holesPlayed,
    birdieCount,
    isCompleted:
      String(persistedRound.status ?? "").toLowerCase() === "completed"
      || persistedRound.isCompleted === true
      || persistedRound.is_completed === true
  };

  if (Number.isFinite(coursePar)) round.coursePar = coursePar;
  if (Number.isFinite(totalScore) && Number.isFinite(coursePar)) round.scoreVsPar = totalScore - coursePar;
  if (holeScores) round.holeScores = holeScores;
  if (holePars) round.holePars = holePars;

  const eagleCount = derivePredicateCount(holeScores, holePars, (delta) => delta <= -2);
  const parCount = derivePredicateCount(holeScores, holePars, (delta) => delta === 0);
  if (Number.isInteger(eagleCount)) round.eagleCount = eagleCount;
  if (Number.isInteger(parCount)) round.parCount = parCount;

  if (holeScores && holesPlayed === 18 && holeScores.length >= 18) {
    round.frontNineScore = sum(holeScores.slice(0, 9));
    round.backNineScore = sum(holeScores.slice(9, 18));
  }

  return round;
}

function completeHoleValues(holes, key) {
  if (!holes?.length || !holes.every((hole) => Number.isFinite(hole?.[key]) && hole[key] > 0)) {
    return undefined;
  }
  return holes.map((hole) => hole[key]);
}

function deriveRelativeCount(scores, pars, delta) {
  return derivePredicateCount(scores, pars, (value) => value === delta);
}

function derivePredicateCount(scores, pars, predicate) {
  if (!scores || !pars || scores.length !== pars.length || scores.length === 0) return undefined;
  let count = 0;
  for (let index = 0; index < scores.length; index += 1) {
    if (predicate(scores[index] - pars[index])) count += 1;
  }
  return count;
}

function arrayOfFiniteNumbersOrUndefined(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isFinite)) return undefined;
  return [...value];
}
function finiteOrUndefined(value) { return Number.isFinite(value) ? value : undefined; }
function integerOrUndefined(value) { return Number.isInteger(value) ? value : undefined; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
