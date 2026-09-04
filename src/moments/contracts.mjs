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

// Moment-family version participates in idempotency. It is intentionally
// separate from the concrete output template IDs below: one Moment offers
// both its digital and print product without creating duplicate Moments.
export const TEMPLATE_VERSION = Object.freeze({
  ROUND: "birdie-moment-round-v1",
  PERSONAL_BEST: "birdie-moment-pb-v1"
});

// Founder-Go v1: exactly four sellable/renderable templates.
export const TEMPLATE_ID = Object.freeze({
  ROUND_DIGITAL_V1: "ROUND_DIGITAL_V1",
  PERSONAL_BEST_DIGITAL_V1: "PERSONAL_BEST_DIGITAL_V1",
  ROUND_PRINT_V1: "ROUND_PRINT_V1",
  PERSONAL_BEST_PRINT_V1: "PERSONAL_BEST_PRINT_V1"
});

export function validateCompletedRound(round) {
  const missing = [];
  if (!round?.id) missing.push("round_id");
  if (!round?.userId) missing.push("user_id");
  if (!round?.displayName) missing.push("display_name");
  if (!round?.courseName) missing.push("course_name");
  if (!round?.playedAt) missing.push("played_at");
  if (!Number.isInteger(round?.totalScore) || round.totalScore <= 0) missing.push("total_score");
  if (![9, 18].includes(round?.holesPlayed)) missing.push("holes_played");
  if (!Number.isInteger(round?.birdieCount) || round.birdieCount < 0) missing.push("birdie_count");
  if (round?.isCompleted !== true) missing.push("completed_state");

  return { valid: missing.length === 0, missing };
}

export function templateIdsForMoment(momentType) {
  if (momentType === MOMENT_TYPE.PERSONAL_BEST) {
    return Object.freeze({
      digital: TEMPLATE_ID.PERSONAL_BEST_DIGITAL_V1,
      print: TEMPLATE_ID.PERSONAL_BEST_PRINT_V1
    });
  }
  if (momentType === MOMENT_TYPE.ROUND) {
    return Object.freeze({
      digital: TEMPLATE_ID.ROUND_DIGITAL_V1,
      print: TEMPLATE_ID.ROUND_PRINT_V1
    });
  }
  throw new Error(`Unsupported moment type: ${momentType}`);
}

export function buildRenderData(round, momentType, pbData = null) {
  const templates = templateIdsForMoment(momentType);
  const isPersonalBest = momentType === MOMENT_TYPE.PERSONAL_BEST && pbData?.isPersonalBest === true;

  const data = {
    playerName: round.displayName,
    courseName: round.courseName,
    playedAt: round.playedAt,
    totalScore: round.totalScore,
    holesPlayed: round.holesPlayed,
    birdieCount: round.birdieCount,
    momentType,
    isPersonalBest,
    roundReference: round.roundReference || round.id,
    templateVersion:
      momentType === MOMENT_TYPE.PERSONAL_BEST
        ? TEMPLATE_VERSION.PERSONAL_BEST
        : TEMPLATE_VERSION.ROUND,
    templates
  };

  if (Number.isInteger(round.scoreVsPar)) data.scoreVsPar = round.scoreVsPar;
  if (Number.isInteger(round.coursePar)) data.coursePar = round.coursePar;
  if (Number.isInteger(round.eagleCount)) data.eagleCount = round.eagleCount;
  if (Number.isInteger(round.parCount)) data.parCount = round.parCount;
  if (Number.isInteger(round.frontNineScore)) data.frontNineScore = round.frontNineScore;
  if (Number.isInteger(round.backNineScore)) data.backNineScore = round.backNineScore;
  if (Array.isArray(round.holeScores)) data.holeScores = structuredClone(round.holeScores);
  if (Array.isArray(round.holePars)) data.holePars = structuredClone(round.holePars);

  if (isPersonalBest) {
    data.previousBest = pbData.previousBestScore;
    data.improvement = pbData.improvement;
  }

  return Object.freeze(data);
}
