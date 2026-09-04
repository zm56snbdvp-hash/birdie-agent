import type { CanonicalCard } from "../../domain/card-catalog";

export const DECK_RULES = { playableCardCount: 24, clubs: 4, balls: 3, actions: 17 } as const;

export interface DeckSelection { playerCardId: string | null; cardIds: readonly string[]; }
export interface DeckCounts { clubs: number; balls: number; actions: number; }
export interface DeckValidation {
  valid: boolean;
  counts: DeckCounts;
  uniqueCardIds: boolean;
  playerValid: boolean;
  errors: string[];
}

export function countDeckFamilies(cards: readonly CanonicalCard[], selectedCardIds: readonly string[]): DeckCounts {
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  const selected = selectedCardIds.map((id) => byId.get(id)).filter(Boolean) as CanonicalCard[];
  return {
    clubs: selected.filter((card) => card.family === "CLUB").length,
    balls: selected.filter((card) => card.family === "BALL").length,
    actions: selected.filter((card) => card.family === "SPIN" || card.family === "TACTIC").length,
  };
}

export function validateDeckSelection(
  cards: readonly CanonicalCard[],
  ownedCardIds: ReadonlySet<string>,
  selection: DeckSelection,
): DeckValidation {
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  const counts = countDeckFamilies(cards, selection.cardIds);
  const errors: string[] = [];
  const uniqueCardIds = new Set(selection.cardIds).size === selection.cardIds.length;
  const player = selection.playerCardId ? byId.get(selection.playerCardId) : null;
  const playerValid = Boolean(player && player.family === "PLAYER" && ownedCardIds.has(player.id));

  if (!playerValid) errors.push("PLAYER_REQUIRED");
  if (!uniqueCardIds) errors.push("DUPLICATE_CARD_ID");
  if (selection.cardIds.length !== DECK_RULES.playableCardCount) errors.push("PLAYABLE_CARD_COUNT");
  if (counts.clubs !== DECK_RULES.clubs) errors.push("CLUB_COUNT");
  if (counts.balls !== DECK_RULES.balls) errors.push("BALL_COUNT");
  if (counts.actions !== DECK_RULES.actions) errors.push("ACTION_COUNT");

  for (const id of selection.cardIds) {
    const card = byId.get(id);
    if (!card) errors.push(`UNKNOWN_CARD:${id}`);
    else if (!ownedCardIds.has(id)) errors.push(`UNOWNED_CARD:${id}`);
    else if (!["CLUB", "BALL", "SPIN", "TACTIC"].includes(card.family)) errors.push(`INVALID_PLAYABLE_FAMILY:${id}`);
  }

  return { valid: errors.length === 0, counts, uniqueCardIds, playerValid, errors };
}
