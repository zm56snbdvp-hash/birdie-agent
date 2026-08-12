import assert from "node:assert/strict";
import test from "node:test";
import { createBallPassportProjectionAdapter } from "../src/app/ball-passport-adapter.mjs";

function adapter() {
  return createBallPassportProjectionAdapter({
    objects: [
      { objectId: "BALL-001", objectType: "BALL", displayName: "First Edition Ball #001", editionCode: "FIRST_EDITION", rarity: "COMMON_RARE", state: "RESTING", holesSurvived: 27 },
      { objectId: "COIN-001", objectType: "COIN", displayName: "Coin" }
    ],
    ownership: [
      { objectId: "BALL-001", ownerBirdieId: "BIRDIE-001", status: "ACTIVE" },
      { objectId: "COIN-001", ownerBirdieId: "BIRDIE-001", status: "ACTIVE" }
    ],
    events: [
      { eventId: "EVT-1", objectId: "BALL-001", eventType: "COURSE_VISIT", occurredAt: "2026-08-10T10:00:00.000Z", roundId: "ROUND-1", privacyClass: "COARSE", courseName: "Gut Wissmannshof", locationLabel: "Hole 3", ruleVersion: "birdie-dna-v1" },
      { eventId: "EVT-2", objectId: "BALL-001", eventType: "FIRST_BIRDIE", occurredAt: "2026-08-10T10:30:00.000Z", roundId: "ROUND-1", privacyClass: "PUBLIC", courseName: "Gut Wissmannshof", locationLabel: "Hole 7", ruleVersion: "birdie-dna-v1" },
      { eventId: "EVT-3", objectId: "BALL-001", eventType: "COMMUNITY_EVENT", occurredAt: "2026-08-11T11:00:00.000Z", privacyClass: "PRIVATE", courseName: "Private course", locationLabel: "Exact secret place", ruleVersion: "birdie-dna-v1" }
    ]
  });
}

test("returns only active owned balls", () => {
  const result = adapter().getOwnedBallPassports("BIRDIE-001");
  assert.equal(result.passports.length, 1);
  assert.equal(result.passports[0].objectId, "BALL-001");
  assert.equal(result.passports[0].privacySafeStats.rounds, 1);
  assert.equal(result.passports[0].privacySafeStats.courses, 1);
  assert.equal(result.passports[0].privacySafeStats.birdiesWitnessed, 1);
});

test("redacts private and coarse location detail", () => {
  const passport = adapter().getBallPassport("BALL-001", "BIRDIE-001");
  assert.equal(passport.journey[0].courseName, "Gut Wissmannshof");
  assert.equal(passport.journey[0].locationLabel, null);
  assert.equal(passport.journey[2].courseName, null);
  assert.equal(passport.journey[2].locationLabel, null);
});

test("denies passport access to a non-owner", () => {
  assert.equal(adapter().getBallPassport("BALL-001", "BIRDIE-OTHER"), null);
});
