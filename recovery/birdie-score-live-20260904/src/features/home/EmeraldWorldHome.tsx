import React from "react";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { EmeraldWorldNav } from "../../components/EmeraldWorldNav";

export interface EmeraldWorldHomeProps {
  playerName: string;
  coinBalance?: number | null;
  currentCourse?: { name: string; holeLabel?: string; parLabel?: string } | null;
  collection?: { owned: number; total: number } | null;
}

export function EmeraldWorldHome({ playerName, coinBalance, currentCourse, collection }: EmeraldWorldHomeProps) {
  const collectionLabel = collection ? `${collection.owned}/${collection.total}` : "—";
  return <main className="bw-world min-h-dvh text-foreground" data-design-pass="emerald-world-pass-02" data-authority="presentation-only">
    <EmeraldWorldSkin/>
    <div className="bw-page safe-page">
      <header className="bw-topbar">
        <div className="bw-brand">BIRDIEWORLD<small>PLAY · COLLECT · IMPROVE</small></div>
        {coinBalance == null ? <span className="bw-note">Deine Welt</span> : <span className="bw-coin" aria-label={`${coinBalance} Birdie Coins`}>● <strong>{coinBalance}</strong> Coins</span>}
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">Willkommen zurück, {playerName}</p>
        <h1 className="bw-title">Deine Runde beginnt hier.</h1>
        <p className="bw-copy">Golf, Karten, Fortschritt und Booster gehören sichtbar in dieselbe Emerald-Welt. Weniger Dashboard. Mehr Eintritt in einen eigenen Ort.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="bw-gold-button" href="/spiel">Jetzt spielen</a>
          <a className="bw-emerald-button" href="/scorecard">Scorecard öffnen</a>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <a href="/spiel" className="bw-panel block p-6 no-underline text-inherit">
          <p className="bw-kicker">Nächste Bahn</p>
          <h2 className="mt-2 font-serif text-3xl">{currentCourse?.name ?? "BirdieWorld Course"}</h2>
          <p className="mt-3 text-sm text-moss">{[currentCourse?.holeLabel, currentCourse?.parLabel].filter(Boolean).join(" · ") || "Weiter in deine Golfwelt"}</p>
          <span className="mt-6 inline-flex text-sm font-bold text-gold-soft">Spielen →</span>
        </a>

        <a href="/karten" className="bw-panel block p-6 no-underline text-inherit">
          <p className="bw-kicker">The Nest</p>
          <h2 className="mt-2 font-serif text-3xl">Deine Sammlung</h2>
          <p className="mt-3 text-sm text-moss"><strong className="text-gold-soft">{collectionLabel}</strong> Karten im aktuellen Snapshot</p>
          <span className="mt-6 inline-flex text-sm font-bold text-gold-soft">Sammlung öffnen →</span>
        </a>

        <a href="/fortschritt" className="bw-panel block p-6 no-underline text-inherit">
          <p className="bw-kicker">Deine Entwicklung</p>
          <h2 className="mt-2 font-serif text-3xl">Fortschritt</h2>
          <p className="mt-3 text-sm text-moss">Runden, Bestwerte und Meilensteine bekommen dieselbe ruhige Emerald-Sprache.</p>
          <span className="mt-6 inline-flex text-sm font-bold text-gold-soft">Fortschritt ansehen →</span>
        </a>

        <a href="/deck" className="bw-panel block p-6 no-underline text-inherit">
          <p className="bw-kicker">Vorbereitung</p>
          <h2 className="mt-2 font-serif text-3xl">Deck Lab</h2>
          <p className="mt-3 text-sm text-moss">Stelle dein Loadout zusammen, ohne die Welt für ein Technikformular zu verlassen.</p>
          <span className="mt-6 inline-flex text-sm font-bold text-gold-soft">Deck bearbeiten →</span>
        </a>
      </section>

      <EmeraldWorldNav active="home"/>
    </div>
  </main>;
}
