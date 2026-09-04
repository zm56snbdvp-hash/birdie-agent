import test from "node:test";
import assert from "node:assert/strict";
import { toCanonicalMomentRound } from "../src/moments/live/canonical-round.mjs";
import { createMomentsSourceAdapter } from "../src/moments/live/repository-adapter.mjs";
import { createRoundSaveWithMoments } from "../src/moments/live/scorecard-save-adapter.mjs";

function eighteenHoleRound({ id = "r18", userId = "u1", scoreOffset = 0, status = "completed" } = {}) {
  const pars = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
  const strokes = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
  strokes[17] += scoreOffset;
  return {
    id,
    user_id: userId,
    courseName: "Gut Testhof",
    playedAt: "2026-09-04T10:00:00+02:00",
    holeCount: 18,
    holes: pars.map((par, index) => ({ hole: index + 1, par, strokes: strokes[index] })),
    status
  };
}

test("recovered Scorecard persisted shape maps only real round values", () => {
  const persisted = eighteenHoleRound();
  const round = toCanonicalMomentRound(persisted, { displayName: "Kevin" });
  assert.equal(round.id, "r18");
  assert.equal(round.userId, "u1");
  assert.equal(round.displayName, "Kevin");
  assert.equal(round.holesPlayed, 18);
  assert.equal(round.totalScore, 72);
  assert.equal(round.coursePar, 72);
  assert.equal(round.birdieCount, 0);
  assert.equal(round.frontNineScore, 36);
  assert.equal(round.backNineScore, 36);
  assert.equal(round.isCompleted, true);
});

test("incomplete Scorecard never invents score or birdie values", () => {
  const persisted = eighteenHoleRound({ status: "draft" });
  persisted.holes[2].strokes = 0;
  const round = toCanonicalMomentRound(persisted, { displayName: "Kevin" });
  assert.equal(round.totalScore, undefined);
  assert.equal(round.birdieCount, undefined);
  assert.equal(round.isCompleted, false);
});

test("source adapter resolves display name from server user source and filters PB history defensively", async () => {
  const current = eighteenHoleRound({ id: "current", userId: "owner" });
  const adapter = createMomentsSourceAdapter({
    async loadPersistedRound(id) {
      assert.equal(id, "current");
      return current;
    },
    async loadDisplayName({ userId }) {
      assert.equal(userId, "owner");
      return "Kevin";
    },
    async listPersistedComparableRounds() {
      return [
        eighteenHoleRound({ id: "good", userId: "owner", scoreOffset: 4 }),
        eighteenHoleRound({ id: "foreign", userId: "attacker", scoreOffset: 9 }),
        { ...eighteenHoleRound({ id: "nine", userId: "owner", scoreOffset: -20 }), holeCount: 9 },
        eighteenHoleRound({ id: "draft", userId: "owner", status: "draft" }),
        current
      ];
    },
    async ensureMoment(input) { return { id: "m1", ...input }; }
  });

  const loaded = await adapter.getRound("current");
  assert.equal(loaded.userId, "owner");
  assert.equal(loaded.displayName, "Kevin");

  const history = await adapter.listPreviousComparableRounds({
    userId: "owner",
    holesPlayed: 18,
    excludeRoundId: "current"
  });
  assert.deepEqual(history.map((round) => round.id), ["good"]);
});

test("Scorecard save is authoritative and Moments runs strictly after completed persistence", async () => {
  const order = [];
  const persisted = eighteenHoleRound({ id: "round-1", userId: "server-owner" });
  const save = createRoundSaveWithMoments({
    momentsRepo: {},
    async saveRound(context) {
      order.push("persist");
      assert.equal(context.input.user_id, "attacker");
      return { round: persisted };
    },
    async afterRoundCommittedFn({ roundId }) {
      order.push("moments");
      assert.equal(roundId, "round-1");
      return { accepted: true, roundId, moments: [{ id: "moment-1" }] };
    }
  });

  const result = await save({ authenticatedUser: { id: "server-owner" }, input: { user_id: "attacker" } });
  assert.deepEqual(order, ["persist", "moments"]);
  assert.equal(result.round.user_id, "server-owner");
  assert.deepEqual(result.birdieMoment.momentIds, ["moment-1"]);
});

test("draft persistence never emits ROUND_COMPLETED", async () => {
  let momentCalls = 0;
  const save = createRoundSaveWithMoments({
    momentsRepo: {},
    async saveRound() { return { round: eighteenHoleRound({ status: "draft" }) }; },
    async afterRoundCommittedFn() { momentCalls += 1; }
  });
  const result = await save({});
  assert.equal(result.round.status, "draft");
  assert.equal(momentCalls, 0);
  assert.equal(result.birdieMoment, undefined);
});

test("Moments failure remains downstream of a successful Scorecard save", async () => {
  const persisted = eighteenHoleRound({ id: "round-safe" });
  const save = createRoundSaveWithMoments({
    momentsRepo: {},
    logger: { error() {} },
    async saveRound() { return { round: persisted }; },
    async afterRoundCommittedFn({ roundId }) {
      return { accepted: false, roundId, reason: "MOMENT_PIPELINE_FAILED" };
    }
  });
  const result = await save({});
  assert.equal(result.round.id, "round-safe");
  assert.equal(result.birdieMoment.evaluated, false);
  assert.equal(result.birdieMoment.reason, "MOMENT_PIPELINE_FAILED");
});

test("failed core persistence prevents Moments entirely", async () => {
  let momentCalls = 0;
  const save = createRoundSaveWithMoments({
    momentsRepo: {},
    async saveRound() { throw new Error("round persistence failed"); },
    async afterRoundCommittedFn() { momentCalls += 1; }
  });
  await assert.rejects(() => save({}), /round persistence failed/);
  assert.equal(momentCalls, 0);
});
