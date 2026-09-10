import React from "react";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { EmeraldWorldNav } from "../../components/EmeraldWorldNav";

export type EmeraldScorecardSaveState = "idle" | "saving" | "saved" | "error";

export interface EmeraldScorecardFrameProps {
  courseName: string;
  holeNumber: number;
  holeCount: number;
  par?: number | null;
  saveState?: EmeraldScorecardSaveState;
  children: React.ReactNode;
}

const SAVE_LABEL: Record<EmeraldScorecardSaveState, string> = {
  idle: "Nicht gespeichert",
  saving: "Speichert …",
  saved: "Gespeichert",
  error: "Speicherfehler",
};

export function EmeraldScorecardFrame({ courseName, holeNumber, holeCount, par, saveState = "idle", children }: EmeraldScorecardFrameProps) {
  return <main className="bw-world min-h-dvh text-foreground" data-design-pass="emerald-world-pass-02" data-authority="presentation-only-scorecard-frame">
    <EmeraldWorldSkin/>
    <div className="bw-page safe-page">
      <header className="bw-topbar">
        <a href="/" className="bw-brand">BIRDIEWORLD<small>REAL GOLF · SCORECARD</small></a>
        <span className="bw-coin" role="status" aria-live="polite">{SAVE_LABEL[saveState]}</span>
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">Deine echte Runde</p>
        <h1 className="bw-title">{courseName}</h1>
        <p className="bw-copy">Loch {holeNumber} von {holeCount}{par == null ? "" : ` · Par ${par}`}. Die Eingabe bleibt schnell und sachlich, aber sie verlässt visuell nicht mehr die BirdieWorld.</p>
      </section>

      <section className="bw-panel mt-6 p-4 sm:p-6" aria-label="Scorecard Eingabebereich">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div><p className="bw-kicker">Aktuelles Loch</p><strong className="mt-1 block font-serif text-3xl">{holeNumber} / {holeCount}</strong></div>
          {par == null ? null : <span className="bw-status-chip">Par {par}</span>}
        </div>
        <div data-scorecard-slot="existing-scorecard-controls">{children}</div>
      </section>

      <p className="bw-note mt-4">Dieser Frame verändert keine Schlag-, Speicher- oder Rundendaten. Er umschließt ausschließlich vorhandene Scorecard-Controls.</p>
      <EmeraldWorldNav active="scorecard"/>
    </div>
  </main>;
}
