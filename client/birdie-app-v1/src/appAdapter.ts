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
  totals: {
    strokes: number;
    putts: number;
    penalties: number;
    scoredHoles: number;
  };
};

export type RoundHoleDto = {
  contractVersion: "birdie-app-v1";
  roundId: string;
  holeNumber: number;
  par: null;
  strokes: number | null;
  putts: number | null;
  penalties: number | null;
  scoreRevision: number;
  completionState: "SCORED" | "UNSCORED";
};

export type RoundDetailDto = {
  contractVersion: "birdie-app-v1";
  round: RoundSummaryDto;
  holes: RoundHoleDto[];
  courseDataMode: "REFERENCE_ONLY" | "UNSPECIFIED";
  gpsDataUsed: false;
  sandbox: true;
};

export interface BirdieAppAdapter {
  getGolfHistory(birdieId: string): Promise<RoundSummaryDto[]>;
  getRoundDetail(roundId: string, birdieId: string): Promise<RoundDetailDto | null>;
}

const sandboxHistory: RoundSummaryDto[] = [
  {
    contractVersion: "birdie-app-v1",
    roundId: "ROUND-0001",
    birdieId: "BIRDIE-SANDBOX-001",
    courseRef: "SANDBOX-COURSE",
    teeRef: null,
    holeCount: 3,
    startedAt: "2026-08-12T16:00:00.000Z",
    finishedAt: "2026-08-12T16:18:00.000Z",
    status: "COMPLETED",
    totals: { strokes: 13, putts: 0, penalties: 1, scoredHoles: 3 }
  }
];

const sandboxDetails: Record<string, RoundDetailDto> = {
  "ROUND-0001": {
    contractVersion: "birdie-app-v1",
    round: sandboxHistory[0],
    holes: [
      { contractVersion: "birdie-app-v1", roundId: "ROUND-0001", holeNumber: 1, par: null, strokes: 4, putts: null, penalties: null, scoreRevision: 1, completionState: "SCORED" },
      { contractVersion: "birdie-app-v1", roundId: "ROUND-0001", holeNumber: 2, par: null, strokes: 5, putts: null, penalties: 1, scoreRevision: 1, completionState: "SCORED" },
      { contractVersion: "birdie-app-v1", roundId: "ROUND-0001", holeNumber: 3, par: null, strokes: 4, putts: null, penalties: null, scoreRevision: 1, completionState: "SCORED" }
    ],
    courseDataMode: "REFERENCE_ONLY",
    gpsDataUsed: false,
    sandbox: true
  }
};

export const sandboxAdapter: BirdieAppAdapter = {
  async getGolfHistory(birdieId) {
    return sandboxHistory.filter((round) => round.birdieId === birdieId);
  },
  async getRoundDetail(roundId, birdieId) {
    const detail = sandboxDetails[roundId];
    if (!detail || detail.round.birdieId !== birdieId) return null;
    return structuredClone(detail);
  }
};
