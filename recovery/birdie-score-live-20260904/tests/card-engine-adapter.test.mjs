import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bindCanonicalCard, bindBallCard, bindActionCard, bindClubCard, bindPlayerCard } from "../src/features/game/card-engine-adapter.ts";

const files = ["cards-player.json", "cards-club.json", "cards-ball.json", "cards-spin.json", "cards-tactic.json", "cards-course.json"];
const CARDS = files.flatMap((name) => JSON.parse(fs.readFileSync(new URL(`../src/domain/${name}`, import.meta.url), "utf8")));
const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

const by = (id) => {
  const card = CARD_BY_ID.get(id);
  assert.ok(card, `missing ${id}`);
  return card;
};

const baseContext = {
  lie: "FAIRWAY",
  strokeNumber: 2,
  holeId: 5,
  remaining: 90,
  targetZone: "GREEN",
  sourceClubType: "WEDGE_52",
  previousLanding: "FAIRWAY",
  timingGrade: "PERFECT",
  previousGrade: "PERFECT",
  windAlong: 1,
  matchScoreState: "TIED",
  par: 4,
  club: { id: "fixture", name: "fixture", kind: "WEDGE", w: 2, p: 4, k: 5, allowedLies: ["FAIRWAY", "ROUGH"] },
};

test("all 96 canonical cards have an explicit engine binding or explicit fail-safe deferral", () => {
  const bindings = CARDS.map((card) => bindCanonicalCard(card, baseContext));
  assert.equal(bindings.length, 96);
  assert.equal(bindings.filter((b) => b.status === "DEFERRED").length > 0, true);
  assert.equal(bindings.every((b) => ["EXACT", "CONDITIONAL_EXACT", "PROVISIONAL", "DEFERRED", "REFERENCE_ONLY"].includes(b.status)), true);
});

test("PLAYER base stats map 1:1 and only Lee-Ann signature is natively represented", () => {
  const leo = bindPlayerCard(by("BW1-PLY-001"));
  assert.deepEqual(leo.player, { power: 6, precision: 6, control: 6, recovery: 6, focus: 6 });
  assert.equal(leo.signatureMode, "DEFERRED");
  assert.equal(bindPlayerCard(by("BW1-PLY-006")).signatureMode, "ONE_READ");
});

test("CLUB W/P/K comes directly from catalog while engine kind bucket stays provisional", () => {
  const driver = bindClubCard(by("BW1-CLB-002"));
  assert.equal(driver.status, "PROVISIONAL");
  assert.deepEqual(driver.club, { id: "BW1-CLB-002", name: "Crownline Driver", kind: "DRIVER", w: 4, p: 4, k: 2, allowedLies: ["TEE"] });
  assert.equal(bindClubCard(by("BW1-CLB-006")).club.kind, "WEDGE");
  assert.equal(bindClubCard(by("BW1-CLB-017")).club.kind, "PUTTER");
});

test("simple BALL cards map exact source modifiers", () => {
  assert.deepEqual(bindBallCard(by("BW1-BALL-003")).ball, { id: "BW1-BALL-003", name: "TrueLine Pearl", power: 0, precision: 1, control: 0, roll: -1, windReduction: 0 });
  assert.equal(bindBallCard(by("BW1-BALL-004")).ball.windReduction, 1);
  assert.equal(bindBallCard(by("BW1-BALL-005")).status, "DEFERRED");
});

test("conditional BALL cards resolve from explicit shot context without guessing", () => {
  const first = bindBallCard(by("BW1-BALL-007"), { ...baseContext, strokeNumber: 1 });
  assert.equal(first.ball.power, 1); assert.equal(first.ball.precision, -1);
  const later = bindBallCard(by("BW1-BALL-007"), { ...baseContext, strokeNumber: 2 });
  assert.equal(later.ball.power, 0); assert.equal(later.ball.precision, 0);
  const finalFlag = bindBallCard(by("BW1-BALL-012"), baseContext);
  assert.equal(finalFlag.ball.power, -2); assert.equal(finalFlag.ball.precision, 1); assert.equal(finalFlag.ball.control, 1);
});

test("Power Draw and Velvet Fade translate exactly to recovered EngineAction fields", () => {
  assert.deepEqual(bindActionCard(by("BW1-SPIN-001")).action, { family: "SPIN", name: "Power Draw", power: 2, precision: -1, curve: "DRAW" });
  assert.deepEqual(bindActionCard(by("BW1-SPIN-002")).action, { family: "SPIN", name: "Velvet Fade", precision: 2, power: -1, curve: "FADE" });
});

test("engine-incompatible card semantics fail closed instead of partially applying", () => {
  assert.equal(bindActionCard(by("BW1-SPIN-014"), baseContext).status, "DEFERRED");
  assert.equal(bindActionCard(by("BW1-TAC-010"), baseContext).status, "DEFERRED");
  assert.equal(bindActionCard(by("BW1-TAC-023"), baseContext).action, null);
});

test("Full Send retains tee-only and Spin-blocking semantics", () => {
  const binding = bindActionCard(by("BW1-TAC-005"), { ...baseContext, lie: "TEE" });
  assert.deepEqual(binding.action, { family: "TACTIC", name: "Full Send", power: 2, control: -2, teeOnly: true, blockSpin: true });
});

test("conditional action gates resolve only from explicit context", () => {
  const jetstream = bindActionCard(by("BW1-SPIN-009"), baseContext);
  assert.equal(jetstream.active, true); assert.equal(jetstream.action.power, 2); assert.equal(jetstream.action.roll, 1);
  const redline = bindActionCard(by("BW1-TAC-008"), baseContext);
  assert.equal(redline.action.power, 3); assert.equal(redline.action.control, 1);
  const hot = bindActionCard(by("BW1-TAC-021"), baseContext);
  assert.equal(hot.active, true); assert.equal(hot.action.power, 1); assert.equal(hot.action.control, 1);
  const cold = bindActionCard(by("BW1-TAC-021"), { ...baseContext, previousGrade: "GOOD" });
  assert.equal(cold.active, false); assert.equal(cold.action, null);
});

test("COURSE cards remain reference-only and are never silently substituted into deployed hazard rules", () => {
  const course = bindCanonicalCard(by("BW1-CRS-001"), baseContext);
  assert.equal(course.status, "REFERENCE_ONLY");
  assert.equal(course.courseSequence, 1);
});
