import { useEffect, useMemo, useRef, useState } from "react";
import {
  BIRDIE_V1_DESTINATIONS,
  BIRDIE_V1_TARGET_IDS,
  getBirdieDestination,
  type BirdieWorldDestination
} from "./birdieDestinations";
import { getBirdieWorldCue } from "./birdieWorldCue";
import type { BirdieWorldContextProjection } from "./worldContext";
import "./birdieCompanion.css";

export type BirdieCompanionDestination = BirdieWorldDestination;
export type { BirdieWorldContextProjection } from "./worldContext";

export interface BirdieCompanionProps {
  /** Optional display name from a user-scoped profile projection. */
  profileName?: string;
  /** Versioned, coarse renderer/UI projection. Contains no coordinates. */
  worldContext?: BirdieWorldContextProjection | null;
  /** Optional UI projection of the currently visible V1 destination. */
  activeDestination?: BirdieCompanionDestination | null;
  /** Called only after one of the existing three V1 destinations is chosen. */
  onChoose?: (destination: BirdieCompanionDestination) => void;
  /** Maps the three locked destinations to existing DOM element IDs. */
  targetIds?: Partial<Record<BirdieCompanionDestination, string>>;
  /** Owner review may start open; consumer shells may start docked after their own gate. */
  initiallyOpen?: boolean;
  /** In-memory request from the arrival guide to reopen the existing guide phase. */
  guideRequestId?: number;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function revealExistingDestination(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const reduceMotion = prefersReducedMotion();
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start"
  });

  target.classList.add("birdie-destination-highlight");
  window.setTimeout(() => {
    target.classList.remove("birdie-destination-highlight");
  }, reduceMotion ? 1 : 2200);
}

