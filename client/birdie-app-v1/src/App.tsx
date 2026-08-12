import { useEffect, useMemo, useState } from "react";
import { sandboxAdapter, type RoundDetailDto, type RoundSummaryDto } from "./appAdapter";
import { formatRoundDetail } from "./roundDetail";

const birdieId = "BIRDIE-SANDBOX-001";

export default function App() {
  const [rounds, setRounds] = useState<RoundSummaryDto[]>([]);
  const [selectedRound, setSelectedRound] = useState<RoundDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    sandboxAdapter.getGolfHistory(birdieId).then(setRounds);
  }, []);

  const detail = useMemo(
    () => (selectedRound ? formatRoundDetail(selectedRound) : null),
    [selectedRound]
  );

  async function openRound(roundId: string) {
    setDetailLoading(true);
    try {
      setSelectedRound(await sandboxAdapter.getRoundDetail(roundId, birdieId));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Birdie App V1 · Sandbox</p>
          <h1>Welcome home, golfer.</h1>
          <p className="lede">The hotel hub runs on an engine-neutral Birdie core.</p>
        </div>
        <div className="avatar" aria-label="Avatar preset">B</div>
      </section>

      <section className="hotel" aria-label="Birdie and Breakfast hotel exterior">
        <div className="hotel-sign">Birdie &amp; Breakfast</div>
        <div className="doors">Hotel Hub</div>
      </section>

      <section className="hotspots">
        <article className="panel golf-history">
          <p className="eyebrow">Hotspot 01</p>
          <h2>Golf History</h2>
          {rounds.length === 0 ? <p>No sandbox rounds yet.</p> : rounds.map((round) => (
            <button className="round" key={round.roundId} onClick={() => openRound(round.roundId)}>
              <strong>{round.courseRef ?? "Course not provided"}</strong>
              <span>{round.totals.strokes} strokes · {round.totals.scoredHoles}/{round.holeCount} holes</span>
              <small>{round.contractVersion} · {round.status}</small>
            </button>
          ))}

          {detailLoading && <p className="detail-state">Loading round detail…</p>}

          {detail && !detailLoading && (
            <section className="round-detail" aria-label="Round detail">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Round Detail</p>
                  <h3>{detail.title}</h3>
                  <p>{detail.meta}</p>
                </div>
                <button className="close-detail" onClick={() => setSelectedRound(null)}>Close</button>
              </div>
              <div className="detail-meta">
                <span>{selectedRound?.courseDataMode}</span>
                <span>{detail.privacy}</span>
              </div>
              <div className="holes">
                {detail.holes.map((hole) => (
                  <div className="hole" key={hole.holeNumber}>
                    <strong>Hole {hole.holeNumber}</strong>
                    <span>{hole.strokes ?? "—"} strokes</span>
                    <small>Putts {hole.putts ?? "—"} · Penalties {hole.penalties ?? "—"}</small>
                  </div>
                ))}
              </div>
            </section>
          )}
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
