import React, { useMemo, useState } from "react";
import type { CanonicalCard } from "../../domain/card-catalog";
import { STARTER_DECK } from "../../domain/starter-deck";
import { CardArtwork } from "../../components/CardArtwork";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { applyBoosterOpening, applyStarterSet, collectionPercent, ownedCollection, playableCollection, type BoosterOpening, type BoosterOpenResponse } from "./model";

export interface CardVaultProps {
  cards: CanonicalCard[]; initialBalance: number; initialOwnedCardIds: string[]; priceCoins: number; initialStarterClaimed: boolean;
}

function CardTile({ card }: { card: CanonicalCard }) {
  return <article className="bw-card">
    <CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative className="rounded-none"/>
    <div className="border-t border-white/10 p-3">
      <div className="bw-card-meta flex justify-between"><span>{card.family}</span><span>{card.physicalNumber}</span></div>
      <h3 className="mt-2 font-semibold">{card.name}</h3>
      <p className="mt-1.5 text-xs leading-5 text-moss">{String(card.rulesText ?? "")}</p>
    </div>
  </article>;
}

export function CardVault({ cards, initialBalance, initialOwnedCardIds, priceCoins, initialStarterClaimed }: CardVaultProps) {
  const [tab, setTab] = useState<"collection" | "booster">("collection");
  const [balance, setBalance] = useState(initialBalance);
  const [ownedIds, setOwnedIds] = useState(() => new Set(initialOwnedCardIds));
  const [opening, setOpening] = useState<BoosterOpening | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [openingBooster, setOpeningBooster] = useState(false);
  const [boosterError, setBoosterError] = useState<string | null>(null);
  const [starterClaimed, setStarterClaimed] = useState(initialStarterClaimed);
  const [claimingStarter, setClaimingStarter] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const collectibleCards = useMemo(() => playableCollection(cards), [cards]);
  const ownedCards = useMemo(() => ownedCollection(cards, ownedIds), [cards, ownedIds]);
  const percent = collectionPercent(ownedCards.length, collectibleCards.length);
  const missingCoins = Math.max(0, priceCoins - balance);

  async function claimStarterSet() {
    if (claimingStarter || starterClaimed) return;
    setClaimingStarter(true); setStarterError(null);
    try {
      const response = await fetch("/api/starter-set/claim", { method: "POST" }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Das Starter Set konnte nicht gesichert werden.");
      setStarterClaimed(true); setOwnedIds((current) => applyStarterSet(current));
    } catch (error) { setStarterError(error instanceof Error ? error.message : "Das Starter Set konnte nicht gesichert werden."); }
    finally { setClaimingStarter(false); }
  }

  async function openBooster() {
    if (openingBooster || balance < priceCoins) return;
    setOpeningBooster(true); setBoosterError(null);
    try {
      const response = await fetch("/api/boosters/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      const body: BoosterOpenResponse = await response.json();
      if (!response.ok || !body.opening) throw new Error(body.error ?? "Der Booster konnte nicht geöffnet werden.");
      setOpening(body.opening); setRevealCount(0); setBalance(body.opening.balanceAfter); setOwnedIds((current) => applyBoosterOpening(current, body.opening!));
    } catch (error) { setBoosterError(error instanceof Error ? error.message : "Der Booster konnte nicht geöffnet werden."); }
    finally { setOpeningBooster(false); }
  }

  return <main className="bw-world score-shell min-h-dvh overflow-x-hidden text-foreground" data-design-pass="emerald-world-pass-01">
    <EmeraldWorldSkin/>
    <div className="bw-page safe-page">
      <header className="bw-topbar">
        <a href="/" className="bw-brand">BIRDIEWORLD<small>PLAY · COLLECT · IMPROVE</small></a>
        <span className="bw-coin" aria-label={`${balance} Birdie Coins`}>● <strong>{balance}</strong> Coins</span>
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">First Edition · Deine Sammlung</p>
        <h1 className="bw-title">The Nest</h1>
        <p className="bw-copy">Deine Karten gehören jetzt sichtbar in dieselbe Welt wie die neuen Golfbahnen: tiefes Emerald, dunkle Schluchten und Gold nur dort, wo etwas Bedeutung hat. Ungültiges Artwork bleibt fail-safe und wird als kanonische Textkarte gezeigt.</p>
      </section>

      <nav className="bw-segment mt-6" aria-label="Kartenbereich">
        <button type="button" onClick={() => setTab("collection")} aria-pressed={tab === "collection"}>Sammlung</button>
        <button type="button" onClick={() => setTab("booster")} aria-pressed={tab === "booster"}>Booster</button>
      </nav>

      {tab === "collection" ? <section className="mt-7">
        <div className="bw-panel mb-5 p-5 sm:p-7">
          <p className="bw-kicker">Dein Einstieg ins Spiel</p>
          <h2 className="mt-2 text-2xl font-semibold">{STARTER_DECK.name}</h2>
          <p className="mt-2 text-sm leading-6 text-moss">1 Spieler · 4 Schläger · 3 Bälle · 17 einzigartige Aktionskarten.</p>
          <button type="button" disabled={claimingStarter || starterClaimed} onClick={claimStarterSet} className="bw-gold-button mt-5">
            {starterClaimed ? "Starter Set gesichert" : claimingStarter ? "Starter Set wird gesichert …" : starterError ? "Erneut versuchen" : "Starter Set sichern"}
          </button>
          {starterError && <p role="alert" className="mt-3 text-sm text-destructive">{starterError}</p>}
        </div>

        <div className="bw-panel p-5 sm:p-7">
          <div className="flex items-end justify-between gap-3">
            <div><p className="bw-kicker">Collection progress</p><h2 className="mt-2 text-2xl font-semibold">{ownedCards.length} von {collectibleCards.length} Karten</h2></div>
            <strong className="text-gold-soft">{percent}%</strong>
          </div>
          <div className="bw-progress mt-4" aria-label={`${percent}% der Sammlung freigeschaltet`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${percent}%` }}/>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">{ownedCards.map((card) => <CardTile key={card.id} card={card}/>)}</div>
        </div>
      </section> : <section className="mt-7 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
        <div className="bw-panel p-5 sm:p-7">
          <div className="bw-booster-stage">
            <CardArtwork back name="Verdeckte First-Edition-Karte" decorative className="h-44 w-28"/>
          </div>
          <p className="bw-kicker mt-7">Digitaler Booster</p>
          <h2 className="mt-2 text-3xl font-semibold">1. Edition · 3 Karten</h2>
          <p className="mt-3 text-sm leading-6 text-moss">Neue Karten werden deiner Sammlung zugeordnet. Doppelte Karten werden serverseitig in Birdie Coins umgewandelt.</p>
          <div className="mt-6 flex justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
            <span>Launch-Beta-Preis</span><strong className="text-gold-soft">{priceCoins} Coins</strong>
          </div>
          <button type="button" disabled={openingBooster || balance < priceCoins} onClick={openBooster} className="bw-emerald-button mt-5 w-full">
            {openingBooster ? "Booster wird geöffnet …" : "3er-Booster öffnen"}
          </button>
          {missingCoins > 0 && <p className="mt-3 text-sm text-moss">Dir fehlen noch {missingCoins} Birdie Coins.</p>}
          {boosterError && <p role="alert" className="mt-3 text-sm text-destructive">{boosterError}</p>}
        </div>

        <div className="bw-panel p-5 sm:p-7">
          <p className="bw-kicker">Booster Reveal</p>
          <h2 className="mt-2 text-2xl font-semibold">Drei Karten. Eine Enthüllung.</h2>
          {!opening ? <p className="mt-5 text-sm text-moss">Öffne einen Booster, um drei Karten aufzudecken.</p> : <>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">{opening.cards.map((entry, index) => {
              const revealed = index < revealCount; const active = index === revealCount;
              return revealed ? <div key={entry.slot}>
                <CardTile card={entry.card}/>
                <p className="mt-2 text-center text-xs text-gold-soft">{entry.outcome === "new" ? "Neu in deiner Sammlung" : `Duplikat · +${entry.coinsAwarded} Coins`}</p>
              </div> : <button key={entry.slot} type="button" disabled={!active} onClick={() => setRevealCount(index + 1)} className="bw-card p-3 disabled:opacity-50">
                <CardArtwork back name={`Karte ${index + 1}`} decorative/>
                <span className="mt-3 block text-xs text-gold-soft">{active ? `Karte ${index + 1} aufdecken` : `Karte ${index + 1} wartet`}</span>
              </button>;
            })}</div>
            <button type="button" className="bw-gold-button mt-5" onClick={() => setRevealCount(opening.cards.length)} disabled={revealCount === opening.cards.length}>Alle aufdecken</button>
          </>}
        </div>
      </section>}
    </div>
  </main>;
}
