export const MOMENT_TYPE = Object.freeze({
  ROUND: "ROUND",
  PERSONAL_BEST: "PERSONAL_BEST"
});

export const MOMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  GENERATING: "GENERATING",
  PREVIEW_READY: "PREVIEW_READY",
  PURCHASED: "PURCHASED",
  FULFILLED: "FULFILLED",
  FAILED: "FAILED"
});

export const TEMPLATE_VERSION = Object.freeze({
  ROUND: "birdie-moment-round-v1",
  PERSONAL_BEST: "birdie-moment-pb-v1"
});

export function validateCompletedRound(round) {
  const missing = [];
  if (!round?.id) missing.push("round_id");
  if (!round?.userId) missing.push("user_id");
  if (!round?.displayName) missing.push("display_name");
  if (!round?.courseName) missing.push("course_name");
  if (!round?.playedAt) missing.push("played_at");
  if (!Number.isFinite(round?.totalScore) || round.totalScore <= 0) missing.push("total_score");
  if (![9, 18].includes(round?.holesPlayed)) missing.push("holes_played");
  if (!Number.isInteger(round?.birdieCount) || round.birdieCount < 0) missing.push("birdie_count");
  if (round?.isCompleted !== true) missing.push("completed_state");

  return { valid: missing.length === 0, missing };
}

export function buildRenderData(round, momentType, pbData = null) {
  const data = {
    internalRoundId: round.id,
    playerName: round.displayName,
    courseName: round.courseName,
    playedAt: round.playedAt,
    totalScore: round.totalScore,
    holesPlayed: round.holesPlayed,
    birdieCount: round.birdieCount,
    momentType,
    templateVersion:
      momentType === MOMENT_TYPE.PERSONAL_BEST
        ? TEMPLATE_VERSION.PERSONAL_BEST
        : TEMPLATE_VERSION.ROUND
  };

  if (Number.isFinite(round.scoreVsPar)) data.scoreVsPar = round.scoreVsPar;
  if (Number.isFinite(round.coursePar)) data.coursePar = round.coursePar;
  if (Number.isInteger(round.eagleCount)) data.eagleCount = round.eagleCount;
  if (Number.isInteger(round.parCount)) data.parCount = round.parCount;
  if (Number.isFinite(round.frontNineScore)) data.frontNineScore = round.frontNineScore;
  if (Number.isFinite(round.backNineScore)) data.backNineScore = round.backNineScore;
  if (Array.isArray(round.holeScores)) data.holeScores = round.holeScores;
  if (Array.isArray(round.holePars)) data.holePars = round.holePars;

  if (momentType === MOMENT_TYPE.PERSONAL_BEST && pbData?.isPersonalBest) {
    data.personalBestData = {
      previousBestScore: pbData.previousBestScore,
      newBestScore: pbData.newBestScore,
      strokesImproved: pbData.strokesImproved ?? pbData.improvement
    };
  }

  return data;
}
