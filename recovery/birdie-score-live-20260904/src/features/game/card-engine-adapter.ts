import type { CanonicalCard } from "../../domain/card-catalog";
import { bindBallCard } from "./card-engine-ball.ts";
import { bindClubCard, bindPlayerCard } from "./card-engine-player-club.ts";
import { bindSpinCard } from "./card-engine-spin.ts";
import { bindTacticCard } from "./card-engine-tactic.ts";
import type { CardEngineBinding, CourseEngineBinding, EngineBindingContext } from "./card-engine-types.ts";

export * from "./card-engine-types.ts";
export { bindBallCard } from "./card-engine-ball.ts";
export { bindClubCard, bindPlayerCard } from "./card-engine-player-club.ts";
export { bindSpinCard } from "./card-engine-spin.ts";
export { bindTacticCard } from "./card-engine-tactic.ts";

export function bindCourseCard(card: CanonicalCard): CourseEngineBinding {
  if (card.family !== "COURSE") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:COURSE`);
  const sequence = typeof card.sequence === "number" ? card.sequence : Number.NaN;
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`CARD_ENGINE_COURSE_SEQUENCE_INVALID:${card.id}`);
  return {
    family: "COURSE",
    status: "REFERENCE_ONLY",
    courseSequence: sequence,
    note: "Canonical course identity is preserved. Catalog rules are not silently substituted for deployed six-hole hazard rules.",
  };
}

export function bindActionCard(card: CanonicalCard, context?: EngineBindingContext) {
  if (card.family === "SPIN") return bindSpinCard(card, context);
  if (card.family === "TACTIC") return bindTacticCard(card, context);
  throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:ACTION`);
}

export function bindCanonicalCard(card: CanonicalCard, context?: EngineBindingContext): CardEngineBinding {
  switch (card.family) {
    case "PLAYER": return bindPlayerCard(card);
    case "CLUB": return bindClubCard(card);
    case "BALL": return bindBallCard(card, context);
    case "SPIN": return bindSpinCard(card, context);
    case "TACTIC": return bindTacticCard(card, context);
    case "COURSE": return bindCourseCard(card);
    default: throw new Error(`CARD_ENGINE_FAMILY_UNKNOWN:${String((card as CanonicalCard).family)}`);
  }
}
