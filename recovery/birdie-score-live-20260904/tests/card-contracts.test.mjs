import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../src/domain/${name}`, import.meta.url)));
const cards = [
  ...load("cards-player.json"),
  ...load("cards-club.json"),
  ...load("cards-ball.json"),
  ...load("cards-spin.json"),
  ...load("cards-tactic.json"),
  ...load("cards-course.json"),
];
const starter = load("starter-deck.json");
const evidence = JSON.parse(fs.readFileSync(new URL("../recovered/deployed-evidence.json", import.meta.url)));
const byId = new Map(cards.map((card) => [card.id, card]));
const expectedRanges = [["PLAYER",1,12],["CLUB",13,30],["BALL",31,42],["SPIN",43,66],["TACTIC",67,90],["COURSE",91,96]];
const legacyCategory = (n) => evidence.legacyArtworkRanges.find((r) => n >= r.first && n <= r.last)?.category ?? null;

test("catalog has 96 unique card IDs", () => {
  assert.equal(cards.length, 96);
  assert.equal(new Set(cards.map((c) => c.id)).size, 96);
});

test("every card carries canonical identity and relevant rules data", () => {
  for (const card of cards) {
    assert.ok(card.id && card.name && card.family && card.type && card.physicalNumber);
    assert.ok(card.rarity || card.fixed === true);
    assert.ok(card.rulesText);
  }
});

test("physical numbers are unique and contiguous BW1-001..BW1-096", () => {
  const nums = cards.map((c) => Number(c.physicalNumber.slice(-3))).sort((a,b)=>a-b);
  assert.deepEqual(nums, Array.from({length:96}, (_,i)=>i+1));
});

test("canonical family ranges are deterministic", () => {
  for (const [family, first, last] of expectedRanges) {
    const familyCards = cards.filter((c) => c.family === family);
    assert.equal(familyCards.length, last-first+1, family);
    for (const card of familyCards) {
      const n = Number(card.physicalNumber.slice(-3));
      assert.ok(n >= first && n <= last, `${card.id} outside ${family} range`);
    }
  }
});

test("starter deck is 1 PLAYER + 4 CLUB + 3 BALL + 17 actions", () => {
  assert.equal(byId.get(starter.playerId)?.family, "PLAYER");
  assert.ok(starter.clubIds.every((id) => byId.get(id)?.family === "CLUB"));
  assert.ok(starter.ballIds.every((id) => byId.get(id)?.family === "BALL"));
  assert.ok(starter.actionIds.every((id) => ["SPIN","TACTIC"].includes(byId.get(id)?.family)));
  assert.equal(starter.clubIds.length, 4);
  assert.equal(starter.ballIds.length, 3);
  assert.equal(starter.actionIds.length, 17);
});

test("all 18 CLUB numbers collide with legacy COMMUNITY/person artwork", () => {
  const clubs = cards.filter((c) => c.family === "CLUB");
  assert.equal(clubs.length, 18);
  assert.ok(clubs.every((c) => legacyCategory(Number(c.physicalNumber.slice(-3))) === "COMMUNITY"));
});

test("deployed artwork lookup did not validate identity", () => {
  assert.deepEqual(evidence.unsafeResolver.validatedFields, []);
});
