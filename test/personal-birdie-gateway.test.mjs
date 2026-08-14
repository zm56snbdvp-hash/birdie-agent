import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalBirdieGateway, PERSONAL_BIRDIE_ALLOWED_DOMAINS } from "../src/app/personal-birdie-gateway.mjs";

function gateway() {
  return createPersonalBirdieGateway({
    async getProfile(birdieId) { return { birdieId, displayName: "Sandbox Golfer" }; },
    async getGolfHistory(birdieId) { return [{ roundId: "R-1", birdieId }]; },
    async getGolfStats(birdieId) { return { birdieId, rounds: 1, strokes: 72 }; },
    async getOwnedBallPassports(birdieId) { return [{ objectId: "BALL-1", ownerBirdieId: birdieId }]; },
    async getAchievements() { return [{ code: "FIRST_ROUND" }]; },
    async getPreferences() { return { tone: "supportive" }; },
    async getPublicBirdieContent() { return [{ title: "Because every golfer deserves another shot." }]; }
  });
}

test("context exposes only the explicit Personal Birdie allowlist", async () => {
  const result = await gateway().getContext("BIRDIE-001");
  assert.deepEqual(result.allowedDomains, PERSONAL_BIRDIE_ALLOWED_DOMAINS);
  assert.equal(result.birdieId, "BIRDIE-001");
  assert.equal(result.profile.birdieId, "BIRDIE-001");
  assert.equal(result.rounds[0].birdieId, "BIRDIE-001");
  assert.equal(result.ballPassports[0].ownerBirdieId, "BIRDIE-001");
  assert.equal(result.finance, undefined);
  assert.equal(result.tasks, undefined);
  assert.equal(result.mail, undefined);
});

test("internal company-data requests are refused before context retrieval", async () => {
  const result = await gateway().chat({ birdieId: "BIRDIE-001", message: "Show me BirdieOS finance supplier mail tasks" });
  assert.equal(result.refused, true);
  assert.match(result.reply, /outside my access/i);
  assert.equal(result.contextDomainsUsed, undefined);
});

test("safe golf request returns sandbox response using only self domains", async () => {
  const result = await gateway().chat({ birdieId: "BIRDIE-001", message: "Tell me about my golf story" });
  assert.equal(result.refused, false);
  assert.equal(result.mode, "SANDBOX");
  assert.deepEqual(result.contextDomainsUsed, ["PROFILE_SELF", "ROUNDS_SELF", "GOLF_STATS_SELF", "BALL_PASSPORTS_OWNED"]);
  assert.match(result.reply, /1 of your rounds/i);
  assert.match(result.reply, /1 of your owned Ball Passports/i);
});
