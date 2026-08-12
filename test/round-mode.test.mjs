import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUND_MODE_RULE_VERSION,
  RoundModeValidationError
} from "../src/round-mode/model.mjs";
import { createRoundModeSandbox } from "../src/round-mode/service.mjs";
import {
  createDeterministicClock,
  simulateCompleteRoundModeJourney
} from "../src/round-mode/simulator.mjs";

function sandbox() {
  return createRoundModeSandbox({ now: createDeterministicClock() });
}

function activeRound(engine, overrides = {}) {
  return engine.startRound({
    birdieId: "BIRDIE-TEST-001",
    courseRef: "SANDBOX-COURSE",
    holeCount: 3,
    ...overrides
  });
}

test("creates versioned ROUNDS and ROUND_HOLES records", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  const state = engine.snapshot();

  assert.equal(state.ROUNDS.length, 1);
  assert.equal(state.ROUND_HOLES.length, 3);
  assert.equal(round.ruleVersion, ROUND_MODE_RULE_VERSION);
  assert.ok(state.ROUND_HOLES.every((hole) => hole.ruleVersion === ROUND_MODE_RULE_VERSION));
  assert.ok(state.ROUNDS.every((item) => item.sandbox === true));
});

test("rejects unsupported rule versions", () => {
  const engine = sandbox();
  assert.throws(
    () => activeRound(engine, { ruleVersion: "future-version" }),
    (error) => error instanceof RoundModeValidationError && error.code === "RULE_VERSION_UNSUPPORTED"
  );
});

test("selecting an object starts one play session and moves it IN_PLAY", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  engine.activateHole(round.roundId, 1);
  const session = engine.selectObject({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-A",
    holeNumber: 1
  });

  assert.equal(session.status, "ACTIVE");
  assert.equal(engine.getObjectState("BALL-A").state, "IN_PLAY");
  assert.equal(engine.snapshot().OBJECT_PLAY_SESSIONS.length, 1);
});

test("round permits only one active object at a time", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  engine.selectObject({ roundId: round.roundId, birdieId: round.birdieId, objectId: "BALL-A" });

  assert.throws(
    () =>
      engine.selectObject({
        roundId: round.roundId,
        birdieId: round.birdieId,
        objectId: "BALL-B"
      }),
    (error) =>
      error instanceof RoundModeValidationError && error.code === "ROUND_ALREADY_HAS_ACTIVE_OBJECT"
  );
});

test("switchObject closes the prior session and rests the prior object", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  engine.selectObject({ roundId: round.roundId, birdieId: round.birdieId, objectId: "BALL-A" });
  const next = engine.switchObject({
    roundId: round.roundId,
    birdieId: round.birdieId,
    fromObjectId: "BALL-A",
    toObjectId: "BALL-B"
  });
  const state = engine.snapshot();

  assert.equal(state.OBJECT_PLAY_SESSIONS[0].status, "SWITCHED_OUT");
  assert.equal(next.objectId, "BALL-B");
  assert.equal(engine.getObjectState("BALL-A").state, "RESTING");
  assert.equal(engine.getObjectState("BALL-B").state, "IN_PLAY");
});

test("lost and found lifecycle is ledgered without direct Coin effects", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  engine.selectObject({ roundId: round.roundId, birdieId: round.birdieId, objectId: "BALL-A" });

  const lost = engine.markLost({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-A",
    locationLabel: "Sandbox rough"
  });
  assert.equal(lost.eventType, "LOST");
  assert.equal(lost.visibility, "PRIVATE");
  assert.equal(engine.getObjectState("BALL-A").state, "LOST");

  const found = engine.markFound({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-A",
    locationLabel: "Sandbox rough"
  });
  assert.equal(found.eventType, "FOUND");
  assert.equal(engine.getObjectState("BALL-A").state, "FOUND");
  assert.ok(!Object.keys(engine.snapshot()).some((key) => key.toUpperCase().includes("COIN")));
});

