import React, { useMemo, useState } from "react";
import type { CanonicalCard } from "../../domain/card-catalog";
import { CARD_BY_ID } from "../../domain/card-catalog";
import { CardArtwork } from "../../components/CardArtwork";
import { createInitialGameCardState, drawAtHoleStart, type GameCardState } from "./card-state";

export interface RecoveredGameLoadout {
  playerCardId: string;
  playerName: string;
  deckName: string;
  player: CanonicalCard;
  clubs: CanonicalCard[];
  balls: CanonicalCard[];
  actions: CanonicalCard[];
}

function cardsFromIds(ids: readonly string[]): CanonicalCard[] {
  return ids.map((id) => CARD_BY_ID.get(id)).filter(Boolean) as CanonicalCard[];
}

/**
 * Maintainable reconstruction of the deployed GameApp card layer.
 *
 * Proven/recovered here:
 * - equipment auto-installs when drawn;
 * - equipment immediately triggers a replacement draw;
 * - the opening action hand is filled to five;
 * - one resolved draw happens at hole start;
 * - every visible card uses the fail-safe CardArtwork component.
 *
 * The full shot simulator/physics UI is intentionally not claimed as fully
 * decompiled maintainable source in this checkpoint.
 */
export function GameApp({ loadout }: { loadout: RecoveredGameLoadout }) {
  const [cardState, setCardState] = useState<GameCardState>(() => createInitialGameCardState(loadout));
  const [hole, setHole] = useState(1);
  const [message, setMessage] = useState("Equipment liegt · 5er-Starthand bereit");

  const installedClubs = useMemo(() => cardsFromIds(cardState.installedClubIds), [cardState]);
  const installedBalls = useMemo(() => cardsFromIds(cardState.installedBallIds), [cardState]);
  const hand = useMemo(() => cardsFromIds(cardState.handIds), [cardState]);

  function drawForNextHole() {
    if (hole >= 6) return;
    setCardState((current) => {
      const next: GameCardState = {
        drawPileIds: [...current.drawPileIds],
        handIds: [...current.handIds],
        installedClubIds: [...current.installedClubIds],
        installedBallIds: [...current.installedBallIds],
        discardIds: [...current.discardIds],
      };
      const resolution = drawAtHoleStart(next);
      const drawnAction = resolution.actionIds[0] ? CARD_BY_ID.get(resolution.actionIds[0]) : null;
      const installed = [
        ...resolution.installedClubIds.map((id) => CARD_BY_ID.get(id)?.name),
        ...resolution.installedBallIds.map((id) => CARD_BY_ID.get(id)?.name),
      ].filter(Boolean);
      setMessage(drawnAction
        ? `Loch ${hole + 1} · ${drawnAction.name} gezogen`
        : installed.length
          ? `Loch ${hole + 1} · Equipment installiert: ${installed.join(", ")}`
          : `Loch ${hole + 1} · kein weiterer Draw`);
      return next;
    });
    setHole((value) => Math.min(6, value + 1));
  }

  return <main className="min-h-screen bg-[#030a07] p-4 text-[#f5ecd5]" data-recovery-status="CARD_LAYER_RECOVERED"><div className="mx-auto max-w-[1200px]">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#bea052]/20 pb-4"><div><p className="font-serif text-lg tracking-[.2em] text-[#dfc477]">BIRDIEWORLD</p><p className="text-xs text-[#8ea396]">First Edition · Recoverable Card Layer</p></div><div className="text-right"><strong>Loch {hole}/6</strong><p className="text-xs text-[#8ea396]">{message}</p></div></header>
    <section className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]"><aside className="panel rounded-2xl p-4"><p className="eyebrow">Spieler</p><CardArtwork id={loadout.player.id} physicalNumber={loadout.player.physicalNumber} name={loadout.player.name} className="mt-3"/><h1 className="mt-3 font-serif text-xl">{loadout.playerName}</h1><p className="text-xs text-moss">{loadout.deckName}</p></aside>
      <div className="grid gap-5"><section className="panel rounded-2xl p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Aktives Bag</h2><span className="text-xs text-moss">{installedClubs.length} Schläger · {installedBalls.length} Bälle</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[...installedClubs, ...installedBalls].map((card) => <div key={card.id}><CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative/><p className="mt-1 truncate text-xs">{card.name}</p></div>)}</div></section>
      <section className="panel rounded-2xl p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Aktionshand</h2><span className="text-xs text-moss">{hand.length} Karten</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{hand.map((card) => <div key={card.id}><CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative/><p className="mt-1 truncate text-xs">{card.name}</p></div>)}</div></section>
      <div className="flex justify-end"><button type="button" onClick={drawForNextHole} disabled={hole >= 6} className="gold-action min-h-12 rounded-xl px-5 text-ink disabled:opacity-50">{hole >= 6 ? "Loch 6 erreicht" : "Nächstes Loch · Draw"}</button></div></div>
    </section>
  </div></main>;
}
