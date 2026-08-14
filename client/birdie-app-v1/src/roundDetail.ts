import type { RoundDetailDto } from "./appAdapter";

export function formatRoundDetail(detail: RoundDetailDto) {
  return {
    title: detail.round.courseRef ?? "Course not provided",
    meta: `${detail.round.totals.strokes} strokes · ${detail.round.totals.scoredHoles}/${detail.round.holeCount} holes`,
    privacy: detail.gpsDataUsed ? "GPS verwendet" : "Keine GPS-Daten verwendet",
    holes: detail.holes.map((hole) => ({
      holeNumber: hole.holeNumber,
      strokes: hole.strokes,
      putts: hole.putts,
      penalties: hole.penalties,
      completionState: hole.completionState
    }))
  };
}
