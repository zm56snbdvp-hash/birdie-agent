import React, { useMemo, useState } from "react";
import type { CanonicalCard, CardFamily } from "../../domain/card-catalog";
import { CardArtwork } from "../../components/CardArtwork";
import { DECK_RULES, validateDeckSelection } from "./model";

export interface SavedDeck { playerCardId: string | null; cardIds: string[]; }
export interface DeckBuilderProps { cards: CanonicalCard[]; ownedCardIds: string[]; initialDeck?: SavedDeck | null; }

const FAMILY_LABELS: Partial<Record<CardFamily, string>> = {
  PLAYER: "Spieler", CLUB: "Schläger", BALL: "Bälle", SPIN: "Spin", TACTIC: "Taktik",
};
const BUILDABLE_FAMILIES: CardFamily[] = ["PLAYER", "CLUB", "BALL", "SPIN", "TACTIC"];

export function DeckBuilder({ cards, ownedCardIds, initialDeck }: DeckBuilderProps) {
  const owned = useMemo(() => new Set(ownedCardIds), [ownedCardIds]);
  const available = useMemo(() => cards.filter((card) => owned.has(card.id) && card.family !== "COURSE"), [cards, owned]);
  const [playerCardId, setPlayerCardId] = useState<string | null>(initialDeck?.playerCardId ?? null);
  const [cardIds, setCardIds] = useState<string[]>(initialDeck?.cardIds ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const validation = useMemo(() => validateDeckSelection(cards, owned, { playerCardId, cardIds }), [cards, owned, playerCardId, cardIds]);
  const grouped = useMemo(() => BUILDABLE_FAMILIES.map((family) => [family, available.filter((card) => card.family === family)] as const), [available]);

  function togglePlayableCard(id: string) {
    setCardIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function saveDeck() {
    if (!validation.valid || saving) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/deck", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerCardId, cardIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.errors?.join(" ") ?? body.error ?? "Deck konnte nicht gespeichert werden.");
      setMessage("Aktives Deck gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deck konnte nicht gespeichert werden.");
    } finally { setSaving(false); }
  }

  if (available.length === 0) {
    return <main className="score-shell min-h-dvh text-foreground"><section className="panel mx-auto mt-10 max-w-xl rounded-[28px] p-7"><p className="eyebrow">BirdieWorld · Deckbau</p><h1 className="art-title mt-3 text-4xl">Sichere erst dein Starter Set.</h1><a href="/karten" className="gold-action mt-7 inline-flex min-h-12 items-center rounded-xl px-5 font-semibold text-ink">Starter Set sichern</a></section></main>;
  }

  return <main className="score-shell min-h-dvh text-foreground"><div className="safe-page mx-auto max-w-[980px] px-4 sm:px-7">
    <header className="mt-6"><a href="/spiel" className="inline-flex min-h-11 items-center text-sm font-semibold text-moss">← Zum Spiel</a></header>
    <section className="mt-10"><p className="eyebrow">BirdieWorld · Deckbau</p><h1 className="art-title mt-3 text-5xl">Dein aktives Deck</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-cream-dim">Ein Spieler, {DECK_RULES.clubs} Schläger, {DECK_RULES.balls} Bälle und {DECK_RULES.actions} Aktionskarten.</p></section>
    <div className="panel mt-7 grid gap-2 rounded-[28px] p-5 text-sm sm:grid-cols-5"><span>{validation.playerValid ? "✓ Spieler" : "Spieler fehlt"}</span><span>{validation.counts.clubs}/{DECK_RULES.clubs} Schläger</span><span>{validation.counts.balls}/{DECK_RULES.balls} Bälle</span><span>{validation.counts.actions}/{DECK_RULES.actions} Aktionen</span><span>{cardIds.length}/{DECK_RULES.playableCardCount} Karten</span></div>
    <div className="mt-5 grid gap-5">{grouped.map(([family, familyCards]) => <section key={family} className="panel rounded-[28px] p-5"><h2 className="text-lg font-semibold">{FAMILY_LABELS[family]}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{familyCards.map((card) => {
      const player = family === "PLAYER"; const selected = player ? playerCardId === card.id : cardIds.includes(card.id);
      return <button key={card.id} type="button" aria-pressed={selected} onClick={() => player ? setPlayerCardId(selected ? null : card.id) : togglePlayableCard(card.id)} className={`flex min-h-28 gap-3 rounded-2xl border p-3 text-left ${selected ? "border-gold-soft bg-gold-soft/10" : "border-white/10 bg-black/15"}`}><CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative className="h-20 w-[60px] shrink-0 rounded-lg"/><span className="min-w-0 flex-1"><span className="text-xs text-gold-soft">{card.physicalNumber}</span><strong className="mt-2 block">{card.name}</strong><span className="mt-2 line-clamp-2 block text-xs leading-5 text-moss">{String(card.rulesText ?? "")}</span></span></button>;
    })}</div></section>)}</div>
    <div className="sticky bottom-3 mt-7 flex items-center justify-between gap-3 rounded-2xl border border-gold-soft/20 bg-[#09150e]/95 p-3 backdrop-blur"><p className="text-sm text-moss">{message ?? (validation.valid ? "Deck ist spielbereit." : "Vervollständige dein 24-Karten-Deck.")}</p><button type="button" className="gold-action min-h-12 rounded-xl px-5 font-semibold text-ink disabled:opacity-50" disabled={saving || !validation.valid} onClick={saveDeck}>{saving ? "Speichert …" : "Deck speichern"}</button></div>
  </div></main>;
}
