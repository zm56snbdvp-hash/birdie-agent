/**
 * Maps a persisted BirdieWorld Scorecard record to the canonical Birdie Moments round.
 * Only server-loaded/persisted data belongs here. Request JSON is never authority.
 */
export function toCanonicalMomentRound(persistedRound, { displayName } = {}) {
  const holes = Array.isArray(persistedRound?.holes) ? persistedRound.holes : null;
  const holesPlayed = integerOrNull(persistedRound?.holesPlayed ?? persistedRound?.holeCount);

  const holeScores = holes && holes.every((hole) => Number.isInteger(hole?.strokes) && hole.strokes > 0)
    ? holes.map((hole) => hole.strokes)
    : arrayOfPositiveIntegersOrUndefined(persistedRound?.holeScores);

  const holePars = holes && holes.every((hole) => Number.isInteger(hole?.par) && hole.par > 0)
    ? holes.map((hole) => hole.par)
    : arrayOfPositiveIntegersOrUndefined(persistedRound?.holePars);

  const totalScore = integerOrUndefined(
    persistedRound?.totalScore ?? (holeScores ? sum(holeScores) : undefined)
  );
  const coursePar = integerOrUndefined(
    persistedRound?.coursePar ?? (holePars ? sum(holePars) : undefined)
  );
  const birdieCount = integerOrUndefined(
    persistedRound?.birdieCount ?? deriveRelativeCount(holeScores, holePars, (delta) => delta === -1)
  );

  const round = {
    id: persistedRound?.id,
    userId: persistedRound?.userId ?? persistedRound?.user_id,
    displayName: persistedRound?.displayName ?? persistedRound?.display_name ?? displayName,
    courseName: persistedRound?.courseName ?? persistedRound?.course_name,
    playedAt: persistedRound?.playedAt ?? persistedRound?.played_at,
    totalScore,
    holesPlayed,
    birdieCount,
    isCompleted: persistedRound?.status === "completed" || persistedRound?.isCompleted === true
  };

  if (Number.isInteger(coursePar)) round.coursePar = coursePar;
  if (Number.isInteger(totalScore) && Number.isInteger(coursePar)) round.scoreVsPar = totalScore - coursePar;
  if (holeScores) round.holeScores = holeScores;
  if (holePars) round.holePars = holePars;

  const eagleCount = deriveRelativeCount(holeScores, holePars, (delta) => delta <= -2);
  const parCount = deriveRelativeCount(holeScores, holePars, (delta) => delta === 0);
  if (Number.isInteger(eagleCount)) round.eagleCount = eagleCount;
  if (Number.isInteger(parCount)) round.parCount = parCount;

  if (holeScores && holesPlayed === 18 && holeScores.length >= 18) {
    round.frontNineScore = sum(holeScores.slice(0, 9));
    round.backNineScore = sum(holeScores.slice(9, 18));
  }

  return round;
}

function deriveRelativeCount(scores, pars, predicate) {
  if (!scores || !pars || scores.length !== pars.length || scores.length === 0) return undefined;
  let count = 0;
  for (let index = 0; index < scores.length; index += 1) {
    if (predicate(scores[index] - pars[index])) count += 1;
  }
  return count;
}

function arrayOfPositiveIntegersOrUndefined(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => Number.isInteger(item) && item > 0)) return undefined;
  return [...value];
}
function integerOrUndefined(value) { return Number.isInteger(value) ? value : undefined; }
function integerOrNull(value) { return Number.isInteger(value) ? value : null; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
