import type { CanonicalCard } from "../../domain/card-catalog";
import type { EngineAction, EngineBall, EngineClub, EnginePlayer, Lie, TimingGrade } from "./shot-engine.ts";

export type EngineBindingStatus = "EXACT" | "CONDITIONAL_EXACT" | "PROVISIONAL" | "DEFERRED" | "REFERENCE_ONLY";
export type TargetZone = "FAIRWAY" | "GREEN" | "OTHER";
export type MatchScoreState = "AHEAD" | "TIED" | "BEHIND";

export interface EngineBindingContext {
  lie: Lie;
  strokeNumber: number;
  holeId: number;
  remaining: number;
  targetZone: TargetZone;
  club?: EngineClub;
  sourceClubType?: string;
  previousLanding?: Lie | null;
  timingGrade?: TimingGrade | null;
  previousGrade?: TimingGrade | null;
  windAlong?: number;
  matchScoreState?: MatchScoreState;
  par?: number;
}

export interface PlayerEngineBinding {
  family: "PLAYER";
  status: "EXACT";
  player: EnginePlayer;
  signatureMode: "ONE_READ" | "DEFERRED";
  note: string;
}

export interface ClubEngineBinding {
  family: "CLUB";
  status: "PROVISIONAL";
  club: EngineClub;
  sourceType: string;
  note: string;
}

export interface BallEngineBinding {
  family: "BALL";
  status: "EXACT" | "CONDITIONAL_EXACT" | "DEFERRED";
  ball: EngineBall | null;
  note: string;
}

export interface ActionEngineBinding {
  family: "SPIN" | "TACTIC";
  status: "EXACT" | "CONDITIONAL_EXACT" | "DEFERRED";
  action: EngineAction | null;
  active: boolean;
  note: string;
}

export interface CourseEngineBinding {
  family: "COURSE";
  status: "REFERENCE_ONLY";
  courseSequence: number;
  note: string;
}

export type CardEngineBinding = PlayerEngineBinding | ClubEngineBinding | BallEngineBinding | ActionEngineBinding | CourseEngineBinding;

export function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number" && Number.isFinite(entry)) output[key] = entry;
  }
  return output;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function action(card: CanonicalCard, patch: Partial<EngineAction>): EngineAction {
  return { family: card.family as "SPIN" | "TACTIC", name: card.name, ...patch };
}

export function inactive(card: CanonicalCard, note: string): ActionEngineBinding {
  return { family: card.family as "SPIN" | "TACTIC", status: "CONDITIONAL_EXACT", action: null, active: false, note };
}

export function needsContext(card: CanonicalCard, note: string): ActionEngineBinding {
  return { family: card.family as "SPIN" | "TACTIC", status: "CONDITIONAL_EXACT", action: null, active: false, note };
}

export function ready(
  card: CanonicalCard,
  patch: Partial<EngineAction>,
  status: "EXACT" | "CONDITIONAL_EXACT" = "EXACT",
  note = "Directly representable by recovered EngineAction fields.",
): ActionEngineBinding {
  return { family: card.family as "SPIN" | "TACTIC", status, action: action(card, patch), active: true, note };
}

export function deferred(card: CanonicalCard, note: string): ActionEngineBinding {
  return { family: card.family as "SPIN" | "TACTIC", status: "DEFERRED", action: null, active: false, note };
}
