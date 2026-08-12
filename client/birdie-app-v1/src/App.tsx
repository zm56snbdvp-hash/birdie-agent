import { useEffect, useMemo, useState } from "react";
import { sandboxAdapter, type BallPassportDto, type PersonalBirdieReplyDto, type RoundDetailDto, type RoundSummaryDto } from "./appAdapter";
import { formatRoundDetail } from "./roundDetail";
import { ThreeHotelScene } from "./ThreeHotelScene";

const birdieId = "BIRDIE-SANDBOX-001";

export default function App() {
  const [rounds, setRounds] = useState<RoundSummaryDto[]>([]);
  const [selectedRound, setSelectedRound] = useState<RoundDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [passports, setPassports] = useState<BallPassportDto[]>([]);
  const [selectedPassport, setSelectedPassport] = useState<BallPassportDto | null>(null);
  const [birdieMessage, setBirdieMessage] = useState("Tell me about my golf story");
  const [birdieReply, setBirdieReply] = useState<PersonalBirdieReplyDto | null>(null);
  const [birdieLoading, setBirdieLoading] = useState(false);

  useEffect(() => {
    sandboxAdapter.getGolfHistory(birdieId).then(setRounds);
    sandboxAdapter.getOwnedBallPassports(birdieId).then(setPassports);
  }, []);

  const detail = useMemo(() => (selectedRound ? formatRoundDetail(selectedRound) : null), [selectedRound]);

  async function openRound(roundId: string) {
    setDetailLoading(true);
    try { setSelectedRound(await sandboxAdapter.getRoundDetail(roundId, birdieId)); }
    finally { setDetailLoading(false); }
  }

  async function openPassport(objectId: string) {
    setSelectedPassport(await sandboxAdapter.getBallPassport(objectId, birdieId));
  }

  async function askBirdie() {
    if (!birdieMessage.trim()) return;
    setBirdieLoading(true);
    try { setBirdieReply(await sandboxAdapter.chatWithPersonalBirdie(birdieId, birdieMessage)); }
    finally { setBirdieLoading(false); }
  }

  return (
    <main className="app-shell">
      <section className="hero"><div><p className="eyebrow">Birdie App V1 · Sandbox</p><h1>Welcome home, golfer.</h1><p className="lede">The hotel hub runs on an engine-neutral Birdie core.</p></div><div className="avatar" aria-label="Avatar preset">B</div></section>
      <ThreeHotelScene />

      <section className="hotspots">
        <article className="panel golf-history">
          <p className="eyebrow">Hotspot 01</p><h2>Golf History</h2>
          {rounds.length === 0 ? <p>No sandbox rounds yet.</p> : rounds.map((round) => <button className="round" key={round.roundId} onClick={() => openRound(round.roundId)}><strong>{round.courseRef ?? "Course not provided"}</strong><span>{round.totals.strokes} strokes · {round.totals.scoredHoles}/{round.holeCount} holes</span><small>{round.contractVersion} · {round.status}</small></button>)}
          {detailLoading && <p className="detail-state">Loading round detail…</p>}
          {detail && !detailLoading && <section className="round-detail" aria-label="Round detail"><div className="detail-heading"><div><p className="eyebrow">Round Detail</p><h3>{detail.title}</h3><p>{detail.meta}</p></div><button className="close-detail" onClick={() => setSelectedRound(null)}>Close</button></div><div className="detail-meta"><span>{selectedRound?.courseDataMode}</span><span>{detail.privacy}</span></div><div className="holes">{detail.holes.map((hole) => <div className="hole" key={hole.holeNumber}><strong>Hole {hole.holeNumber}</strong><span>{hole.strokes ?? "—"} strokes</span><small>Putts {hole.putts ?? "—"} · Penalties {hole.penalties ?? "—"}</small></div>)}</div></section>}
        </article>

        <article className="panel ball-vault">
          <p className="eyebrow">Hotspot 02</p><h2>Ball Vault</h2>
          {passports.length === 0 ? <p>No owned sandbox balls yet.</p> : passports.map((passport) => <button className="passport-card" key={passport.objectId} onClick={() => openPassport(passport.objectId)}><div className="ball-orb" aria-hidden="true">B</div><div><strong>{passport.displayName}</strong><span>{passport.editionId ?? "Edition not provided"} · {passport.rarity ?? "Rarity not provided"}</span><small>{passport.state} · {passport.privacySafeStats.holesSurvived} holes survived</small></div></button>)}
          {selectedPassport && <section className="passport-detail" aria-label="Ball Passport detail"><div className="detail-heading"><div><p className="eyebrow">Living Ball Passport</p><h3>{selectedPassport.displayName}</h3><p>{selectedPassport.objectId}</p></div><button className="close-detail" onClick={() => setSelectedPassport(null)}>Close</button></div><div className="passport-stats"><span>{selectedPassport.privacySafeStats.rounds} rounds</span><span>{selectedPassport.privacySafeStats.courses} courses</span><span>{selectedPassport.privacySafeStats.birdiesWitnessed} birdies</span><span>{selectedPassport.privacySafeStats.holesSurvived} holes</span></div><div className="journey">{selectedPassport.journey.map((event) => <div className="journey-event" key={event.eventId}><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.courseName ?? "Private journey event"}</span><small>{event.locationLabel ?? event.privacyClass} · {event.occurredAt.slice(0, 10)}</small></div>)}</div></section>}
        </article>

        <article className="panel personal-birdie">
          <p className="eyebrow">Hotspot 03</p><h2>Personal Birdie</h2>
          <p className="birdie-boundary">Sandbox companion · your golf data only</p>
          <label className="birdie-input"><span>Ask Birdie</span><textarea value={birdieMessage} onChange={(event) => setBirdieMessage(event.target.value)} rows={4} /></label>
          <button className="ask-birdie" onClick={askBirdie} disabled={birdieLoading}>{birdieLoading ? "Thinking…" : "Ask Personal Birdie"}</button>
          {birdieReply && <div className={`birdie-reply ${birdieReply.refused ? "refused" : ""}`}><strong>{birdieReply.refused ? "Access boundary" : "Personal Birdie"}</strong><p>{birdieReply.reply}</p><small>{birdieReply.mode} · {birdieReply.contractVersion}</small></div>}
          <details className="birdie-scope"><summary>What Birdie can access</summary><p>Your profile, own rounds/stats, owned Ball Passports, achievements, preferences and approved public Birdie content. Internal company operations remain inaccessible.</p></details>
        </article>
      </section>
    </main>
  );
}
