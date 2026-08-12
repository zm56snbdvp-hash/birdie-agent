// Sandbox-only client bridge. It reuses the repository's verified Round Mode and TASK-066 adapter.
// No network, Production API or BirdieOS company-data route is reachable from this module.
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createBirdieAppSandboxAdapter } from "../../../src/app/sandbox-adapter.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createRoundModeSandbox } from "../../../src/round-mode/service.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createDeterministicClock } from "../../../src/round-mode/simulator.mjs";

export type RoundSummaryDto = {
  contractVersion: "birdie-app-v1";
  roundId: string;
  birdieId: string;
  courseRef: string | null;
  teeRef: string | null;
  holeCount: number;
  startedAt: string;
  finishedAt: string | null;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  totals: { strokes: number; putts: number; penalties: number; scoredHoles: number };
};
export type RoundHoleDto = {
  contractVersion: "birdie-app-v1"; roundId: string; holeNumber: number; par: null; strokes: number | null;
  putts: number | null; penalties: number | null; scoreRevision: number; completionState: "SCORED" | "UNSCORED";
};
export type RoundDetailDto = {
  contractVersion: "birdie-app-v1"; round: RoundSummaryDto; holes: RoundHoleDto[];
  courseDataMode: "REFERENCE_ONLY" | "UNSPECIFIED"; gpsDataUsed: false; sandbox: true;
};
export interface BirdieAppAdapter {
  getGolfHistory(birdieId: string): Promise<RoundSummaryDto[]>;
  getRoundDetail(roundId: string, birdieId: string): Promise<RoundDetailDto | null>;
}

const engine = createRoundModeSandbox({ now: createDeterministicClock() });
const demoRound = engine.startRound({ birdieId: "BIRDIE-SANDBOX-001", courseRef: "SANDBOX-COURSE", holeCount: 3 });
for (const [holeNumber, score] of [[1, { strokes: 4, putts: 2 }], [2, { strokes: 5, penalties: 1 }], [3, { strokes: 4 }]] as const) {
  engine.activateHole(demoRound.roundId, holeNumber);
  engine.recordHoleScore(demoRound.roundId, holeNumber, score);
  engine.completeHole(demoRound.roundId, holeNumber);
}
engine.endRound(demoRound.roundId);
const roundAdapter = createBirdieAppSandboxAdapter({ roundEngine: engine });

export const sandboxAdapter: BirdieAppAdapter = {
  async getGolfHistory(birdieId) {
    return roundAdapter.getGolfHistory(birdieId).rounds as RoundSummaryDto[];
  },
  async getRoundDetail(roundId, birdieId) {
    return roundAdapter.getRoundDetail(roundId, birdieId) as RoundDetailDto | null;
  }
};
