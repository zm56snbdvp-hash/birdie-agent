import { useEffect, useMemo, useRef, useState } from "react";
import { sandboxAdapter, type BallPassportDto, type PersonalBirdieReplyDto, type RoundDetailDto, type RoundSummaryDto } from "./appAdapter";
import { formatRoundDetail } from "./roundDetail";
import { ThreeHotelScene } from "./ThreeHotelScene";
import { WorldAtmosphere, type WorldHotspotId } from "./WorldAtmosphere";
import { BirdieCompanion } from "./BirdieCompanion";
import { useBirdieWorldBridge } from "./useBirdieWorldBridge";

const birdieId = "BIRDIE-SANDBOX-001";

const linkedPanelStyle = {
  outline: "2px solid #c7a54a",
  outlineOffset: "3px",
  boxShadow: "0 14px 38px rgba(35,71,52,.12), 0 0 0 6px rgba(199,165,74,.08)"
};

export default function App() {
  const { worldContext, onSceneZoneChange } = useBirdieWorldBridge();
  const [rounds, setRounds] = useState<RoundSummaryDto[]>([]);
  const [selectedRound, setSelectedRound] = useState<RoundDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [passports, setPassports] = useState<BallPassportDto[]>([]);
  const [selectedPassport, setSelectedPassport] = useState<BallPassportDto | null>(null);
  const [birdieMessage, setBirdieMessage] = useState("Tell me about my golf story");
  const [birdieReply, setBirdieReply] = useState<PersonalBirdieReplyDto | null>(null);
  const [birdieLoading, setBirdieLoading] = useState(false);
  const [worldTarget, setWorldTarget] = useState<WorldHotspotId | null>(null);

  const golfHistoryRef = useRef<HTMLElement | null>(null);
  const ballVaultRef = useRef<HTMLElement | null>(null);
  const personalBirdieRef = useRef<HTMLElement | null>(null);

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

  function openWorldHotspot(hotspot: WorldHotspotId) {
    setWorldTarget(hotspot);
    const target = hotspot === "golf-history"
      ? golfHistoryRef.current
      : hotspot === "ball-vault"
        ? ballVaultRef.current
        : personalBirdieRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const worldTargetLabel = worldTarget === "golf-history"
    ? "Golf History linked"
    : worldTarget === "ball-vault"
      ? "Ball Vault linked"
      : worldTarget === "personal-birdie"
        ? "Personal Birdie linked"
        : "Three V1 spaces linked";

  return (
    <main className="app-shell">
      <section className="hero"><div><p className="eyebrow">Birdie App V1 · Sandbox</p><h1>Welcome home, golfer.</h1><p className="lede">Your rounds, living balls and Birdie now have somewhere to come home to.</p></div><div className="avatar" aria-label="Avatar preset">B</div></section>

      <div className="world-composition">
        <ThreeHotelScene onZoneChange={onSceneZoneChange} />
        <WorldAtmosphere onOpenHotspot={openWorldHotspot} activeHotspot={worldTarget} />
        <BirdieCompanion
          worldContext={worldContext}
          activeDestination={worldTarget}
          onChoose={openWorldHotspot}
        />
      </div>
      <div className="world-pulse" aria-label="Sandbox world atmosphere status">
        <span><i /> Golden hour</span>
        <span><i /> Terrace lights</span>
        <span><i /> Birdie circling</span>
        <span><i /> {worldTargetLabel}</span>
        <span className="sandbox-pulse">Sandbox world only</span>
      </div>

      <section className="hotspots">
        <article
          id="golf-history"
          ref={golfHistoryRef}
          className="panel golf-history"
          style={worldTarget === "golf-history" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "golf-history" ? "location" : undefined}
        >
          <p className="eyebrow">Hotspot 01</p><h2>Golf History</h2>
          {rounds.length === 0 ? <p>No sandbox rounds yet.</p> : rounds.map((round) => <button className="round" key={round.roundId} onClick={() => openRound(round.roundId)}><strong>{round.courseRef ?? "Course not provided"}</strong><span>{round.totals.strokes} strokes · {round.totals.scoredHoles}/{round.holeCount} holes</span><small>{round.contractVersion} · {round.status}</small></button>)}
          {detailLoading && <p className="detail-state">Loading round detail…</p>}
          {detail && !detailLoading && <section className="round-detail" aria-label="Round detail"><div className="detail-heading"><div><p className="eyebrow">Round Detail</p><h3>{detail.title}</h3><p>{detail.meta}</p></div><button className="close-detail" onClick={() => setSelectedRound(null)}>Close</button></div><div className="detail-meta"><span>{selectedRound?.courseDataMode}</span><span>{detail.privacy}</span></div><div className="holes">{detail.holes.map((hole) => <div className="hole" key={hole.holeNumber}><strong>Hole {hole.holeNumber}</strong><span>{hole.strokes ?? "—"} strokes</span><small>Putts {hole.putts ?? "—"} · Penalties {hole.penalties ?? "—"}</small></div>)}</div></section>}
        </article>

        <article
          id="ball-vault"
          ref={ballVaultRef}
          className="panel ball-vault"
          style={worldTarget === "ball-vault" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "ball-vault" ? "location" : undefined}
        >
          <p className="eyebrow">Hotspot 02</p><h2>Ball Vault</h2>
          {passports.length === 0 ? <p>No owned sandbox balls yet.</p> : passports.map((passport) => <button className="passport-card" key={passport.objectId} onClick={() => openPassport(passport.objectId)}><div className="ball-orb" aria-hidden="true">B</div><div><strong>{passport.displayName}</strong><span>{passport.editionId ?? "Edition not provided"} · {passport.rarity ?? "Rarity not provided"}</span><small>{passport.state} · {passport.privacySafeStats.holesSurvived} holes survived</small></div></button>)}
          {selectedPassport && <section className="passport-detail" aria-label="Ball Passport detail"><div className="detail-heading"><div><p className="eyebrow">Living Ball Passport</p><h3>{selectedPassport.displayName}</h3><p>{selectedPassport.objectId}</p></div><button className="close-detail" onClick={() => setSelectedPassport(null)}>Close</button></div><div className="passport-stats"><span>{selectedPassport.privacySafeStats.rounds} rounds</span><span>{selectedPassport.privacySafeStats.courses} courses</span><span>{selectedPassport.privacySafeStats.birdiesWitnessed} birdies</span><span>{selectedPassport.privacySafeStats.holesSurvived} holes</span></div><div className="journey">{selectedPassport.journey.map((event) => <div className="journey-event" key={event.eventId}><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.courseName ?? "Private journey event"}</span><small>{event.locationLabel ?? event.privacyClass} · {event.occurredAt.slice(0, 10)}</small></div>)}</div></section>}
        </article>

        <article
          id="personal-birdie"
          ref={personalBirdieRef}
          className="panel personal-birdie"
          style={worldTarget === "personal-birdie" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "personal-birdie" ? "location" : undefined}
        >
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
