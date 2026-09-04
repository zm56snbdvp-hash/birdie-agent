import meta from "./card-catalog-meta.json";
import players from "./cards-player.json";
import clubs from "./cards-club.json";
import balls from "./cards-ball.json";
import spins from "./cards-spin.json";
import tactics from "./cards-tactic.json";
import courses from "./cards-course.json";

export type CardFamily = "PLAYER" | "CLUB" | "BALL" | "SPIN" | "TACTIC" | "COURSE";
export type CardRarity = "FLOCK" | "TOUR" | "MAJOR" | "LEGACY";

export interface CanonicalCard {
  id: string;
  physicalNumber: string;
  family: CardFamily;
  name: string;
  rarity: CardRarity | null;
  fixed: boolean;
  type: string;
  rulesText?: string;
  tradeoff?: string;
  [key: string]: unknown;
}

function asCanonicalCards(value: unknown): CanonicalCard[] {
  return value as CanonicalCard[];
}

export const CARDS: readonly CanonicalCard[] = [
  ...asCanonicalCards(players),
  ...asCanonicalCards(clubs),
  ...asCanonicalCards(balls),
  ...asCanonicalCards(spins),
  ...asCanonicalCards(tactics),
  ...asCanonicalCards(courses),
];

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card] as const));

/** Recovered catalog metadata; cards are sourced from the canonical family files above. */
export const CARD_CATALOG = {
  ...meta,
  cards: CARDS,
} as const;
