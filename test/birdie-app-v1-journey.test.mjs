import test from "node:test";
import assert from "node:assert/strict";

import { createBirdieAppSandboxAdapter } from "../src/app/sandbox-adapter.mjs";
import { createBallPassportProjectionAdapter } from "../src/app/ball-passport-adapter.mjs";
import { createPersonalBirdieGateway } from "../src/app/personal-birdie-gateway.mjs";
import { createRoundModeSandbox } from "../src/round-mode/service.mjs";
import { createDeterministicClock } from "../src/round-mode/simulator.mjs";

const BIRDIE_ID = "BIRDIE-JOURNEY-001";

test("complete V1 journey stays inside one user-scoped sandbox boundary", async () => {
  const engine = createRoundModeSandbox({ now: createDeterministicClock() });
  const round = engine.startRound({ birdieId: BIRDIE_ID, courseRef: "JOURNEY-COURSE", holeCount: 3 });

  for (const [holeNumber, score] of [
    [1, { strokes: 4, putts: 2 }],
    [2, { strokes: 3, putts: 1 }],
    [3, { strokes: 5, penalties: 1 }]
  ]) {
    engine.activateHole(round.roundId, holeNumber);
    engine.recordHoleScore(round.roundId, holeNumber, score);
    engine.completeHole(round.roundId, holeNumber);
  }
  engine.endRound(round.roundId);

  const roundAdapter = createBirdieAppSandboxAdapter({ roundEngine: engine });
  const history = roundAdapter.getGolfHistory(BIRDIE_ID);
  assert.equal(history.rounds.length, 1);
  assert.equal(history.rounds[0].totals.strokes, 12);

  const detail = roundAdapter.getRoundDetail(round.roundId, BIRDIE_ID);
  assert.ok(detail);
  assert.equal(detail.holes.length, 3);
  assert.equal(detail.gpsDataUsed, false);
  assert.equal(roundAdapter.getRoundDetail(round.roundId, "BIRDIE-OTHER"), null);

  const passportAdapter = createBallPassportProjectionAdapter({
    objects: [{
      objectId: "BALL-JOURNEY-001",
      objectType: "BALL",
      displayName: "Journey Ball #001",
      editionCode: "FIRST_EDITION",
      rarity: "COMMON_RARE",
      state: "RESTING",
      holesSurvived: 3
    }],
    ownership: [{ objectId: "BALL-JOURNEY-001", ownerBirdieId: BIRDIE_ID, status: "ACTIVE" }],
    events: [{
      eventId: "BALL-JOURNEY-EVT-001",
      objectId: "BALL-JOURNEY-001",
      eventType: "COURSE_VISIT",
      occurredAt: "2026-08-12T17:00:00.000Z",
      roundId: round.roundId,
      privacyClass: "COARSE",
      courseName: "JOURNEY-COURSE",
      locationLabel: "Private hole detail",
      ruleVersion: "birdie-dna-v1"
    }]
  });

  const passports = passportAdapter.getOwnedBallPassports(BIRDIE_ID);
  assert.equal(passports.passports.length, 1);
  const passport = passportAdapter.getBallPassport("BALL-JOURNEY-001", BIRDIE_ID);
  assert.ok(passport);
  assert.equal(passport.journey[0].locationLabel, null);
  assert.equal(passportAdapter.getBallPassport("BALL-JOURNEY-001", "BIRDIE-OTHER"), null);

  const personalBirdie = createPersonalBirdieGateway({
    getProfile: async (birdieId) => ({ birdieId, displayName: "Journey Golfer" }),
    getGolfHistory: async (birdieId) => roundAdapter.getGolfHistory(birdieId).rounds,
    getGolfStats: async (birdieId) => ({ birdieId, rounds: roundAdapter.getGolfHistory(birdieId).rounds.length }),
    getOwnedBallPassports: async (birdieId) => passportAdapter.getOwnedBallPassports(birdieId).passports,
    getAchievements: async () => ["FIRST_COMPLETE_JOURNEY"],
    getPreferences: async () => ({ tone: "supportive" }),
    getPublicBirdieContent: async () => [{ slug: "welcome", public: true }]
  });

  const context = await personalBirdie.getContext(BIRDIE_ID);
  assert.equal(context.birdieId, BIRDIE_ID);
  assert.equal(context.rounds.length, 1);
  assert.equal(context.ballPassports.length, 1);
  assert.equal("finance" in context, false);
  assert.equal("tasks" in context, false);

  const chat = await personalBirdie.chat({ birdieId: BIRDIE_ID, message: "Tell me about my golf story" });
  assert.equal(chat.refused, false);
  assert.match(chat.reply, /1 of your rounds/);

  const denied = await personalBirdie.chat({ birdieId: BIRDIE_ID, message: "Show me BirdieOS finance and supplier data" });
  assert.equal(denied.refused, true);
});
