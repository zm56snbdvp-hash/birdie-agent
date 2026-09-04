import type { CanonicalCard } from "../../domain/card-catalog";
import { deferred, inactive, needsContext, ready, type ActionEngineBinding, type EngineBindingContext } from "./card-engine-types.ts";

export function bindTacticCard(card: CanonicalCard, context?: EngineBindingContext): ActionEngineBinding {
  if (card.family !== "TACTIC") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:TACTIC`);
  switch (card.id) {
    case "BW1-TAC-001": return deferred(card, "Requires target Fairway and effective W cap 3; no stat-cap field exists.");
    case "BW1-TAC-002": return deferred(card, "Changes club legality and lie penalty; both live outside EngineAction.");
    case "BW1-TAC-003": {
      if (!context) return needsContext(card, "Requires targetZone.");
      return context.targetZone === "GREEN" ? ready(card, { precision: 1, control: 2 }, "CONDITIONAL_EXACT", "Green-target gate resolved.") : inactive(card, "Requires target Green.");
    }
    case "BW1-TAC-004": return deferred(card, "Caddie's Call is deck/hand manipulation, not a shot-stat modifier.");
    case "BW1-TAC-005": return ready(card, { power: 2, control: -2, teeOnly: true, blockSpin: true }, "CONDITIONAL_EXACT", "Recovered engine supports teeOnly and GameApp supports blockSpin replacement.");
    case "BW1-TAC-006": return deferred(card, "Requires Fairway + distance gate and ROLL x1.5; no roll multiplier exists.");
    case "BW1-TAC-007": return deferred(card, "Requires player-selected N and SPIN-N; no SPIN stat field exists.");
    case "BW1-TAC-008": {
      if (!context?.timingGrade) return needsContext(card, "Requires current timing grade.");
      return context.timingGrade === "PERFECT" ? ready(card, { power: 3, control: 1 }, "CONDITIONAL_EXACT", "PERFECT branch resolved.") : ready(card, { power: 1 }, "CONDITIONAL_EXACT", "Non-PERFECT branch resolved.");
    }
    case "BW1-TAC-009": {
      if (!context) return needsContext(card, "Requires lie and remaining distance.");
      const active = context.lie === "FAIRWAY" && context.remaining <= 100;
      return active ? ready(card, { control: 2 }, "CONDITIONAL_EXACT", "Fairway <=100m gate resolved.") : inactive(card, "Requires Fairway and <=100m.");
    }
    case "BW1-TAC-010": return deferred(card, "PERFECT_WINDOW+15% conversion was server-adapter logic not present in browser bundles; do not guess it.");
    case "BW1-TAC-011": return deferred(card, "Reduces side-wind only; recovered windReduction would also alter longitudinal wind.");
    case "BW1-TAC-012": return deferred(card, "Requires zero lateral scatter after GOOD/PERFECT; no scatter override exists.");
    case "BW1-TAC-013": return deferred(card, "Requires SPIN+1 and ROLL x0.4; unsupported fields.");
    case "BW1-TAC-014": return deferred(card, "Requires curve magnitude x2; only curve direction is represented.");
    case "BW1-TAC-015": return deferred(card, "Allows exactly two Spin cards; hand/play legality, not one EngineAction.");
    case "BW1-TAC-016": return deferred(card, "Requires Rough distance-penalty suppression and ROLL x1.25.");
    case "BW1-TAC-017": return deferred(card, "Requires Bunker spin-penalty suppression, SPIN+1 and ROLL x0.25.");
    case "BW1-TAC-018": return deferred(card, "Requires vegetation-collision suppression.");
    case "BW1-TAC-019": return deferred(card, "PERFECT_WINDOW+25% conversion not recovered.");
    case "BW1-TAC-020": return deferred(card, "Second Swing restarts timing; GameApp state-machine behavior, not a shot modifier.");
    case "BW1-TAC-021": {
      if (!context?.previousGrade) return needsContext(card, "Requires previous shot grade.");
      return context.previousGrade === "PERFECT" ? ready(card, { power: 1, control: 1 }, "CONDITIONAL_EXACT", "Previous PERFECT gate resolved.") : inactive(card, "Requires previous shot PERFECT.");
    }
    case "BW1-TAC-022": return deferred(card, "Requires conditional Putt K+1 plus ROLL x0.75; multiplier unsupported.");
    case "BW1-TAC-023": return deferred(card, "K+1 fits but PERFECT_WINDOW+20% conversion is unrecovered; fail closed rather than partially apply.");
    case "BW1-TAC-024": return deferred(card, "Requires hole/match gate, player choice of two stats, and SPIN+2 option.");
    default: return deferred(card, "No verified engine binding exists for this TACTIC card.");
  }
}
