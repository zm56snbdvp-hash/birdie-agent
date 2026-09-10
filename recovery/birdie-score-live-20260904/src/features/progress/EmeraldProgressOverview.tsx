import React from "react";
import { EmeraldWorldSkin } from "../../components/EmeraldWorldSkin";
import { EmeraldWorldNav } from "../../components/EmeraldWorldNav";

export interface EmeraldProgressMetric {
  label: string;
  value: string | number;
  detail?: string;
}

export interface EmeraldProgressMilestone {
  title: string;
  detail?: string;
}

export interface EmeraldProgressOverviewProps {
  playerName: string;
  metrics: readonly EmeraldProgressMetric[];
  milestones?: readonly EmeraldProgressMilestone[];
}

export function EmeraldProgressOverview({ playerName, metrics, milestones = [] }: EmeraldProgressOverviewProps) {
  return <main className="bw-world min-h-dvh text-foreground" data-design-pass="emerald-world-pass-02" data-authority="presentation-only">
    <EmeraldWorldSkin/>
    <div className="bw-page safe-page">
      <header className="bw-topbar">
        <a href="/" className="bw-brand">BIRDIEWORLD<small>YOUR GAME · YOUR STORY</small></a>
        <span className="bw-note">{playerName}</span>
      </header>

      <section className="bw-hero">
        <p className="bw-kicker">Deine Entwicklung</p>
        <h1 className="bw-title">Fortschritt, der nach Golf aussieht.</h1>
        <p className="bw-copy">Keine nüchterne Zahlenwand. Deine Werte bleiben klar lesbar, liegen aber auf denselben tiefen Emerald-Flächen und feinen Goldlinien wie die neuen Golfbahnen.</p>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Fortschrittswerte">
        {metrics.map((metric) => <article key={metric.label} className="bw-panel p-5">
          <p className="bw-kicker">{metric.label}</p>
          <strong className="mt-3 block font-serif text-4xl text-[#fff1d1]">{metric.value}</strong>
          {metric.detail ? <p className="mt-2 text-sm leading-6 text-moss">{metric.detail}</p> : null}
        </article>)}
      </section>

      {milestones.length ? <section className="bw-panel mt-5 p-5 sm:p-6">
        <p className="bw-kicker">Meilensteine</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {milestones.map((milestone) => <article key={milestone.title} className="bw-card p-4">
            <strong className="block text-gold-soft">{milestone.title}</strong>
            {milestone.detail ? <p className="mt-2 text-xs leading-5 text-moss">{milestone.detail}</p> : null}
          </article>)}
        </div>
      </section> : null}

      <p className="bw-note mt-4">Diese Oberfläche zeigt nur Werte, die der Host übergibt. Sie erzeugt keine Scores, Coins, Badges oder Fortschrittsereignisse.</p>
      <EmeraldWorldNav active="progress"/>
    </div>
  </main>;
}