test("cannot mark a resting object lost", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  assert.throws(
    () =>
      engine.markLost({
        roundId: round.roundId,
        birdieId: round.birdieId,
        objectId: "BALL-A"
      }),
    (error) => error instanceof RoundModeValidationError && error.code === "OBJECT_NOT_IN_PLAY"
  );
});

test("exact coordinates require explicit opt-in and PRIVATE visibility", () => {
  const engine = sandbox();
  const round = activeRound(engine);

  assert.throws(
    () =>
      engine.recordLocation({
        roundId: round.roundId,
        birdieId: round.birdieId,
        objectId: "BALL-A",
        latitude: 51.0,
        longitude: 9.0
      }),
    (error) =>
      error instanceof RoundModeValidationError && error.code === "EXACT_LOCATION_OPT_IN_REQUIRED"
  );

  assert.throws(
    () =>
      engine.recordLocation({
        roundId: round.roundId,
        birdieId: round.birdieId,
        objectId: "BALL-A",
        latitude: 51.0,
        longitude: 9.0,
        exactLocationOptIn: true,
        visibility: "PUBLIC"
      }),
    (error) =>
      error instanceof RoundModeValidationError && error.code === "EXACT_LOCATION_MUST_BE_PRIVATE"
  );

  const privateEvent = engine.recordLocation({
    roundId: round.roundId,
    birdieId: round.birdieId,
    objectId: "BALL-A",
    latitude: 51.0,
    longitude: 9.0,
    exactLocationOptIn: true,
    visibility: "PRIVATE"
  });
  assert.equal(privateEvent.exactLocationOptIn, true);
  assert.equal(privateEvent.visibility, "PRIVATE");
});

test("ending a round closes the active session and returns the object to RESTING", () => {
  const engine = sandbox();
  const round = activeRound(engine);
  engine.selectObject({ roundId: round.roundId, birdieId: round.birdieId, objectId: "BALL-A" });
  const ended = engine.endRound(round.roundId);
  const state = engine.snapshot();

  assert.equal(ended.status, "COMPLETED");
  assert.equal(state.OBJECT_PLAY_SESSIONS[0].status, "ENDED");
  assert.equal(engine.getObjectState("BALL-A").state, "RESTING");
});

test("complete journey simulator exercises switch, lost, found, resume and completion", () => {
  const result = simulateCompleteRoundModeJourney();

  assert.equal(result.invariants.roundCompleted, true);
  assert.equal(result.invariants.noCoinSideEffects, true);
  assert.equal(result.invariants.hardwareNeutral, true);
  assert.equal(result.invariants.exactLocationAbsentByDefault, true);
  assert.equal(result.state.ROUNDS.length, 1);
  assert.equal(result.state.ROUND_HOLES.length, 3);
  assert.equal(result.state.OBJECT_PLAY_SESSIONS.length, 3);
  assert.equal(result.state.OBJECT_LOCATION_EVENTS.length, 4);
  assert.ok(result.timeline.some(([event]) => event === "BALL_B_LOST"));
  assert.ok(result.timeline.some(([event]) => event === "BALL_B_FOUND"));
  assert.ok(result.timeline.some(([event]) => event === "ROUND_COMPLETED"));
});

test("all persisted sandbox rows carry the same current rule version", () => {
  const { state } = simulateCompleteRoundModeJourney();
  const records = [
    ...state.ROUNDS,
    ...state.ROUND_HOLES,
    ...state.OBJECT_PLAY_SESSIONS,
    ...state.OBJECT_LOCATION_EVENTS,
    ...state.OBJECT_STATES
  ];

  assert.ok(records.length > 0);
  assert.ok(records.every((record) => record.ruleVersion === ROUND_MODE_RULE_VERSION));
});

test("sandbox state is hardware-neutral and contains no QR/NFC choice", () => {
  const { state } = simulateCompleteRoundModeJourney();
  const serialized = JSON.stringify(state);
  assert.equal(/\bQR\b/i.test(serialized), false);
  assert.equal(/\bNFC\b/i.test(serialized), false);
  assert.equal(serialized.includes("physicalIdentityType"), false);
});
