import test from "node:test";
import assert from "node:assert/strict";
import { detectPersonalBest } from "../src/moments/personal-best.mjs";
import { evaluateCompletedRound, handleRoundCompleted } from "../src/moments/evaluate-round.mjs";
import { endSandboxRoundAndEvaluateMoments } from "../src/moments/round-completion.mjs";

const base = {
  id: "r-current",
  userId: "u-1",
  displayName: "Kevin",
  courseName: "Test Course",
  playedAt: "2026-09-04T10:00:00+02:00",
  holesPlayed: 18,
  totalScore: 82,
  birdieCount: 3,
  isCompleted: true
};

function round(overrides = {}) { return { ...base, ...overrides }; }
function prior(id, totalScore, holesPlayed = 18, userId = "u-1") {
  return {
    id, userId, displayName: "Kevin", courseName: "Old Course",
    playedAt: "2026-08-01T10:00:00+02:00", holesPlayed, totalScore,
    birdieCount: 1, isCompleted: true
  };
}
function memoryRepo(currentRound, previous = []) {
  const byKey = new Map();
  let insertCount = 0;
  return {
    get insertCount() { return insertCount; },
    get moments() { return [...byKey.values()]; },
    async getRound(id) { return id === currentRound.id ? currentRound : null; },
    async listPreviousComparableRounds() { return previous; },
    async ensureMoment(input) {
      const key = `${input.roundId}|${input.momentType}|${input.templateVersion}`;
      if (byKey.has(key)) return byKey.get(key);
      insertCount += 1;
      const row = { id: `m${insertCount}`, ...input };
      byKey.set(key, row);
      return row;
    }
  };
}

test("true new 18-hole best is detected with positive strokesImproved", () => {
  const result = detectPersonalBest(base, [prior("r1", 86), prior("r2", 84)]);
  assert.equal(result.isPersonalBest, true);
  assert.equal(result.previousBestScore, 84);
  assert.equal(result.strokesImproved, 2);
  assert.equal("improvement" in result, false);
});

test("tie is not a PB", () => {
  const result = detectPersonalBest(base, [prior("r1", 82)]);
  assert.equal(result.isPersonalBest, false);
  assert.equal(result.reason, "TIED_BEST");
});

test("worse score is not a PB", () => {
  const result = detectPersonalBest(base, [prior("r1", 80)]);
  assert.equal(result.isPersonalBest, false);
  assert.equal(result.reason, "NOT_BETTER");
});

test("first comparable round does not claim PB", () => {
  const result = detectPersonalBest(base, []);
  assert.equal(result.isPersonalBest, false);
  assert.equal(result.reason, "NO_COMPARABLE_HISTORY");
});

test("9-hole history is not mixed with 18-hole current round", () => {
  const result = detectPersonalBest(base, [prior("r9", 40, 9)]);
  assert.equal(result.isPersonalBest, false);
  assert.equal(result.reason, "NO_COMPARABLE_HISTORY");
});

test("other users are never compared", () => {
  const result = detectPersonalBest(base, [prior("other", 90, 18, "u-2")]);
  assert.equal(result.isPersonalBest, false);
  assert.equal(result.reason, "NO_COMPARABLE_HISTORY");
});

test("normal round creates exactly one ROUND moment", async () => {
  const repo = memoryRepo(round(), [prior("old", 80)]);
  const result = await evaluateCompletedRound(base.id, repo);
  assert.equal(result.accepted, true);
  assert.equal(repo.moments.length, 1);
  assert.equal(repo.moments[0].momentType, "ROUND");
});

test("duplicate trigger remains idempotent", async () => {
  const repo = memoryRepo(round(), [prior("old", 80)]);
  await evaluateCompletedRound(base.id, repo);
  await evaluateCompletedRound(base.id, repo);
  assert.equal(repo.insertCount, 1);
});

test("real PB creates ROUND plus PERSONAL_BEST", async () => {
  const repo = memoryRepo(round(), [prior("old", 86)]);
  await evaluateCompletedRound(base.id, repo);
  assert.equal(repo.moments.length, 2);
  assert.deepEqual(repo.moments.map((x) => x.momentType).sort(), ["PERSONAL_BEST", "ROUND"]);
});

test("first round creates ROUND only", async () => {
  const repo = memoryRepo(round(), []);
  const result = await evaluateCompletedRound(base.id, repo);
  assert.equal(result.personalBest.reason, "NO_COMPARABLE_HISTORY");
  assert.equal(repo.moments.length, 1);
});

test("incomplete round creates no moment", async () => {
  const repo = memoryRepo(round({ birdieCount: undefined }), []);
  const result = await evaluateCompletedRound(base.id, repo);
  assert.equal(result.accepted, false);
  assert.equal(repo.moments.length, 0);
});

test("PB lookup failure fails closed but preserves ROUND moment", async () => {
  const repo = memoryRepo(round(), []);
  repo.listPreviousComparableRounds = async () => { throw new Error("history unavailable"); };
  const result = await evaluateCompletedRound(base.id, repo);
  assert.equal(result.accepted, true);
  assert.equal(result.personalBest.isPersonalBest, false);
  assert.equal(result.personalBest.reason, "PB_EVALUATION_UNPROVEN");
  assert.equal(repo.moments.length, 1);
});

test("pipeline failure is swallowed by post-commit adapter", async () => {
  const result = await handleRoundCompleted({ roundId: "missing" }, {
    async getRound() { throw new Error("db unavailable"); }
  }, { error() {} });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "MOMENT_PIPELINE_FAILED");
});

test("historical sandbox round is completed before Moments evaluation and remains completed on failure", async () => {
  let completed = false;
  const roundMode = {
    endRound(roundId) {
      completed = true;
      return { roundId, status: "COMPLETED" };
    }
  };
  const result = await endSandboxRoundAndEvaluateMoments({
    roundMode,
    roundId: "ROUND-0001",
    momentsRepo: { async getRound() { throw new Error("moments unavailable"); } },
    logger: { error() {} }
  });
  assert.equal(completed, true);
  assert.equal(result.round.status, "COMPLETED");
  assert.equal(result.momentResult.reason, "MOMENT_PIPELINE_FAILED");
});
