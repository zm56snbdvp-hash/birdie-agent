import type { CanonicalCard } from "../../domain/card-catalog";
import { STARTER_DECK } from "../../domain/starter-deck";

export type BoosterCardOutcome = "new" | "duplicate";

export interface BoosterOpeningCard {
  slot: number | string;
  card: CanonicalCard;
  outcome: BoosterCardOutcome;
  coinsAwarded: number;
}

export interface BoosterOpening {
  id: string;
  balanceAfter: number;
  cards: BoosterOpeningCard[];
}

export interface BoosterOpenResponse {
  opening?: BoosterOpening;
  error?: string;
}

export function playableCollection(cards: readonly CanonicalCard[]): CanonicalCard[] {
  return cards.filter((card) => card.family !== "COURSE");
}

export function ownedCollection(cards: readonly CanonicalCard[], ownedCardIds: ReadonlySet<string>): CanonicalCard[] {
  return playableCollection(cards).filter((card) => ownedCardIds.has(card.id));
}

export function collectionPercent(owned: number, total: number): number {
  return total <= 0 ? 0 : Math.round((owned / total) * 100);
}

export function applyBoosterOpening(ownedCardIds: ReadonlySet<string>, opening: BoosterOpening): Set<string> {
  const next = new Set(ownedCardIds);
  for (const entry of opening.cards) if (entry.outcome === "new") next.add(entry.card.id);
  return next;
}

export function applyStarterSet(ownedCardIds: ReadonlySet<string>): Set<string> {
  return new Set([
    ...ownedCardIds,
    STARTER_DECK.playerId,
    ...STARTER_DECK.clubIds,
    ...STARTER_DECK.ballIds,
    ...STARTER_DECK.actionIds,
  ]);
}
