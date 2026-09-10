import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global emerald navigation uses only known product routes", () => {
  const source = read("src/components/EmeraldWorldNav.tsx");
  for (const route of ["/", "/spiel", "/scorecard", "/karten", "/fortschritt"]) assert.match(source, new RegExp(`href: \\\"${route === "/" ? "\\/" : route.replaceAll("/", "\\/")}\\\"`));
  assert.match(source, /data-authority="presentation-only"/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|COIN_TRANSACTIONS|simulateShot/);
});

test("home, progress and scorecard additions stay presentation-only", () => {
  const files = [
    "src/features/home/EmeraldWorldHome.tsx",
    "src/features/progress/EmeraldProgressOverview.tsx",
    "src/features/scorecard/EmeraldScorecardFrame.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /emerald-world-pass-02/);
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|simulateShot|COIN_TRANSACTIONS|ACTION_CLAIMS/);
  }
});

test("maintainable recovered surfaces share the global navigation", () => {
  const expected = [
    ["src/features/game/GameApp.tsx", /EmeraldWorldNav active="play"/],
    ["src/features/card-vault/CardVault.tsx", /EmeraldWorldNav active="cards"/],
    ["src/features/deck-builder/DeckBuilder.tsx", /EmeraldWorldNav active="cards"/],
  ];
  for (const [file, pattern] of expected) {
    const source = read(file);
    assert.match(source, /data-design-pass="emerald-world-pass-02"/);
    assert.match(source, pattern);
  }
});

test("scorecard frame wraps rather than replaces scorecard authority", () => {
  const source = read("src/features/scorecard/EmeraldScorecardFrame.tsx");
  assert.match(source, /data-scorecard-slot="existing-scorecard-controls"/);
  assert.match(source, /\{children\}/);
  assert.match(source, /verändert keine Schlag-, Speicher- oder Rundendaten/);
});
