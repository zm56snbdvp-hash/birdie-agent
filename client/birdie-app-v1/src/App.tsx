import { useEffect, useMemo, useRef, useState } from "react";
import { sandboxAdapter, type BallPassportDto, type PersonalBirdieReplyDto, type RoundDetailDto, type RoundSummaryDto } from "./appAdapter";
import { formatRoundDetail } from "./roundDetail";
import { ThreeHotelScene } from "./ThreeHotelScene";
import { WorldAtmosphere, type WorldHotspotId } from "./WorldAtmosphere";
import { BirdieCompanion } from "./BirdieCompanion";
import { useBirdieWorldBridge } from "./useBirdieWorldBridge";
import { ArrivalLoopGuide } from "./ArrivalLoopGuide";
import { WorldHeartbeat } from "./WorldHeartbeat";
import {
  INITIAL_BIRDIE_ARRIVAL_LOOP,
  arriveAtBirdieDestination,
  returnFromBirdieDestination
} from "./arrivalLoop";
import {
  INITIAL_BIRDIE_HOST_JOURNEY,
  advanceBirdieHostJourney,
  inviteFromBirdie,
  returnToBirdieHost
} from "./hostJourney";

const birdieId = "BIRDIE-SANDBOX-001";

const linkedPanelStyle = {
  outline: "2px solid #c7a54a",
  outlineOffset: "3px",
  boxShadow: "0 14px 38px rgba(35,71,52,.12), 0 0 0 6px rgba(199,165,74,.08)"
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function App() {
  const { worldContext, onSceneZoneChange } = useBirdieWorldBridge();
  const [rounds, setRounds] = useState<RoundSummaryDto[]>([]);
  const [selectedRound, setSelectedRound] = useState<RoundDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [passports, setPassports] = useState<BallPassportDto[]>([]);
  const [selectedPassport, setSelectedPassport] = useState<BallPassportDto | null>(null);
  const [birdieMessage, setBirdieMessage] = useState("Erzähl mir von meiner Golfgeschichte");
  const [birdieReply, setBirdieReply] = useState<PersonalBirdieReplyDto | null>(null);
  const [birdieLoading, setBirdieLoading] = useState(false);
  const [worldTarget, setWorldTarget] = useState<WorldHotspotId | null>(null);
  const [arrivalLoop, setArrivalLoop] = useState(INITIAL_BIRDIE_ARRIVAL_LOOP);
  const [hostJourney, setHostJourney] = useState(INITIAL_BIRDIE_HOST_JOURNEY);
  const [guideRequestId, setGuideRequestId] = useState(0);
  const [arrivalAnnouncement, setArrivalAnnouncement] = useState("");

  const worldCompositionRef = useRef<HTMLDivElement | null>(null);
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
    setHostJourney((current) => inviteFromBirdie(current, hotspot));
    setArrivalLoop((current) => arriveAtBirdieDestination(current, hotspot));
    const target = hotspot === "golf-history"
      ? golfHistoryRef.current
      : hotspot === "ball-vault"
        ? ballVaultRef.current
        : personalBirdieRef.current;
    const targetLabel = hotspot === "golf-history"
      ? "Golf History"
      : hotspot === "ball-vault"
        ? "Ball Vault"
        : "Personal Birdie";
    setArrivalAnnouncement(`${targetLabel} ist geöffnet. Birdie wartet über den Rückweg auf dich.`);
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center"
    });
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }

  function returnToBirdie() {
    setArrivalLoop((current) => returnFromBirdieDestination(current));
    setHostJourney((current) => returnToBirdieHost(current));
    setWorldTarget(null);
    setGuideRequestId((current) => current + 1);
    setArrivalAnnouncement("Zurück bei Birdie. Birdie orientiert dich weiter.");
    worldCompositionRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center"
    });
  }

  function renderArrivalGuide(destination: WorldHotspotId) {
    if (
      arrivalLoop.phase !== "arrived" ||
      arrivalLoop.activeDestination !== destination
    ) return null;

    return (
      <ArrivalLoopGuide
        destination={destination}
        arrivalNumber={arrivalLoop.arrivalCount}
        onReturnToBirdie={returnToBirdie}
      />
    );
  }

  return (
    <main
      className="app-shell"
      data-living-arrival={hostJourney.contractVersion}
      data-host-stage={hostJourney.stage}
    >
      <section className="hero" aria-labelledby="living-arrival-title">
        <div>
          <p className="eyebrow">BirdieWorld · Living Arrival V0.2</p>
          <h1 id="living-arrival-title">Du bist da. Birdie auch.</h1>
          <p className="lede">
            Erst ankommen, dann schauen, was heute zu dir passt.
          </p>
        </div>
        <div className="avatar" aria-label="Voreingestellter Test-Avatar">B</div>
      </section>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {arrivalAnnouncement}
      </p>

      <div
        className="world-composition"
        ref={worldCompositionRef}
        role="region"
        aria-label="Deine Ankunft in der BirdieWorld"
      >
        <ThreeHotelScene onZoneChange={onSceneZoneChange} />
        <WorldAtmosphere onOpenHotspot={openWorldHotspot} activeHotspot={worldTarget} />
        <BirdieCompanion
          worldContext={worldContext}
          activeDestination={worldTarget}
          onChoose={openWorldHotspot}
          guideRequestId={guideRequestId}
          onHostStageChange={(stage) => {
            setHostJourney((current) => advanceBirdieHostJourney(current, stage));
          }}
        />
      </div>
      <WorldHeartbeat worldContext={worldContext} activeDestination={worldTarget} />

      <section className="hotspots">
        <article
          id="golf-history"
          ref={golfHistoryRef}
          className="panel golf-history"
          tabIndex={-1}
          aria-label="Golf History"
          style={worldTarget === "golf-history" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "golf-history" ? "location" : undefined}
        >
          {renderArrivalGuide("golf-history")}
          <p className="eyebrow">Ort 01 · Deine Geschichte</p><h2>Golf History</h2>
          {rounds.length === 0 ? <p>Noch keine Test-Runden.</p> : rounds.map((round) => <button className="round" key={round.roundId} onClick={() => openRound(round.roundId)}><strong>{round.courseRef ?? "Platz nicht angegeben"}</strong><span>{round.totals.strokes} Schläge · {round.totals.scoredHoles}/{round.holeCount} Löcher</span><small>{round.contractVersion} · {round.status}</small></button>)}
          {detailLoading && <p className="detail-state">Rundendetails werden geladen…</p>}
          {detail && !detailLoading && <section className="round-detail" aria-label="Rundendetails"><div className="detail-heading"><div><p className="eyebrow">Rundendetails</p><h3>{detail.title}</h3><p>{detail.meta}</p></div><button className="close-detail" onClick={() => setSelectedRound(null)}>Schließen</button></div><div className="detail-meta"><span>{selectedRound?.courseDataMode}</span><span>{detail.privacy}</span></div><div className="holes">{detail.holes.map((hole) => <div className="hole" key={hole.holeNumber}><strong>Loch {hole.holeNumber}</strong><span>{hole.strokes ?? "—"} Schläge</span><small>Putts {hole.putts ?? "—"} · Strafschläge {hole.penalties ?? "—"}</small></div>)}</div></section>}
        </article>

        <article
          id="ball-vault"
          ref={ballVaultRef}
          className="panel ball-vault"
          tabIndex={-1}
          aria-label="Ball Vault"
          style={worldTarget === "ball-vault" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "ball-vault" ? "location" : undefined}
        >
          {renderArrivalGuide("ball-vault")}
          <p className="eyebrow">Ort 02 · Deine Begleiter</p><h2>Ball Vault</h2>
          {passports.length === 0 ? <p>Noch keine eigenen Test-Bälle.</p> : passports.map((passport) => <button className="passport-card" key={passport.objectId} onClick={() => openPassport(passport.objectId)}><div className="ball-orb" aria-hidden="true">B</div><div><strong>{passport.displayName}</strong><span>{passport.editionId ?? "Edition nicht angegeben"} · {passport.rarity ?? "Seltenheit nicht angegeben"}</span><small>{passport.state} · {passport.privacySafeStats.holesSurvived} Löcher erlebt</small></div></button>)}
          {selectedPassport && <section className="passport-detail" aria-label="Ball-Pass-Details"><div className="detail-heading"><div><p className="eyebrow">Lebender Ball-Pass</p><h3>{selectedPassport.displayName}</h3><p>{selectedPassport.objectId}</p></div><button className="close-detail" onClick={() => setSelectedPassport(null)}>Schließen</button></div><div className="passport-stats"><span>{selectedPassport.privacySafeStats.rounds} Runden</span><span>{selectedPassport.privacySafeStats.courses} Plätze</span><span>{selectedPassport.privacySafeStats.birdiesWitnessed} Birdies</span><span>{selectedPassport.privacySafeStats.holesSurvived} Löcher</span></div><div className="journey">{selectedPassport.journey.map((event) => <div className="journey-event" key={event.eventId}><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.courseName ?? "Privates Reiseereignis"}</span><small>{event.locationLabel ?? event.privacyClass} · {event.occurredAt.slice(0, 10)}</small></div>)}</div></section>}
        </article>

        <article
          id="personal-birdie"
          ref={personalBirdieRef}
          className="panel personal-birdie"
          tabIndex={-1}
          aria-label="Personal Birdie"
          style={worldTarget === "personal-birdie" ? linkedPanelStyle : undefined}
          aria-current={worldTarget === "personal-birdie" ? "location" : undefined}
        >
          {renderArrivalGuide("personal-birdie")}
          <p className="eyebrow">Ort 03 · Dein Gespräch</p><h2>Personal Birdie</h2>
          <p className="birdie-boundary">Sicherer Test-Begleiter · nur dein Golf-Kontext</p>
          <label className="birdie-input"><span>Frag Birdie</span><textarea value={birdieMessage} onChange={(event) => setBirdieMessage(event.target.value)} rows={4} /></label>
          <button className="ask-birdie" onClick={askBirdie} disabled={birdieLoading}>{birdieLoading ? "Birdie denkt nach…" : "Personal Birdie fragen"}</button>
          {birdieReply && <div className={`birdie-reply ${birdieReply.refused ? "refused" : ""}`}><strong>{birdieReply.refused ? "Zugriffsgrenze" : "Personal Birdie"}</strong><p>{birdieReply.reply}</p><small>{birdieReply.mode} · {birdieReply.contractVersion}</small></div>}
          <details className="birdie-scope"><summary>Worauf Birdie zugreifen kann</summary><p>Dein Profil, eigene Runden und Statistiken, eigene Ball-Pässe, Erfolge, Präferenzen und freigegebene öffentliche Birdie-Inhalte. Interne Unternehmensvorgänge bleiben unzugänglich.</p></details>
        </article>
      </section>
    </main>
  );
}
