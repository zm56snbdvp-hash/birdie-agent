import assert from "node:assert/strict";
import test from "node:test";

import { createBirdieAppSandboxAdapter } from "../src/app/sandbox-adapter.mjs";
import { createRoundModeSandbox } from "../src/round-mode/service.mjs";
import { createDeterministicClock } from "../src/round-mode/simulator.mjs";

function fixture() {
  const engine = createRoundModeSandbox({ now: createDeterministicClock() });
  const round = engine.startRound({
    birdieId: "BIRDIE-APP-001",
    courseRef: "SANDBOX-COURSE",
    holeCount: 3
  });
  engine.activateHole(round.roundId, 1);
  engine.recordHoleScore(round.roundId, 1, { strokes: 4, putts: 2 });
  engine.completeHole(round.roundId, 1);
  return { engine, round };
}

test("maps verified Round Mode state into Birdie App V1 history DTOs", () => {
  const { engine, round } = fixture();
  const adapter = createBirdieAppSandboxAdapter({ roundEngine: engine });
  const history = adapter.getGolfHistory("BIRDIE-APP-001");

  assert.equal(history.contractVersion, "birdie-app-v1");
  assert.equal(history.source, "ROUND_MODE_SANDBOX");
  assert.equal(history.rounds.length, 1);
  assert.equal(history.rounds[0].roundId, round.roundId);
  assert.equal(history.rounds[0].totals.strokes, 4);
  assert.equal(history.rounds[0].totals.scoredHoles, 1);
});

test("round detail never fabricates par, tee or GPS facts", () => {
  const { engine, round } = fixture();
  const adapter = createBirdieAppSandboxAdapter({ roundEngine: engine });
  const detail = adapter.getRoundDetail(round.roundId, "BIRDIE-APP-001");

  assert.equal(detail.round.teeRef, null);
  assert.equal(detail.holes[0].par, null);
  assert.equal(detail.gpsDataUsed, false);
  assert.equal(detail.sandbox, true);
});

test("adapter enforces per-user round visibility", () => {
  const { engine, round } = fixture();
  const adapter = createBirdieAppSandboxAdapter({ roundEngine: engine });

  assert.equal(adapter.getRoundDetail(round.roundId, "OTHER-BIRDIE"), null);
  assert.equal(adapter.getGolfHistory("OTHER-BIRDIE").rounds.length, 0);
});
