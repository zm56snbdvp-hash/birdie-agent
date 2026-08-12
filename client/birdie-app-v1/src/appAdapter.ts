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

export interface BirdieAppAdapter {
  getGolfHistory(birdieId: string): Promise<RoundSummaryDto[]>;
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

export const sandboxAdapter: BirdieAppAdapter = {
  async getGolfHistory(birdieId) {
    return sandboxHistory.filter((round) => round.birdieId === birdieId);
  }
};
