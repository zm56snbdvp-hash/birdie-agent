import test from "node:test";
import assert from "node:assert/strict";
import { PLAYER_FOCUS } from "../src/affiliate-commerce/contracts.mjs";
import {
  buildAuthoritativePlayerCommerceContext,
  createAuthoritativePlayerContextProvider
} from "../src/affiliate-commerce/integration/player-context.mjs";
import {
  fetchPostRoundCommerceRecommendations,
  afterRecoveredScorecardSaveForCommerce
} from "../src/affiliate-commerce/integration/scorecard-client.mjs";

test("authoritative player context exposes only minimal commerce signals", () => {
  const context = buildAuthoritativePlayerCommerceContext({
    region: "de",
    completedRoundCount: 7,
    recentRound: { id: "r-1", status: "completed", totalScore: 82, handicap: 11.2 },
    explicitFocuses: [PLAYER_FOCUS.DISTANCE]
  });
  assert.deepEqual(context, {
    region: "DE",
    focuses: [PLAYER_FOCUS.DISTANCE],
    roundsPlayed: 7,
    recentRoundCompleted: true
  });
  assert.equal("totalScore" in context, false);
  assert.equal("handicap" in context, false);
});

test("player context defaults to essentials without inventing performance focus", () => {
  const context = buildAuthoritativePlayerCommerceContext({ completedRoundCount: 1 });
  assert.deepEqual(context.focuses, [PLAYER_FOCUS.ESSENTIALS]);
});

test("player context provider requires authenticated identity", async () => {
  const provider = createAuthoritativePlayerContextProvider({ loadPlayerCommerceSignals: async () => ({}) });
  await assert.rejects(provider.getContext(null), (error) => error.code === "AUTH_REQUIRED");
});

test("post-round client fetches BirdieWorld recommendations only after persisted completion", async () => {
  const requests = [];
  const result = await fetchPostRoundCommerceRecommendations({
    savedRound: { id: "r-1", status: "completed" },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, async json() { return { items: [{ id: "balls-1" }] }; } };
    }
  });
  assert.equal(result.items[0].id, "balls-1");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/api\/commerce\/recommendations\?/);
  assert.match(requests[0].url, /placement=post-round/);
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("post-round client is a no-op for incomplete or failed scorecard saves", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, async json() { return {}; } }; };
  assert.equal(await fetchPostRoundCommerceRecommendations({ savedRound: { id: "r-1", status: "active" }, fetchImpl }), null);
  const result = await afterRecoveredScorecardSaveForCommerce({ round: null }, { fetchImpl });
  assert.equal(result.commerceRecommendations, null);
  assert.equal(calls, 0);
});

test("commerce recommendation failure never breaks the saved round result", async () => {
  const result = await afterRecoveredScorecardSaveForCommerce(
    { round: { id: "r-1", status: "completed" } },
    { fetchImpl: async () => { throw new Error("commerce unavailable"); } }
  );
  assert.equal(result.round.id, "r-1");
  assert.equal(result.commerceRecommendations, null);
});
