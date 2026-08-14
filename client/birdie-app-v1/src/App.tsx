import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sandboxAdapter,
  type BallPassportDto,
  type PersonalBirdieReplyDto,
  type RoundDetailDto,
  type RoundSummaryDto
} from "./appAdapter";
import { ArrivalLoopGuide } from "./ArrivalLoopGuide";
import { BirdieCompanion } from "./BirdieCompanion";
import type { BirdieWorldDestination } from "./birdieDestinations";
import { EstateFeaturePanel } from "./EstateFeaturePanel";
import { EstateHud } from "./EstateHud";
import { EstateArrival, ESTATE_ARRIVAL_VERSION } from "./EstateArrival";
import { EstateMap } from "./EstateMap";
import { EstateNpcDialogue } from "./EstateNpcDialogue";
import { EstateWorld } from "./EstateWorld";
import { WorldHeartbeat } from "./WorldHeartbeat";
import type { EstateAvatarStyleId } from "./avatarStyle";
import {
  ESTATE_CONTRACT_VERSION,
  createEstateInteractionEvent,
  type EstateDistrictId,
  type EstateInteractionDefinition,
  type EstateInteractionEvent,
  type EstateWebglStatus
} from "./estateContract";
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
import { formatRoundDetail } from "./roundDetail";
import { useBirdieWorldBridge } from "./useBirdieWorldBridge";
import type { ThreeHotelSceneZone } from "./worldContext";

const birdieId = "BIRDIE-SANDBOX-001";

const LEGACY_ZONE_BY_ESTATE: Readonly<Record<EstateDistrictId, ThreeHotelSceneZone>> = {
  "arrival-court": "Arrival Path",
  hotel: "Hotel Entrance",
  "golf-course": "Putting Green",
  terrace: "Terrace",
  stables: "Hotel Grounds",
  "estate-grounds": "Hotel Grounds"
};

