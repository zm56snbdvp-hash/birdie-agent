// Sandbox-only client bridge. It reuses the repository's verified Round Mode and TASK-066 adapters.
// No network, Production API or BirdieOS company-data route is reachable from this module.
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createBirdieAppSandboxAdapter } from "../../../src/app/sandbox-adapter.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createBallPassportProjectionAdapter } from "../../../src/app/ball-passport-adapter.mjs";
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
export type ObjectEventDto = {
  contractVersion: "birdie-app-v1"; eventId: string; objectId: string; eventType: string; occurredAt: string;
  roundId: string | null; holeNumber: number | null; privacyClass: "PRIVATE" | "COARSE" | "PUBLIC";
  courseName: string | null; locationLabel: string | null; ruleVersion: string;
};
export type BallPassportDto = {
  contractVersion: "birdie-app-v1"; objectId: string; ownerBirdieId: string; displayName: string;
  editionId: string | null; rarity: string | null; state: string;
  privacySafeStats: { rounds: number; holesSurvived: number; courses: number; birdiesWitnessed: number };
  journey: ObjectEventDto[];
};
export interface BirdieAppAdapter {
  getGolfHistory(birdieId: string): Promise<RoundSummaryDto[]>;
  getRoundDetail(roundId: string, birdieId: string): Promise<RoundDetailDto | null>;
  getOwnedBallPassports(birdieId: string): Promise<BallPassportDto[]>;
  getBallPassport(objectId: string, birdieId: string): Promise<BallPassportDto | null>;
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

const passportAdapter = createBallPassportProjectionAdapter({
  objects: [{
    objectId: "BALL-SANDBOX-001",
    objectType: "BALL",
    displayName: "First Edition Living Ball #001",
    editionCode: "FIRST_EDITION",
    rarity: "COMMON_RARE",
    state: "RESTING",
    holesSurvived: 27
  }],
  ownership: [{ objectId: "BALL-SANDBOX-001", ownerBirdieId: "BIRDIE-SANDBOX-001", status: "ACTIVE" }],
  events: [
    { eventId: "BALL-EVT-001", objectId: "BALL-SANDBOX-001", eventType: "COURSE_VISIT", occurredAt: "2026-08-10T10:00:00.000Z", roundId: demoRound.roundId, privacyClass: "COARSE", courseName: "SANDBOX-COURSE", locationLabel: "Private hole detail", ruleVersion: "birdie-dna-v1" },
    { eventId: "BALL-EVT-002", objectId: "BALL-SANDBOX-001", eventType: "FIRST_BIRDIE", occurredAt: "2026-08-10T10:30:00.000Z", roundId: demoRound.roundId, privacyClass: "PUBLIC", courseName: "SANDBOX-COURSE", locationLabel: "Hole 2", ruleVersion: "birdie-dna-v1" },
    { eventId: "BALL-EVT-003", objectId: "BALL-SANDBOX-001", eventType: "COMMUNITY_EVENT", occurredAt: "2026-08-11T09:00:00.000Z", privacyClass: "PRIVATE", courseName: "Hidden", locationLabel: "Exact private place", ruleVersion: "birdie-dna-v1" }
  ]
});

export const sandboxAdapter: BirdieAppAdapter = {
  async getGolfHistory(birdieId) {
    return roundAdapter.getGolfHistory(birdieId).rounds as RoundSummaryDto[];
  },
  async getRoundDetail(roundId, birdieId) {
    return roundAdapter.getRoundDetail(roundId, birdieId) as RoundDetailDto | null;
  },
  async getOwnedBallPassports(birdieId) {
    return passportAdapter.getOwnedBallPassports(birdieId).passports as BallPassportDto[];
  },
  async getBallPassport(objectId, birdieId) {
    return passportAdapter.getBallPassport(objectId, birdieId) as BallPassportDto | null;
  }
};
