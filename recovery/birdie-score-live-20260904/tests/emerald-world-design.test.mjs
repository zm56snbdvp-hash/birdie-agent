import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Emerald World skin is presentation-only and motion-safe", () => {
  const source = read("src/components/EmeraldWorldSkin.tsx");
  assert.match(source, /emerald-world-pass-01/);
  assert.match(source, /\.bw-world/);
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|COIN_TRANSACTIONS|simulateShot/);
  assert.doesNotMatch(source, /\b(?:wing|wings|feather|feathers|beak|beaks)\b/i);
});

test("Card Vault keeps canonical booster and starter endpoints", () => {
  const source = read("src/features/card-vault/CardVault.tsx");
  assert.match(source, /fetch\("\/api\/starter-set\/claim"/);
  assert.match(source, /fetch\("\/api\/boosters\/open"/);
  assert.match(source, /idempotencyKey:\s*crypto\.randomUUID\(\)/);
  assert.match(source, /1\. Edition · 3 Karten/);
  assert.match(source, /applyBoosterOpening/);
  assert.match(source, /applyStarterSet/);
  assert.match(source, /EmeraldWorldSkin/);
});

test("Deck Builder keeps canonical validation and save path", () => {
  const source = read("src/features/deck-builder/DeckBuilder.tsx");
  assert.match(source, /validateDeckSelection/);
  assert.match(source, /fetch\("\/api\/deck"/);
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /DECK_RULES\.playableCardCount/);
  assert.match(source, /EmeraldWorldSkin/);
});

test("Game shell keeps existing draw authority and renderer boundary", () => {
  const source = read("src/features/game/GameApp.tsx");
  const scene = read("src/features/game/CourseScene.tsx");
  assert.match(source, /createInitialGameCardState/);
  assert.match(source, /drawAtHoleStart\(next\)/);
  assert.match(source, /CourseScene hole=\{COURSE_HOLES\[hole - 1\]\} shot=\{courseShot\}/);
  assert.doesNotMatch(source, /simulateShot\(/);
  assert.match(scene, /createCourseScene/);
  assert.doesNotMatch(scene, /simulateShot\(|fetch\(|postCoin|COIN_TRANSACTIONS/);
});
