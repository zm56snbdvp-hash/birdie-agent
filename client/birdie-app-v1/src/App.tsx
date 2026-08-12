import { useEffect, useState } from "react";
import { sandboxAdapter, type RoundSummaryDto } from "./appAdapter";

const birdieId = "BIRDIE-SANDBOX-001";

export default function App() {
  const [rounds, setRounds] = useState<RoundSummaryDto[]>([]);

  useEffect(() => {
    sandboxAdapter.getGolfHistory(birdieId).then(setRounds);
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Birdie App V1 · Sandbox</p>
          <h1>Welcome home, golfer.</h1>
          <p className="lede">The hotel hub is being rebuilt on an engine-neutral Birdie core.</p>
        </div>
        <div className="avatar" aria-label="Avatar preset">B</div>
      </section>

      <section className="hotel" aria-label="Birdie and Breakfast hotel exterior">
        <div className="hotel-sign">Birdie &amp; Breakfast</div>
        <div className="doors">Hotel Hub</div>
      </section>

      <section className="hotspots">
        <article className="panel">
          <p className="eyebrow">Hotspot 01</p>
          <h2>Golf History</h2>
          {rounds.length === 0 ? <p>No sandbox rounds yet.</p> : rounds.map((round) => (
            <div className="round" key={round.roundId}>
              <strong>{round.courseRef ?? "Course not provided"}</strong>
              <span>{round.totals.strokes} strokes · {round.totals.scoredHoles}/{round.holeCount} holes</span>
              <small>{round.contractVersion} · {round.status}</small>
            </div>
          ))}
        </article>

        <article className="panel muted">
          <p className="eyebrow">Hotspot 02</p>
          <h2>Ball Vault</h2>
          <p>Ball Passport adapter comes next.</p>
        </article>

        <article className="panel muted">
          <p className="eyebrow">Hotspot 03</p>
          <h2>Personal Birdie</h2>
          <p>Isolated user-agent gateway remains sandbox-only.</p>
        </article>
      </section>
    </main>
  );
}
