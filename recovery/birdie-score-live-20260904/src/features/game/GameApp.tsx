import React, { useMemo, useState } from "react";
import type { CanonicalCard } from "../../domain/card-catalog";
import { CARD_BY_ID } from "../../domain/card-catalog";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { EmeraldWorldPass04Skin } from "../../components/EmeraldWorldPass04Skin";
import { EmeraldWorldPass05Skin } from "../../components/EmeraldWorldPass05Skin";
import { EmeraldWorldNav } from "../../components/EmeraldWorldNav";
import { EmeraldCardFrame } from "../../components/EmeraldCardFrame";
import { EmeraldCourseHud } from "../../components/EmeraldCourseHud";
import { EmeraldShotAtmosphere, useEmeraldShotPhase } from "../../components/EmeraldShotMotion";
import { createInitialGameCardState, drawAtHoleStart, type GameCardState } from "./card-state";
import { CourseScene } from "./CourseScene";
import { COURSE_HOLES } from "./shot-engine";
import type { CourseShot } from "./course-flight";
import type { EmeraldPresentation } from "./emerald-presentation";

export interface RecoveredGameLoadout {
  playerCardId: string; playerName: string; deckName: string; player: CanonicalCard;
  clubs: CanonicalCard[]; balls: CanonicalCard[]; actions: CanonicalCard[];
}
function cardsFromIds(ids: readonly string[]): CanonicalCard[] {
  return ids.map(id => CARD_BY_ID.get(id)).filter(Boolean) as CanonicalCard[];
}
/** Recovered card layer, not a replacement for the missing original live host. */
export function GameApp({ loadout, courseShot }: { loadout: RecoveredGameLoadout; courseShot?: CourseShot }) {
  const [cardState, setCardState] = useState<GameCardState>(() => createInitialGameCardState(loadout));
  const [hole, setHole] = useState(1);
  const [message, setMessage] = useState("Equipment liegt · 5er-Starthand bereit");
  const [presentation, setPresentation] = useState<EmeraldPresentation | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const installedClubs = useMemo(() => cardsFromIds(cardState.installedClubIds), [cardState]);
  const installedBalls = useMemo(() => cardsFromIds(cardState.installedBallIds), [cardState]);
  const hand = useMemo(() => cardsFromIds(cardState.handIds), [cardState]);
  const activeHole = COURSE_HOLES[hole - 1];
  const visibleShot = courseShot?.holeId === activeHole?.id ? courseShot : undefined;
  const shotPhase = useEmeraldShotPhase(visibleShot, presentation);
  const currentPresentation = presentation?.source === visibleShot && presentation?.holeId === activeHole.id;

  // Existing draw resolution and six-hole limit are preserved.
  function drawForNextHole() {
    if (hole >= 6) return;
    setCardState(current => {
      const next: GameCardState = {
        drawPileIds: [...current.drawPileIds], handIds: [...current.handIds],
        installedClubIds: [...current.installedClubIds], installedBallIds: [...current.installedBallIds],
        discardIds: [...current.discardIds],
      };
      const resolution = drawAtHoleStart(next);
      const drawnAction = resolution.actionIds[0] ? CARD_BY_ID.get(resolution.actionIds[0]) : null;
      const installed = [...resolution.installedClubIds.map(id => CARD_BY_ID.get(id)?.name),
        ...resolution.installedBallIds.map(id => CARD_BY_ID.get(id)?.name)].filter(Boolean);
      setMessage(drawnAction ? `Loch ${hole + 1} · ${drawnAction.name} gezogen` : installed.length
        ? `Loch ${hole + 1} · Equipment installiert: ${installed.join(", ")}` : `Loch ${hole + 1} · kein weiterer Draw`);
      return next;
    });
    setHole(value => Math.min(6, value + 1));
  }
  return <main className="bw-world min-h-screen" data-recovery-status="CARD_LAYER_RECOVERED" data-design-pass="emerald-world-pass-06">
    <EmeraldWorldSkin/><EmeraldWorldPass04Skin/><EmeraldWorldPass05Skin/>
    <div className="bw-page">
      <header className="bw-topbar">
        <div className="bw-brand">BIRDIEWORLD<small>GOLF · KARTEN · EMERALD WORLD</small></div>
        <span className="bw-note">{loadout.playerName} · {loadout.deckName}</span>
      </header>
      <section className="bw-play-world" data-shot-phase={shotPhase}
        data-motion-paused={currentPresentation && presentation?.paused ? "true" : "false"}
        data-reduced-motion={reducedMotion || (currentPresentation && presentation?.reducedMotion) ? "true" : "false"}>
        <EmeraldCourseHud hole={hole} totalHoles={6} courseName={activeHole.name} message={message}
          resultLabel={shotPhase === "result" ? visibleShot?.result.label : presentation?.paused ? "PAUSIERT" : null}/>
        <div className="bw-course-stage">
          <CourseScene hole={activeHole} shot={visibleShot} reducedMotion={reducedMotion} onPresentationChange={setPresentation}/>
          <EmeraldShotAtmosphere phase={shotPhase}/>
          {visibleShot && shotPhase === "result" && <div className="bw-result-rift" key={visibleShot.id}>
            <span>SCHLAGERGEBNIS</span><strong>{visibleShot.result.label}</strong><small>{visibleShot.result.detail}</small>
          </div>}
        </div>
        <div className="bw-floating-hand">
          <div className="bw-floating-hand-label"><span>AKTIONSHAND</span><strong>{hand.length}</strong></div>
          <div className="bw-floating-hand-cards" role="region" aria-label="Aktionshand, horizontal scrollbar" tabIndex={0}>
            {hand.map(card => <div key={card.id} className="bw-floating-card">
              <EmeraldCardFrame card={card} compact/>
              <details className="bw-hand-rules"><summary>Regel ansehen</summary><p>{String(card.rulesText ?? "Keine weitere Regel hinterlegt.")}</p></details>
            </div>)}
          </div>
        </div>
      </section>
      <section className="bw-loadout-vein">
        <details><summary>Spieler & aktives Bag · {installedClubs.length} Schläger · {installedBalls.length} Bälle</summary>
          <div className="bw-game-card-strip">
            <EmeraldCardFrame card={loadout.player} compact/>
            {[...installedClubs, ...installedBalls].map(card => <EmeraldCardFrame key={card.id} card={card} compact/>)}
          </div>
        </details>
        <div className="bw-play-options">
          <label><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)}/> Weniger Bewegung</label>
          <button type="button" onClick={drawForNextHole} disabled={hole >= 6} className="bw-gold-button">
            {hole >= 6 ? "Loch 6 erreicht" : "Nächstes Loch · Draw"}
          </button>
        </div>
      </section>
      <EmeraldWorldNav active="play"/>
    </div>
  </main>;
}
