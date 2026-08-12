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
  sandbox.completeHole(round.roundId, 2);

  sandbox.activateHole(round.roundId, 3);
  sandbox.recordLocation({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-SANDBOX-B",
    locationLabel: "Sandbox Hole 3 green",
    visibility: "APPROXIMATE"
  });
  sandbox.completeHole(round.roundId, 3);
  const completedRound = sandbox.endRound(round.roundId);
  timeline.push(["ROUND_COMPLETED", completedRound.roundId]);

  const state = sandbox.snapshot();
  return {
    timeline,
    state,
    invariants: {
      roundCompleted: completedRound.status === "COMPLETED",
      noCoinSideEffects: !Object.keys(state).some((key) => key.toUpperCase().includes("COIN")),
      hardwareNeutral: !JSON.stringify(state).match(/\b(QR|NFC)\b/i),
      exactLocationAbsentByDefault: state.OBJECT_LOCATION_EVENTS.every(
        (event) => event.latitude === null && event.longitude === null
      )
    }
  };
}
