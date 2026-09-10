import React, { useMemo, useState } from "react";
import type { CanonicalCard, CardFamily } from "../../domain/card-catalog";
import { CardArtwork } from "../../components/CardArtwork";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { EmeraldWorldNav } from "../../components/EmeraldWorldNav";
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
    return <main className="bw-world score-shell min-h-dvh text-foreground" data-design-pass="emerald-world-pass-02">
      <EmeraldWorldSkin/>
      <div className="bw-page safe-page">
        <section className="bw-panel mt-10 p-7">
          <p className="bw-kicker">BirdieWorld · Deckbau</p>
          <h1 className="bw-title mt-3 text-4xl">Sichere erst dein Starter Set.</h1>
          <a href="/karten" className="bw-gold-button mt-7">Starter Set sichern</a>
        </section>
        <EmeraldWorldNav active="cards"/>
      </div>
    </main>;
  }

  return <main className="bw-world score-shell min-h-dvh text-foreground" data-design-pass="emerald-world-pass-02">
    <EmeraldWorldSkin/>
    <div className="bw-page safe-page">
      <header className="bw-topbar">
        <a href="/spiel" className="bw-brand">BIRDIEWORLD<small>DECK LAB · FIRST EDITION</small></a>
        <span className="bw-coin">{cardIds.length}/{DECK_RULES.playableCardCount} Karten</span>
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">Sammlung wird Spiel</p>
        <h1 className="bw-title">Dein aktives Deck</h1>
        <p className="bw-copy">Ein Spieler, {DECK_RULES.clubs} Schläger, {DECK_RULES.balls} Bälle und {DECK_RULES.actions} Aktionskarten. Der Deckbau bleibt regelgetreu, fühlt sich aber wie die Vorbereitung auf eine Runde in derselben Emerald-Welt an.</p>
      </section>

      <div className="bw-status-strip mt-6">
        <span className="bw-status-chip">{validation.playerValid ? "✓ Spieler" : "Spieler fehlt"}</span>
        <span className="bw-status-chip">{validation.counts.clubs}/{DECK_RULES.clubs} Schläger</span>
        <span className="bw-status-chip">{validation.counts.balls}/{DECK_RULES.balls} Bälle</span>
        <span className="bw-status-chip">{validation.counts.actions}/{DECK_RULES.actions} Aktionen</span>
        <span className="bw-status-chip">{cardIds.length}/{DECK_RULES.playableCardCount} Karten</span>
      </div>

      <div className="mt-5 grid gap-5">{grouped.map(([family, familyCards]) => <section key={family} className="bw-panel p-5 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div><p className="bw-kicker">Loadout</p><h2 className="mt-2 text-xl font-semibold">{FAMILY_LABELS[family]}</h2></div>
          <span className="text-xs text-moss">{familyCards.length} verfügbar</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{familyCards.map((card) => {
          const player = family === "PLAYER"; const selected = player ? playerCardId === card.id : cardIds.includes(card.id);
          return <button key={card.id} type="button" aria-pressed={selected} onClick={() => player ? setPlayerCardId(selected ? null : card.id) : togglePlayableCard(card.id)} className={`bw-card flex min-h-28 gap-3 p-3 text-left ${selected ? "bw-select" : ""}`}>
            <CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative className="h-20 w-[60px] shrink-0 rounded-lg"/>
            <span className="min-w-0 flex-1"><span className="bw-card-meta">{card.physicalNumber}</span><strong className="mt-2 block">{card.name}</strong><span className="mt-2 line-clamp-2 block text-xs leading-5 text-moss">{String(card.rulesText ?? "")}</span></span>
          </button>;
        })}</div>
      </section>)}</div>

      <div className="bw-panel mt-7 flex items-center justify-between gap-3 p-3">
        <p className="text-sm text-moss">{message ?? (validation.valid ? "Deck ist spielbereit." : "Vervollständige dein 24-Karten-Deck.")}</p>
        <button type="button" className="bw-gold-button" disabled={saving || !validation.valid} onClick={saveDeck}>{saving ? "Speichert …" : "Deck speichern"}</button>
      </div>

      <EmeraldWorldNav active="cards"/>
    </div>
  </main>;
}
