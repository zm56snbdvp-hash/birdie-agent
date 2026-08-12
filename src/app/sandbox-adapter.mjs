const CONTRACT_VERSION = "birdie-app-v1";

function clone(value) {
  return structuredClone(value);
}

function mapRoundStatus(status) {
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "COMPLETED") return "COMPLETED";
  return "ABANDONED";
}

function mapHole(hole, roundId) {
  return {
    contractVersion: CONTRACT_VERSION,
    roundId,
    holeNumber: hole.holeNumber,
    par: null,
    strokes: hole.strokes,
    putts: hole.putts,
    penalties: hole.penalties,
    scoreRevision: hole.scoreRevision,
    completionState: hole.strokes === null ? "UNSCORED" : "SCORED"
  };
}

function mapRound(round, scorecard) {
  return {
    contractVersion: CONTRACT_VERSION,
    roundId: round.roundId,
    birdieId: round.birdieId,
    courseRef: round.courseRef,
    teeRef: null,
    holeCount: round.holeCount,
    startedAt: round.startedAt,
    finishedAt: round.endedAt,
    status: mapRoundStatus(round.status),
    totals: {
      strokes: scorecard.totals.strokes,
      putts: scorecard.totals.putts,
      penalties: scorecard.totals.penalties,
      scoredHoles: scorecard.scoredHoles
    }
  };
}

export function createBirdieAppSandboxAdapter({ roundEngine }) {
  if (!roundEngine || typeof roundEngine.snapshot !== "function" || typeof roundEngine.getScorecard !== "function") {
    throw new TypeError("roundEngine must expose snapshot() and getScorecard(roundId)");
  }

  return {
    contractVersion: CONTRACT_VERSION,
    mode: "SANDBOX",

    getGolfHistory(birdieId) {
      const snapshot = roundEngine.snapshot();
      const rounds = snapshot.ROUNDS
        .filter((round) => round.birdieId === birdieId)
        .map((round) => mapRound(round, roundEngine.getScorecard(round.roundId)))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      return clone({
        contractVersion: CONTRACT_VERSION,
        birdieId,
        source: "ROUND_MODE_SANDBOX",
        rounds
      });
    },

    getRoundDetail(roundId, birdieId) {
      const snapshot = roundEngine.snapshot();
      const round = snapshot.ROUNDS.find((item) => item.roundId === roundId);
      if (!round || round.birdieId !== birdieId) return null;

      const scorecard = roundEngine.getScorecard(roundId);
      return clone({
        contractVersion: CONTRACT_VERSION,
        round: mapRound(round, scorecard),
        holes: scorecard.holes.map((hole) => mapHole(hole, roundId)),
        courseDataMode: scorecard.courseDataMode,
        gpsDataUsed: false,
        sandbox: true
      });
    }
  };
}

export { CONTRACT_VERSION as BIRDIE_APP_CONTRACT_VERSION };
