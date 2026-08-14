import type { KeyboardEvent } from "react";
import { BIRDIE_V1_DESTINATIONS, type BirdieWorldDestination } from "./birdieDestinations";
import {
  getEstateDistrict,
  type EstateDistrictId,
  type EstateInteractionDefinition,
  type EstateWebglStatus
} from "./estateContract";

const DESTINATION_ICONS: Record<BirdieWorldDestination, string> = {
  "golf-history": "GH",
  "ball-vault": "BV",
  "personal-birdie": "PB"
};

export interface EstateHudProps {
  activeDistrict: EstateDistrictId;
  activeDestination: BirdieWorldDestination | null;
  nearbyInteraction: EstateInteractionDefinition | null;
  webglStatus: EstateWebglStatus;
  mapOpen: boolean;
  controlsDisabled: boolean;
  onOpenDestination: (destination: BirdieWorldDestination) => void;
  onOpenMap: () => void;
  onInteract: () => void;
}

export function EstateHud({
  activeDistrict,
  activeDestination,
  nearbyInteraction,
  webglStatus,
  mapOpen,
  controlsDisabled,
  onOpenDestination,
  onOpenMap,
  onInteract
}: EstateHudProps) {
  const district = getEstateDistrict(activeDistrict);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentIndex = BIRDIE_V1_DESTINATIONS.findIndex(
      (destination) => `estate-tab-${destination.id}` === document.activeElement?.id
    );
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % BIRDIE_V1_DESTINATIONS.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + BIRDIE_V1_DESTINATIONS.length) % BIRDIE_V1_DESTINATIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = BIRDIE_V1_DESTINATIONS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    document.getElementById(`estate-tab-${BIRDIE_V1_DESTINATIONS[nextIndex].id}`)?.focus();
  };

  return (
    <div
      className="estate-hud"
      aria-label="BirdieWorld Steuerung"
      aria-hidden={controlsDisabled ? true : undefined}
      inert={controlsDisabled ? true : undefined}
    >
      <header className="estate-topbar">
        <div className="estate-brand" aria-label="Birdie & Breakfast BirdieWorld">
          <span className="estate-brand__mark" aria-hidden="true">B&amp;B</span>
          <span>
            <small>BirdieWorld · Immersive Estate V0.3.4</small>
            <strong>Birdie &amp; Breakfast</strong>
          </span>
        </div>

        <div className="estate-location" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true" />
          <div>
            <small>{district.eyebrow}</small>
            <strong>{district.label}</strong>
          </div>
        </div>

        <button
          type="button"
          className="estate-map-button"
          aria-expanded={mapOpen}
          aria-controls="estate-map"
          onClick={onOpenMap}
        >
          <span aria-hidden="true">⌁</span>
          <strong>Karte</strong>
        </button>
      </header>

      <div className="estate-help" data-estate-render-status={webglStatus}>
        <span className={`estate-help__signal is-${webglStatus}`} aria-hidden="true" />
        <span>
          {webglStatus === "ready"
            ? "WASD / Pfeile · Touch · E zum Interagieren"
            : "Räumliche Bedienansicht aktiv"}
        </span>
      </div>

      {nearbyInteraction ? (
        <button
          type="button"
          className="estate-interaction-prompt"
          data-nearby-interaction={nearbyInteraction.id}
          onClick={onInteract}
        >
          <kbd aria-hidden="true">E</kbd>
          <span>
            <small>{nearbyInteraction.speaker}</small>
            <strong>{nearbyInteraction.prompt}</strong>
          </span>
        </button>
      ) : null}

      <nav
        className="estate-function-nav"
        aria-label="BirdieWorld Funktionen"
        onKeyDown={handleTabKeyDown}
      >
        {BIRDIE_V1_DESTINATIONS.map((destination) => {
          const active = destination.id === activeDestination;
          return (
            <button
              key={destination.id}
              id={`estate-tab-${destination.id}`}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={active}
              aria-controls={active ? `estate-panel-${destination.id}` : undefined}
              data-estate-function={destination.id}
              onClick={() => onOpenDestination(destination.id)}
            >
              <span aria-hidden="true">{DESTINATION_ICONS[destination.id]}</span>
              <span>
                <small>{destination.eyebrow}</small>
                <strong>{destination.title}</strong>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
