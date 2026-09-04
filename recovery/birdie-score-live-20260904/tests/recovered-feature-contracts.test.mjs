import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cardArtwork = read("src/components/CardArtwork.tsx");
const vault = read("src/features/card-vault/CardVault.tsx");
const deck = read("src/features/deck-builder/DeckBuilder.tsx");
const game = read("src/features/game/GameApp.tsx");
const gameState = read("src/features/game/card-state.ts");

for (const [name, source] of [["CardVault", vault], ["DeckBuilder", deck], ["GameApp", game]]) {
  test(`${name} routes card faces through fail-safe CardArtwork`, () => {
    assert.match(source, /CardArtwork/);
    assert.doesNotMatch(source, /BW-E01-\$\{/);
    assert.doesNotMatch(source, /standard\.jpg/);
  });
}

test("CardArtwork refuses unverified/mismatched front images", () => {
  assert.match(cardArtwork, /resolution\.status === "VERIFIED"/);
  assert.match(cardArtwork, /Artwork wird geprüft/);
  assert.match(cardArtwork, /data-card-artwork-reason/);
  assert.doesNotMatch(cardArtwork, /BW-E01-\$\{/);
});

test("CardVault preserves the deployed starter/booster API contracts", () => {
  assert.match(vault, /\/api\/starter-set\/claim/);
  assert.match(vault, /\/api\/boosters\/open/);
  assert.match(vault, /idempotencyKey: crypto\.randomUUID\(\)/);
});

test("DeckBuilder preserves canonical-family validation and PUT /api/deck", () => {
  assert.match(deck, /validateDeckSelection/);
  assert.match(deck, /fetch\("\/api\/deck"/);
  assert.match(deck, /method: "PUT"/);
});

test("recovered GameApp keeps equipment auto-install replacement-draw semantics in pure model", () => {
  assert.match(gameState, /card\.family === "CLUB"/);
  assert.match(gameState, /card\.family === "BALL"/);
  assert.match(gameState, /return mergeResolution\(resolution, drawOneResolved\(state\)\)/);
  assert.match(gameState, /card\.family === "SPIN" \|\| card\.family === "TACTIC"/);
});

test("maintainable source contains no number-only front-artwork resolver", () => {
  const sources = [cardArtwork, vault, deck, game, gameState].join("\n");
  assert.doesNotMatch(sources, /BW-E01-\$\{/);
  assert.doesNotMatch(sources, /physicalNumber.*standard\.jpg/s);
});
