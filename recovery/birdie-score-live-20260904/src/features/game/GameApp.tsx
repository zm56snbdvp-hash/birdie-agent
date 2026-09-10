import React, { useMemo, useState } from "react";
import type { CanonicalCard } from "../../domain/card-catalog";
import { CARD_BY_ID } from "../../domain/card-catalog";
import { CardArtwork } from "../../components/CardArtwork";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { createInitialGameCardState, drawAtHoleStart, type GameCardState } from "./card-state";

import { CourseScene } from "./CourseScene";
import { COURSE_HOLES } from "./shot-engine";
import type { CourseShot } from "./course-flight";

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
 * This pass changes presentation only. Card draw, installed equipment, hole
 * progression and course-shot authority remain exactly where they were.
 */
export function GameApp({ loadout, courseShot }: { loadout: RecoveredGameLoadout; courseShot?: CourseShot }) {
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

  return <main className="bw-world min-h-screen text-[#f5ecd5]" data-recovery-status="CARD_LAYER_RECOVERED" data-design-pass="emerald-world-pass-01">
    <EmeraldWorldSkin/>
    <div className="bw-page">
      <header className="bw-topbar">
        <div className="bw-brand">BIRDIEWORLD<small>PLAY · COLLECT · IMPROVE</small></div>
        <div className="text-right"><strong className="text-gold-soft">Loch {hole}/6</strong><p className="bw-note mt-1">{message}</p></div>
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">Jeder Schlag zählt</p>
        <h1 className="bw-title text-5xl">{COURSE_HOLES[hole - 1]?.name ?? "Emerald Course"}</h1>
        <p className="bw-copy">Die Landschaft ist nicht mehr Kulisse. Sie ist die Bühne für deinen Schlag, deine Karten und das Ergebnis.</p>
      </section>

      <CourseScene hole={COURSE_HOLES[hole - 1]} shot={courseShot}/>

      <section className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <aside className="bw-panel p-4">
          <p className="bw-kicker">Spieler</p>
          <CardArtwork id={loadout.player.id} physicalNumber={loadout.player.physicalNumber} name={loadout.player.name} className="mt-3"/>
          <h1 className="mt-3 font-serif text-xl">{loadout.playerName}</h1>
          <p className="text-xs text-moss">{loadout.deckName}</p>
        </aside>

        <div className="grid gap-5">
          <section className="bw-panel p-4">
            <div className="flex items-center justify-between"><div><p className="bw-kicker">Equipment</p><h2 className="mt-1 font-semibold">Aktives Bag</h2></div><span className="text-xs text-moss">{installedClubs.length} Schläger · {installedBalls.length} Bälle</span></div>
            <div className="bw-game-card-strip mt-4">{[...installedClubs, ...installedBalls].map((card) => <div className="bw-card p-2" key={card.id}><CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative/><p className="mt-2 truncate text-xs">{card.name}</p></div>)}</div>
          </section>

          <section className="bw-panel p-4">
            <div className="flex items-center justify-between"><div><p className="bw-kicker">Deine Optionen</p><h2 className="mt-1 font-semibold">Aktionshand</h2></div><span className="text-xs text-moss">{hand.length} Karten</span></div>
            <div className="bw-game-card-strip mt-4">{hand.map((card) => <div className="bw-card p-2" key={card.id}><CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative/><p className="mt-2 truncate text-xs">{card.name}</p></div>)}</div>
          </section>

          <div className="flex justify-end">
            <button type="button" onClick={drawForNextHole} disabled={hole >= 6} className="bw-gold-button">{hole >= 6 ? "Loch 6 erreicht" : "Nächstes Loch · Draw"}</button>
          </div>
        </div>
      </section>
    </div>
  </main>;
}
