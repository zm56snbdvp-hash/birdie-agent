import type { CanonicalCard } from "../../domain/card-catalog";
import type { EngineBall } from "./shot-engine.ts";
import type { BallEngineBinding, EngineBindingContext } from "./card-engine-types.ts";

function baseBall(card: CanonicalCard): EngineBall {
  return { id: card.id, name: card.name, power: 0, precision: 0, control: 0, roll: 0, windReduction: 0 };
}

function withBall(card: CanonicalCard, patch: Partial<EngineBall>): EngineBall {
  return { ...baseBall(card), ...patch };
}

function isIronOrWedge(sourceType?: string): boolean {
  return Boolean(sourceType && (sourceType.includes("IRON") || sourceType.includes("WEDGE")));
}

export function bindBallCard(card: CanonicalCard, context?: EngineBindingContext): BallEngineBinding {
  if (card.family !== "BALL") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:BALL`);

  switch (card.id) {
    case "BW1-BALL-001": return { family: "BALL", status: "EXACT", ball: withBall(card, { power: 1, control: -1 }), note: "W+1 / K-1 is directly representable." };
    case "BW1-BALL-002": return { family: "BALL", status: "EXACT", ball: withBall(card, { power: -1, control: 1 }), note: "K+1 / W-1 is directly representable." };
    case "BW1-BALL-003": return { family: "BALL", status: "EXACT", ball: withBall(card, { precision: 1, roll: -1 }), note: "P+1 / ROLL-1 is directly representable." };
    case "BW1-BALL-004": return { family: "BALL", status: "EXACT", ball: withBall(card, { windReduction: 1 }), note: "WIND-1 is directly representable by recovered windReduction." };
    case "BW1-BALL-005": return { family: "BALL", status: "DEFERRED", ball: null, note: "Fairway Runner changes roll only after a Fairway landing; pre-applying it would be wrong." };
    case "BW1-BALL-006": return { family: "BALL", status: "EXACT", ball: withBall(card, { power: 1, control: 1, precision: -2 }), note: "W+1 / K+1 / P-2 is directly representable." };
    case "BW1-BALL-007": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires strokeNumber." };
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: context.strokeNumber === 1 ? withBall(card, { power: 1, precision: -1 }) : baseBall(card), note: "First-shot condition resolved from shot context." };
    }
    case "BW1-BALL-008": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires targetZone." };
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: context.targetZone === "FAIRWAY" ? withBall(card, { precision: 1, control: -1 }) : baseBall(card), note: "Fairway-target condition resolved." };
    }
    case "BW1-BALL-009": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires targetZone and source club type." };
      const active = context.targetZone === "GREEN" && isIronOrWedge(context.sourceClubType);
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: active ? withBall(card, { control: 2, precision: -1, power: -1 }) : baseBall(card), note: "Green + Iron/Wedge condition resolved from canonical source club type." };
    }
    case "BW1-BALL-010": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires current lie." };
      const badLie = context.lie === "ROUGH" || context.lie === "BUNKER";
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: badLie ? withBall(card, { precision: 1 }) : withBall(card, { power: -1 }), note: "Lie branch resolved." };
    }
    case "BW1-BALL-011": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires strokeNumber and previous landing." };
      if (context.strokeNumber < 2) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: baseBall(card), note: "Inactive before stroke 2." };
      if (!context.previousLanding) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Previous landing required from stroke 2 onward." };
      const goodLanding = ["FAIRWAY", "GREEN", "HOLED"].includes(context.previousLanding);
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: goodLanding ? withBall(card, { precision: 1 }) : withBall(card, { control: -1 }), note: "Previous-landing branch resolved." };
    }
    case "BW1-BALL-012": {
      if (!context) return { family: "BALL", status: "CONDITIONAL_EXACT", ball: null, note: "Requires holeId." };
      const active = context.holeId === 5 || context.holeId === 6;
      return { family: "BALL", status: "CONDITIONAL_EXACT", ball: active ? withBall(card, { precision: 1, control: 1, power: -2 }) : baseBall(card), note: "Hole 5/6 condition resolved." };
    }
    default: return { family: "BALL", status: "DEFERRED", ball: null, note: "No verified engine binding exists for this BALL card." };
  }
}
