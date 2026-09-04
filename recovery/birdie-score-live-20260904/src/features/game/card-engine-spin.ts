import type { CanonicalCard } from "../../domain/card-catalog";
import { deferred, inactive, needsContext, ready, type ActionEngineBinding, type EngineBindingContext } from "./card-engine-types.ts";

export function bindSpinCard(card: CanonicalCard, context?: EngineBindingContext): ActionEngineBinding {
  if (card.family !== "SPIN") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:SPIN`);
  switch (card.id) {
    case "BW1-SPIN-001": return ready(card, { power: 2, precision: -1, curve: "DRAW" });
    case "BW1-SPIN-002": return ready(card, { precision: 2, power: -1, curve: "FADE" });
    case "BW1-SPIN-003": return ready(card, { control: 2, roll: -2, power: -1 });
    case "BW1-SPIN-004": return ready(card, { roll: 2, control: -1 });
    case "BW1-SPIN-005": {
      if (!context?.club) return needsContext(card, "Requires selected club kind.");
      if (context.club.kind === "WEDGE" || context.club.kind === "PUTTER") return inactive(card, "Illegal with Wedge or Putter.");
      return ready(card, { windReduction: 2, power: 1, control: -1 }, "CONDITIONAL_EXACT", "Club restriction resolved; numeric effect maps directly.");
    }
    case "BW1-SPIN-006": return deferred(card, "Requires obstacle-ignore plus absolute ROLL=0; neither is represented by generic EngineAction.");
    case "BW1-SPIN-007": return ready(card, { power: 1, roll: 1, precision: -1 });
    case "BW1-SPIN-008": {
      if (!context?.club) return needsContext(card, "Requires selected club base W.");
      return context.club.w <= 3 ? ready(card, { power: 2, control: -2 }, "CONDITIONAL_EXACT", "Club base-W gate resolved.") : inactive(card, "Requires club base W<=3.");
    }
    case "BW1-SPIN-009": {
      if (!context || typeof context.windAlong !== "number") return needsContext(card, "Requires actual windAlong; never inferred from hole ID.");
      return context.windAlong > 0
        ? ready(card, { power: 2, roll: 1, precision: -2 }, "CONDITIONAL_EXACT", "Tailwind branch resolved.")
        : ready(card, { power: 1, precision: -1 }, "CONDITIONAL_EXACT", "Non-tailwind branch resolved.");
    }
    case "BW1-SPIN-010": return ready(card, { precision: 1, control: 1, power: -1 });
    case "BW1-SPIN-011": return deferred(card, "Requires target Fairway plus absolute ROLL=0; EngineAction only supports roll deltas.");
    case "BW1-SPIN-012": return ready(card, { precision: 3, power: -1, control: -1 });
    case "BW1-SPIN-013": {
      if (!context) return needsContext(card, "Requires targetZone.");
      return context.targetZone === "GREEN" ? ready(card, { control: 2, precision: -1 }, "CONDITIONAL_EXACT", "Green-target gate resolved.") : inactive(card, "Requires target Green.");
    }
    case "BW1-SPIN-014": return deferred(card, "Requires BREAK-2; EngineAction has no break modifier.");
    case "BW1-SPIN-015": return deferred(card, "Requires absolute ROLL=0 and Iron/Wedge target gate.");
    case "BW1-SPIN-016": return deferred(card, "Requires first-obstacle ignore semantics; no collision suppression field exists.");
    case "BW1-SPIN-017": return deferred(card, "Requires Bunker lie-penalty suppression.");
    case "BW1-SPIN-018": return deferred(card, "Requires post-landing water/out relocation and penalty handling.");
    case "BW1-SPIN-019": {
      if (!context) return needsContext(card, "Requires strokeNumber.");
      return context.strokeNumber === 1 ? ready(card, { power: 1, precision: 1, roll: 1, control: -2 }, "CONDITIONAL_EXACT", "First-stroke gate resolved.") : inactive(card, "Only on first stroke.");
    }
    case "BW1-SPIN-020": return ready(card, { precision: 1, control: 1, roll: -1, afterFirstShot: true }, "CONDITIONAL_EXACT", "Recovered engine natively filters afterFirstShot.");
    case "BW1-SPIN-021": {
      if (!context) return needsContext(card, "Requires strokeNumber and previousLanding.");
      const active = context.strokeNumber >= 2 && Boolean(context.previousLanding && ["FAIRWAY", "GREEN"].includes(context.previousLanding));
      return active ? ready(card, { power: 1, precision: 1, control: -1 }, "CONDITIONAL_EXACT", "Stroke/landing gates resolved.") : inactive(card, "Requires stroke 2+ after Fairway/Green landing.");
    }
    case "BW1-SPIN-022": {
      if (!context?.par) return needsContext(card, "Requires current hole par.");
      return context.strokeNumber >= context.par ? ready(card, { precision: 2, control: 1, power: -1 }, "CONDITIONAL_EXACT", "Own-par-stroke gate resolved.") : inactive(card, "Only from own par stroke onward.");
    }
    case "BW1-SPIN-023": {
      if (!context?.matchScoreState) return needsContext(card, "Requires match score state.");
      const active = [5, 6].includes(context.holeId) && ["TIED", "BEHIND"].includes(context.matchScoreState);
      return active ? ready(card, { precision: 1, control: 2, roll: -1 }, "CONDITIONAL_EXACT", "Hole/score-state gate resolved.") : inactive(card, "Requires hole 5/6 while tied or behind.");
    }
    case "BW1-SPIN-024": return deferred(card, "Numeric modifiers fit, but +1 penalty on missed Green/Hole is post-shot and must not be dropped.");
    default: return deferred(card, "No verified engine binding exists for this SPIN card.");
  }
}
