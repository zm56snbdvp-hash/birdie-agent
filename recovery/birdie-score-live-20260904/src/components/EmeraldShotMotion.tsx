import React from "react";
import type { CourseShot } from "../features/game/course-flight";
import { phaseForShot, type EmeraldPresentation, type EmeraldShotPhase } from "../features/game/emerald-presentation";
export type { EmeraldShotPhase } from "../features/game/emerald-presentation";

/** Backward-named adapter: deliberately no timers, effects or animation clock. */
export function useEmeraldShotPhase(shot?: CourseShot, snapshot: EmeraldPresentation | null = null): EmeraldShotPhase {
  return phaseForShot(shot, snapshot);
}
export function EmeraldShotAtmosphere({ phase }: { phase: EmeraldShotPhase }) {
  return <div className="bw-shot-atmosphere" data-shot-phase={phase} aria-hidden="true">
    <span className="bw-shot-vein vein-a"/><span className="bw-shot-vein vein-b"/><span className="bw-shot-pulse"/>
  </div>;
}
