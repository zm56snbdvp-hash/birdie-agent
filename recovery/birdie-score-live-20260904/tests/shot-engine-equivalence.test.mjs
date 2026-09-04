import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COURSE_HOLES, TARGET_STROKES, SHOT_MODES, timingGrade, legalClubs, recommendedClub, simulateShot } from "../src/features/game/shot-engine.ts";

const outputs = new Map(JSON.parse(fs.readFileSync(new URL("./shot-engine-production-outputs.json", import.meta.url), "utf8")).map((entry) => [entry.name, entry.expected]));
const player = { power: 6, precision: 6, control: 6, recovery: 6, focus: 6 };
const clubs = {
  driver: { id: "driver", name: "Fixture Driver", kind: "DRIVER", w: 5, p: 2, k: 1, allowedLies: ["TEE"] },
  hybrid: { id: "hybrid", name: "Fixture Hybrid", kind: "HYBRID", w: 3, p: 4, k: 3 },
  wedge: { id: "wedge", name: "Fixture Wedge", kind: "WEDGE", w: 2, p: 4, k: 5 },
  strongWedge: { id: "strong-wedge", name: "Strong Wedge", kind: "WEDGE", w: 3, p: 5, k: 5 },
  putter: { id: "putter", name: "Fixture Putter", kind: "PUTTER", w: 1, p: 5, k: 5, allowedLies: ["GREEN"] },
};
const ball = { id: "ball", name: "Fixture Ball", power: 0, precision: 1, control: 0, roll: -1, windReduction: 0 };
const controlledBall = { id: "control-ball", name: "Control Ball", power: 0, precision: 1, control: 1, roll: -2, windReduction: 0 };

const cases = [
  ["crosswind-perfect", { remaining: 338, lie: "TEE", strokeNumber: 1, player, club: clubs.driver, ball, hole: COURSE_HOLES[0], timingMeter: 50, mode: "STANDARD", aimLateral: 0, targetDistance: 280 }],
  ["tree-gate-error", { remaining: 365, lie: "TEE", strokeNumber: 1, player, club: clubs.driver, ball, hole: COURSE_HOLES[1], timingMeter: 95, mode: "ATTACK", aimLateral: 10, targetDistance: 300 }],
  ["water-carry-error", { remaining: 148, lie: "TEE", strokeNumber: 1, player, club: clubs.hybrid, ball, hole: COURSE_HOLES[2], timingMeter: 95, mode: "STANDARD", aimLateral: 0, targetDistance: 148 }],
  ["bunker-jaws-good", { remaining: 45, lie: "FAIRWAY", strokeNumber: 3, player: { power: 8, precision: 9, control: 9, recovery: 6, focus: 7 }, club: clubs.strongWedge, ball: controlledBall, hole: COURSE_HOLES[3], timingMeter: 58, mode: "CONTROL", aimLateral: 0, targetDistance: 40 }],
  ["breaking-green-good", { remaining: 78, lie: "FAIRWAY", strokeNumber: 2, player, club: clubs.wedge, ball, hole: COURSE_HOLES[4], timingMeter: 58, mode: "CONTROL", aimLateral: 0, targetDistance: 75 }],
  ["false-front-late", { remaining: 75, lie: "FAIRWAY", strokeNumber: 2, player, club: clubs.wedge, ball, hole: COURSE_HOLES[5], timingMeter: 70, mode: "CONTROL", aimLateral: 0, targetDistance: 72 }],
  ["putt-perfect-miss-on-line", { remaining: 4, lie: "GREEN", strokeNumber: 3, player, club: clubs.putter, ball, hole: COURSE_HOLES[0], timingMeter: 50, mode: "STANDARD", aimLateral: -0.5, targetDistance: 4 }],
  ["putt-late", { remaining: 8, lie: "GREEN", strokeNumber: 3, player, club: clubs.putter, ball, hole: COURSE_HOLES[5], timingMeter: 70, mode: "ATTACK", aimLateral: 0, targetDistance: 8 }],
  ["lee-ann-signature", { remaining: 12, lie: "GREEN", strokeNumber: 4, player: { ...player, focus: 8 }, club: clubs.putter, ball, hole: COURSE_HOLES[5], timingMeter: 99, mode: "ATTACK", aimLateral: 1, targetDistance: 12, signature: true }],
  ["inactive-actions-filtered", { remaining: 260, lie: "FAIRWAY", strokeNumber: 1, player, club: clubs.hybrid, ball, hole: COURSE_HOLES[0], timingMeter: 50, mode: "STANDARD", aimLateral: 0, targetDistance: 150, spin: { family: "SPIN", power: 4, precision: -2, curve: "DRAW", teeOnly: true }, tactic: { family: "TACTIC", control: 2, afterFirstShot: true } }],
  ["active-spin-tactic", { remaining: 260, lie: "TEE", strokeNumber: 2, player, club: clubs.hybrid, ball, hole: COURSE_HOLES[0], timingMeter: 50, mode: "STANDARD", aimLateral: 0, targetDistance: 150, spin: { family: "SPIN", power: 2, precision: -1, curve: "DRAW", teeOnly: true, perfectWindow: 2 }, tactic: { family: "TACTIC", control: 2, windReduction: 1, afterFirstShot: true, perfectWindow: 1 } }],
];

test("recovered course and target ladder match deployed six-hole engine", () => {
  assert.equal(COURSE_HOLES.length, 6);
  assert.deepEqual(COURSE_HOLES.map((hole) => hole.par), [4, 4, 3, 5, 4, 3]);
  assert.deepEqual([...TARGET_STROKES], [4, 5, 3, 6, 4, 3]);
  assert.deepEqual(Object.keys(SHOT_MODES), ["CONTROL", "STANDARD", "ATTACK"]);
});

test("timing grade boundaries retain deployed behavior", () => {
  assert.equal(timingGrade(50), "PERFECT"); assert.equal(timingGrade(54), "PERFECT"); assert.equal(timingGrade(55), "GOOD"); assert.equal(timingGrade(64), "GOOD"); assert.equal(timingGrade(15), "EARLY"); assert.equal(timingGrade(85), "LATE"); assert.equal(timingGrade(87), "ERROR");
});

test("legal and recommended club rules retain deployed thresholds", () => {
  const set = [clubs.driver, clubs.hybrid, clubs.wedge, clubs.putter];
  assert.deepEqual(legalClubs(300, "TEE", set).map((club) => club.id), ["driver", "hybrid", "wedge"]);
  assert.deepEqual(legalClubs(5, "GREEN", set).map((club) => club.id), ["putter"]);
  assert.equal(recommendedClub(250, "TEE", set)?.id, "driver"); assert.equal(recommendedClub(150, "FAIRWAY", set)?.id, "hybrid"); assert.equal(recommendedClub(80, "FAIRWAY", set)?.id, "wedge"); assert.equal(recommendedClub(12, "FAIRWAY", set)?.id, "putter");
});

for (const [name, input] of cases) test(`simulateShot exact deployed JSON equivalence: ${name}`, () => {
  assert.deepEqual(JSON.parse(JSON.stringify(simulateShot(input))), outputs.get(name));
});