function focusWalkableWorld() {
  window.requestAnimationFrame(() => {
    const focusTarget = Array.from(document.querySelectorAll<HTMLElement>("[data-estate-world-focus='true']"))
      .find((element) => !element.hidden && element.getClientRects().length > 0);
    focusTarget?.focus({ preventScroll: true });
  });
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
  const [activeDestination, setActiveDestination] = useState<BirdieWorldDestination | null>(null);
  const [arrivalLoop, setArrivalLoop] = useState(INITIAL_BIRDIE_ARRIVAL_LOOP);
  const [hostJourney, setHostJourney] = useState(INITIAL_BIRDIE_HOST_JOURNEY);
  const [guideRequestId, setGuideRequestId] = useState(0);
  const [arrivalAnnouncement, setArrivalAnnouncement] = useState("");
  const [activeDistrict, setActiveDistrict] = useState<EstateDistrictId>("arrival-court");
  const [nearbyInteraction, setNearbyInteraction] = useState<EstateInteractionDefinition | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<EstateInteractionEvent | null>(null);
  const [webglStatus, setWebglStatus] = useState<EstateWebglStatus>("initializing");
  const [mapOpen, setMapOpen] = useState(false);
  const [arrivalComplete, setArrivalComplete] = useState(false);
  const [avatarStyle, setAvatarStyle] = useState<EstateAvatarStyleId>("fairway");

  useEffect(() => {
    let current = true;
    void Promise.all([
      sandboxAdapter.getGolfHistory(birdieId),
      sandboxAdapter.getOwnedBallPassports(birdieId)
    ]).then(([history, ownedPassports]) => {
      if (!current) return;
      setRounds(history);
      setPassports(ownedPassports);
    });
    return () => {
      current = false;
    };
  }, []);

  const detail = useMemo(
    () => (selectedRound ? formatRoundDetail(selectedRound) : null),
    [selectedRound]
  );
  const overlayOpen =
    !arrivalComplete ||
    activeDestination !== null ||
    activeInteraction !== null ||
    mapOpen;

  const completeArrival = useCallback(() => {
    setArrivalComplete(true);
    setArrivalAnnouncement(
      "Das Taxi ist angekommen. Birdie begrüßt dich am Ankunftshof."
    );
  }, []);

  const handleDistrictChange = useCallback((district: EstateDistrictId) => {
    setActiveDistrict(district);
    onSceneZoneChange(LEGACY_ZONE_BY_ESTATE[district]);
    setArrivalAnnouncement(`Du bist jetzt im Bereich ${district.replaceAll("-", " ")}.`);
  }, [onSceneZoneChange]);

  const openDestination = useCallback((destination: BirdieWorldDestination) => {
    setMapOpen(false);
    setActiveInteraction(null);
    setActiveDestination(destination);
    setHostJourney((current) => inviteFromBirdie(current, destination));
    setArrivalLoop((current) => arriveAtBirdieDestination(current, destination));
    const targetLabel = destination === "golf-history"
      ? "Golf History"
      : destination === "ball-vault"
        ? "Ball Vault"
        : "Personal Birdie";
    setArrivalAnnouncement(`${targetLabel} ist als eigener Welt-Tab geöffnet. Birdie bleibt erreichbar.`);
  }, []);

  const returnToBirdie = useCallback(() => {
    setArrivalLoop((current) => returnFromBirdieDestination(current));
    setHostJourney((current) => returnToBirdieHost(current));
    setActiveDestination(null);
    setActiveInteraction(null);
    setMapOpen(false);
    setGuideRequestId((current) => current + 1);
    setArrivalAnnouncement("Zurück bei Birdie. Die Estate bleibt hinter dir sichtbar.");
  }, []);

  const closeWorldOverlay = useCallback(() => {
    setActiveInteraction(null);
    setMapOpen(false);
    setArrivalAnnouncement("Du erkundest die Estate weiter.");
    focusWalkableWorld();
  }, []);

  const handleInteraction = useCallback((interaction: EstateInteractionEvent) => {
    setMapOpen(false);
    setActiveInteraction(interaction);
    setArrivalAnnouncement(`${interaction.speaker} spricht mit dir. Die Begegnung wird nicht gespeichert.`);
  }, []);

  const activateNearbyInteraction = useCallback(() => {
    if (!nearbyInteraction) return;
    handleInteraction(createEstateInteractionEvent(nearbyInteraction.id));
  }, [handleInteraction, nearbyInteraction]);

  async function openRound(roundId: string) {
    setDetailLoading(true);
    try {
      setSelectedRound(await sandboxAdapter.getRoundDetail(roundId, birdieId));
    } finally {
      setDetailLoading(false);
    }
  }

  async function openPassport(objectId: string) {
    setSelectedPassport(await sandboxAdapter.getBallPassport(objectId, birdieId));
  }

  async function askBirdie() {
    if (!birdieMessage.trim()) return;
    setBirdieLoading(true);
    try {
      setBirdieReply(await sandboxAdapter.chatWithPersonalBirdie(birdieId, birdieMessage));
    } finally {
      setBirdieLoading(false);
    }
  }

  function renderArrivalGuide(destination: BirdieWorldDestination) {
    if (arrivalLoop.phase !== "arrived" || arrivalLoop.activeDestination !== destination) {
      return null;
    }
    return (
      <ArrivalLoopGuide
        destination={destination}
        arrivalNumber={arrivalLoop.arrivalCount}
        onReturnToBirdie={returnToBirdie}
      />
    );
  }

  function renderFeatureContent(destination: BirdieWorldDestination) {
    if (destination === "golf-history") {
      return (
        <article id="golf-history" className="estate-feature-content" tabIndex={-1} aria-current="location">
          {renderArrivalGuide(destination)}
          <p className="feature-eyebrow">Deine Geschichte auf dem Platz</p>
          <h2>Runden &amp; Scorecards</h2>
          {rounds.length === 0 ? <p>Noch keine Test-Runden.</p> : (
            <div className="estate-card-list">{rounds.map((round) => (
              <button className="round" key={round.roundId} type="button" onClick={() => openRound(round.roundId)}>
                <strong>{round.courseRef ?? "Platz nicht angegeben"}</strong>
                <span>{round.totals.strokes} Schläge · {round.totals.scoredHoles}/{round.holeCount} Löcher</span>
                <small>{round.contractVersion} · {round.status}</small>
              </button>
            ))}</div>
          )}
          {detailLoading ? <p className="detail-state">Rundendetails werden geladen…</p> : null}
          {detail && !detailLoading ? (
            <section className="round-detail" aria-label="Rundendetails">
              <div className="detail-heading">
                <div><p className="feature-eyebrow">Rundendetails</p><h3>{detail.title}</h3><p>{detail.meta}</p></div>
                <button className="close-detail" type="button" onClick={() => setSelectedRound(null)}>Schließen</button>
              </div>
              <div className="detail-meta"><span>{selectedRound?.courseDataMode}</span><span>{detail.privacy}</span></div>
              <div className="holes">{detail.holes.map((hole) => (
                <div className="hole" key={hole.holeNumber}><strong>Loch {hole.holeNumber}</strong><span>{hole.strokes ?? "—"} Schläge</span><small>Putts {hole.putts ?? "—"} · Strafschläge {hole.penalties ?? "—"}</small></div>
              ))}</div>
            </section>
          ) : null}
        </article>
      );
    }

    if (destination === "ball-vault") {
      return (
        <article id="ball-vault" className="estate-feature-content" tabIndex={-1} aria-current="location">
          {renderArrivalGuide(destination)}
          <p className="feature-eyebrow">Deine Begleiter</p>
          <h2>Lebende Ball-Pässe</h2>
          {passports.length === 0 ? <p>Noch keine eigenen Test-Bälle.</p> : (
            <div className="estate-card-list">{passports.map((passport) => (
              <button className="passport-card" key={passport.objectId} type="button" onClick={() => openPassport(passport.objectId)}>
                <span className="ball-orb" aria-hidden="true">B</span>
                <span><strong>{passport.displayName}</strong><span>{passport.editionId ?? "Edition nicht angegeben"} · {passport.rarity ?? "Seltenheit nicht angegeben"}</span><small>{passport.state} · {passport.privacySafeStats.holesSurvived} Löcher erlebt</small></span>
              </button>
            ))}</div>
          )}
          {selectedPassport ? (
            <section className="passport-detail" aria-label="Ball-Pass-Details">
              <div className="detail-heading">
                <div><p className="feature-eyebrow">Lebender Ball-Pass</p><h3>{selectedPassport.displayName}</h3><p>{selectedPassport.objectId}</p></div>
                <button className="close-detail" type="button" onClick={() => setSelectedPassport(null)}>Schließen</button>
              </div>
              <div className="passport-stats"><span>{selectedPassport.privacySafeStats.rounds} Runden</span><span>{selectedPassport.privacySafeStats.courses} Plätze</span><span>{selectedPassport.privacySafeStats.birdiesWitnessed} Birdies</span><span>{selectedPassport.privacySafeStats.holesSurvived} Löcher</span></div>
              <div className="journey">{selectedPassport.journey.map((event) => (
                <div className="journey-event" key={event.eventId}><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.courseName ?? "Privates Reiseereignis"}</span><small>{event.locationLabel ?? event.privacyClass} · {event.occurredAt.slice(0, 10)}</small></div>
              ))}</div>
            </section>
          ) : null}
        </article>
      );
    }

    return (
      <article id="personal-birdie" className="estate-feature-content personal-birdie" tabIndex={-1} aria-current="location">
        {renderArrivalGuide(destination)}
        <p className="feature-eyebrow">Dein Gespräch</p>
        <h2>Personal Birdie</h2>
        <p className="birdie-boundary">Sicherer Test-Begleiter · nur dein freigegebener Golf-Kontext</p>
        <label className="birdie-input"><span>Frag Birdie</span><textarea value={birdieMessage} onChange={(event) => setBirdieMessage(event.target.value)} rows={4} /></label>
        <button className="ask-birdie" type="button" onClick={askBirdie} disabled={birdieLoading}>{birdieLoading ? "Birdie denkt nach…" : "Personal Birdie fragen"}</button>
        {birdieReply ? <div className={`birdie-reply ${birdieReply.refused ? "refused" : ""}`}><strong>{birdieReply.refused ? "Zugriffsgrenze" : "Personal Birdie"}</strong><p>{birdieReply.reply}</p><small>{birdieReply.mode} · {birdieReply.contractVersion}</small></div> : null}
        <details className="birdie-scope"><summary>Worauf Birdie zugreifen kann</summary><p>Dein Profil, eigene Runden und Statistiken, eigene Ball-Pässe, Erfolge, Präferenzen und freigegebene öffentliche Birdie-Inhalte. Interne Unternehmensvorgänge bleiben unzugänglich.</p></details>
      </article>
    );
  }

  return (
    <main
      className="estate-app"
      data-immersive-estate={ESTATE_CONTRACT_VERSION}
      data-living-arrival={hostJourney.contractVersion}
      data-host-stage={hostJourney.stage}
      data-estate-district={activeDistrict}
      data-estate-overlay-open={overlayOpen ? "true" : "false"}
      data-estate-arrival={ESTATE_ARRIVAL_VERSION}
      data-estate-arrival-state={arrivalComplete ? "arrived" : "approaching"}
      data-estate-avatar-style={avatarStyle}
    >
      <h1 className="sr-only">BirdieWorld Immersive Estate V0.3.2</h1>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{arrivalAnnouncement}</p>

      <section className="estate-world" role="region" aria-label="Begehbares Birdie & Breakfast Grundstück">
        <div
          className="estate-world__renderer"
          aria-hidden={overlayOpen ? true : undefined}
          inert={overlayOpen ? true : undefined}
        >
          <EstateWorld
            paused={overlayOpen}
            avatarStyle={avatarStyle}
            onDistrictChange={handleDistrictChange}
            onNearbyInteractionChange={setNearbyInteraction}
            onInteraction={handleInteraction}
            onWebglStatusChange={setWebglStatus}
          />
        </div>
        <EstateHud
          activeDistrict={activeDistrict}
          activeDestination={activeDestination}
          nearbyInteraction={nearbyInteraction}
          webglStatus={webglStatus}
          mapOpen={mapOpen}
          controlsDisabled={overlayOpen}
          onOpenDestination={openDestination}
          onOpenMap={() => setMapOpen((current) => !current)}
          onInteract={activateNearbyInteraction}
        />
        <WorldHeartbeat
          worldContext={worldContext}
          activeDestination={activeDestination}
        />
      </section>

      {arrivalComplete ? (
        <BirdieCompanion
          worldContext={worldContext}
          activeDestination={activeDestination}
          onChoose={openDestination}
          guideRequestId={guideRequestId}
          dockAfterOrientation
          onEnterWorld={focusWalkableWorld}
          onHostStageChange={(stage) => {
            setHostJourney((current) => advanceBirdieHostJourney(current, stage));
          }}
        />
      ) : (
        <EstateArrival
          selectedStyle={avatarStyle}
          onSelectStyle={setAvatarStyle}
          onArrive={completeArrival}
        />
      )}

      {activeDestination ? (
        <EstateFeaturePanel destination={activeDestination} onReturnToBirdie={returnToBirdie}>
          {renderFeatureContent(activeDestination)}
        </EstateFeaturePanel>
      ) : null}
      {activeInteraction ? (
        <EstateNpcDialogue interaction={activeInteraction} onClose={closeWorldOverlay} onOpenDestination={openDestination} />
      ) : null}
      {mapOpen ? <EstateMap activeDistrict={activeDistrict} onClose={closeWorldOverlay} /> : null}
    </main>
  );
}
