import { createRoundModeSandbox } from "./service.mjs";

export function createDeterministicClock(start = "2026-08-12T12:00:00.000Z") {
  let tick = 0;
  const base = new Date(start).getTime();
  return () => new Date(base + tick++ * 1000).toISOString();
}

export function simulateCompleteRoundModeJourney() {
  const now = createDeterministicClock();
  const sandbox = createRoundModeSandbox({ now });
  const timeline = [];

  const round = sandbox.startRound({
    birdieId: "BIRDIE-SANDBOX-001",
    courseRef: "SANDBOX-COURSE",
    holeCount: 3
  });
  timeline.push(["ROUND_STARTED", round.roundId]);

  sandbox.activateHole(round.roundId, 1);
  const firstSession = sandbox.selectObject({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-A",
    holeNumber: 1
  });
  timeline.push(["BALL_A_IN_PLAY", firstSession.playSessionId]);

  sandbox.recordLocation({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-A",
    locationLabel: "Sandbox Hole 1 tee",
    visibility: "PRIVATE"
  });
  sandbox.recordHoleScore(round.roundId, 1, { strokes: 4, putts: 2, penalties: 0 });
  sandbox.completeHole(round.roundId, 1);

  sandbox.activateHole(round.roundId, 2);
  const secondSession = sandbox.switchObject({
    roundId: round.roundId,
    birdieId: round.birdieId,
    fromObjectId: "BALL-SANDBOX-A",
    toObjectId: "BALL-SANDBOX-B",
    holeNumber: 2
  });
  timeline.push(["BALL_SWITCHED", secondSession.playSessionId]);

  const lostEvent = sandbox.markLost({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-B",
    locationLabel: "Sandbox Hole 2 rough",
    visibility: "PRIVATE"
  });
  timeline.push(["BALL_B_LOST", lostEvent.locationEventId]);

  const foundEvent = sandbox.markFound({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-B",
    locationLabel: "Sandbox Hole 2 rough",
    visibility: "PRIVATE"
  });
  timeline.push(["BALL_B_FOUND", foundEvent.locationEventId]);

  const resumedSession = sandbox.selectObject({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-B",
    holeNumber: 2
  });
  timeline.push(["BALL_B_RESUMED", resumedSession.playSessionId]);
  sandbox.recordHoleScore(round.roundId, 2, { strokes: 6, putts: 2, penalties: 1 });
  sandbox.completeHole(round.roundId, 2);

  sandbox.activateHole(round.roundId, 3);
  sandbox.recordLocation({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-B",
    locationLabel: "Sandbox Hole 3 green",
    visibility: "APPROXIMATE"
  });
  sandbox.recordHoleScore(round.roundId, 3, { strokes: 3, putts: 1, penalties: 0 });
  sandbox.completeHole(round.roundId, 3);

  const scorecardBeforeEnd = sandbox.getScorecard(round.roundId);
  const privacySafeLastSeen = sandbox.getPrivacySafeLastSeen("BALL-SANDBOX-B");
  timeline.push(["SCORECARD_READY", scorecardBeforeEnd.totals.strokes]);
  timeline.push(["LAST_SEEN_SAFE", privacySafeLastSeen.locationLabel]);

  const completedRound = sandbox.endRound(round.roundId);
  timeline.push(["ROUND_COMPLETED", completedRound.roundId]);

  const state = sandbox.snapshot();
  const scorecard = sandbox.getScorecard(round.roundId);
  return {
    timeline,
    state,
    scorecard,
    privacySafeLastSeen,
    invariants: {
      roundCompleted: completedRound.status === "COMPLETED",
      scorecardComplete: scorecard.scoreComplete === true,
      noCoinSideEffects: !Object.keys(state).some((key) => key.toUpperCase().includes("COIN")),
      hardwareNeutral: !JSON.stringify(state).match(/\b(QR|NFC)\b/i),
      exactLocationAbsentByDefault: state.OBJECT_LOCATION_EVENTS.every(
        (event) => event.latitude === null && event.longitude === null
      ),
      privacySafeLastSeenHasNoCoordinates:
        privacySafeLastSeen.latitude === null && privacySafeLastSeen.longitude === null,
      noGpsCourseFacts: scorecard.gpsDataUsed === false
    }
  };
}