export function BirdieCompanion({
  profileName,
  worldContext,
  activeDestination,
  onChoose,
  targetIds,
  initiallyOpen = true,
  guideRequestId = 0
}: BirdieCompanionProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [introduced, setIntroduced] = useState(false);
  const [phase, setPhase] = useState<"hello" | "guide">("hello");
  const [lastDestination, setLastDestination] =
    useState<BirdieCompanionDestination | null>(activeDestination ?? null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const handledGuideRequestRef = useRef(guideRequestId);

  const worldCue = useMemo(
    () => getBirdieWorldCue(worldContext),
    [worldContext]
  );
  const destinationContext = lastDestination
    ? getBirdieDestination(lastDestination)
    : null;
  const recommendedDestination = worldContext?.suggestedDestination ?? null;

  useEffect(() => {
    if (activeDestination) setLastDestination(activeDestination);
  }, [activeDestination]);

  useEffect(() => {
    if (handledGuideRequestRef.current === guideRequestId) return;
    handledGuideRequestRef.current = guideRequestId;
    setIntroduced(true);
    setPhase("guide");
    setOpen(true);
  }, [guideRequestId]);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(
      () => firstActionRef.current?.focus(),
      prefersReducedMotion() ? 0 : 160
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIntroduced(true);
        setOpen(false);
        window.setTimeout(() => launcherRef.current?.focus(), 0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, phase]);

  const close = () => {
    setIntroduced(true);
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  };

  const reopen = () => {
    setPhase(introduced ? "guide" : "hello");
    setOpen(true);
  };

  const choose = (destination: BirdieCompanionDestination) => {
    const targetId =
      targetIds?.[destination] ?? BIRDIE_V1_TARGET_IDS[destination];
    setIntroduced(true);
    setLastDestination(destination);
    setOpen(false);
    if (onChoose) onChoose(destination);
    else revealExistingDestination(targetId);
  };

  const greeting = profileName?.trim()
    ? `Hey ${profileName.trim()}, ich sehe, wo du gerade bist.`
    : "Hey, ich sehe, wo du gerade bist.";

  const guideTitle =
    destinationContext?.activeTitle ??
    worldCue?.title ??
    "Wohin darf ich dich führen?";
  const guideCopy =
    destinationContext?.activeCopy ??
    worldCue?.copy ??
    "Diese drei Orte bleiben der vollständige, gebundene V1-Rahmen.";
  const launcherEyebrow = worldCue?.eyebrow ?? "Birdie ist da";
  const launcherCopy =
    destinationContext?.dock ??
    worldCue?.launcher ??
    "Dein Begleiter in der Birdie World";

  return (
    <div className="birdie-companion">
      {!open && (
        <button
          ref={launcherRef}
          className="birdie-companion__launcher"
          type="button"
          onClick={reopen}
          aria-label="Birdie öffnen"
          aria-haspopup="dialog"
        >
          <span className="birdie-companion__launcher-aura" aria-hidden="true" />
          <span className="birdie-companion__mini-bird" aria-hidden="true">
            <i className="birdie-companion__mini-wing birdie-companion__mini-wing--left" />
            <i className="birdie-companion__mini-body" />
            <i className="birdie-companion__mini-head" />
            <i className="birdie-companion__mini-wing birdie-companion__mini-wing--right" />
          </span>
          <span className="birdie-companion__launcher-copy">
            <small>{launcherEyebrow}</small>
            <strong aria-live="polite">{launcherCopy}</strong>
          </span>
          <span className="birdie-companion__launcher-arrow" aria-hidden="true">
            ↑
          </span>
        </button>
      )}

      {open && (
        <aside
          className="birdie-companion__dialog"
          role="dialog"
          aria-modal="false"
          aria-labelledby="birdie-companion-title"
          aria-describedby="birdie-companion-copy"
        >
          <div className="birdie-companion__aura" aria-hidden="true" />
          <div className="birdie-companion__bird" aria-hidden="true">
            <span className="birdie-companion__wing birdie-companion__wing--left" />
            <span className="birdie-companion__body" />
            <span className="birdie-companion__head">
              <i className="birdie-companion__eye" />
              <i className="birdie-companion__beak" />
            </span>
            <span className="birdie-companion__wing birdie-companion__wing--right" />
          </div>

          <button
            className="birdie-companion__close"
            type="button"
            aria-label="Birdie minimieren"
            onClick={close}
          >
            ×
          </button>

          {phase === "hello" ? (
            <div className="birdie-companion__content">
              <p className="birdie-companion__eyebrow">
                <span aria-hidden="true" /> Birdie liest die Welt
              </p>
              <h2 id="birdie-companion-title">{greeting}</h2>
              <p id="birdie-companion-copy">
                Ich bekomme nur eine grobe, flüchtige Weltzone aus der aktuellen
                Szene. Exakte Koordinaten, Bewegungsverlauf und Entscheidungen bleiben
                außerhalb dieses Begleiters.
              </p>

              {worldCue && (
                <div className="birdie-companion__world-cue" aria-live="polite">
                  <small>{worldCue.eyebrow}</small>
                  <strong>{worldCue.title}</strong>
                  <span>{worldCue.recommendationReason}</span>
                </div>
              )}

              <div className="birdie-companion__actions">
                <button
                  ref={firstActionRef}
                  className="birdie-companion__primary"
                  type="button"
                  onClick={() => {
                    setIntroduced(true);
                    setPhase("guide");
                  }}
                >
                  Zeig mir, was hier passt
                </button>
                <button
                  className="birdie-companion__secondary"
                  type="button"
                  onClick={close}
                >
                  Bleib einfach bei mir
                </button>
              </div>
            </div>
          ) : (
            <div className="birdie-companion__content birdie-companion__content--guide">
              <p className="birdie-companion__eyebrow">
                <span aria-hidden="true" /> Dein kontextueller Weltbegleiter
              </p>
              <h2 id="birdie-companion-title">{guideTitle}</h2>
              <p id="birdie-companion-copy">{guideCopy}</p>

              {worldCue && (
                <div className="birdie-companion__world-cue birdie-companion__world-cue--compact">
                  <small>
                    {worldContext?.zoneLabel} · {worldContext?.contractVersion}
                  </small>
                  <span>{worldCue.recommendationReason}</span>
                </div>
              )}

              <div className="birdie-companion__destinations">
                {BIRDIE_V1_DESTINATIONS.map((destination, index) => {
                  const active = lastDestination === destination.id;
                  const recommended =
                    !active && recommendedDestination === destination.id;
                  return (
                    <button
                      key={destination.id}
                      ref={index === 0 ? firstActionRef : undefined}
                      className={`birdie-companion__destination${active ? " is-active" : ""}${recommended ? " is-recommended" : ""}`}
                      type="button"
                      data-birdie-destination={destination.id}
                      aria-current={active ? "location" : undefined}
                      aria-describedby={
                        recommended
                          ? `birdie-recommendation-${destination.id}`
                          : undefined
                      }
                      onClick={() => choose(destination.id)}
                    >
                      {recommended && (
                        <em id={`birdie-recommendation-${destination.id}`}>
                          Jetzt passend
                        </em>
                      )}
                      <small>{destination.eyebrow}</small>
                      <strong>{destination.title}</strong>
                      <span>{destination.description}</span>
                      <i aria-hidden="true">{active ? "•" : "→"}</i>
                    </button>
                  );
                })}
              </div>

              <button
                className="birdie-companion__back"
                type="button"
                onClick={() => setPhase("hello")}
              >
                ← Begrüßung noch einmal
              </button>
            </div>
          )}

          <p className="birdie-companion__boundary">
            {worldContext?.precision ?? "coarse-zone"} · keine Koordinaten · kein
            Storage · kein Modellaufruf · keine neue Autorität
          </p>
        </aside>
      )}
    </div>
  );
}
