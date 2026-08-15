import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { getBirdieDestination, type BirdieWorldDestination } from "./birdieDestinations";

export interface EstateFeaturePanelProps {
  destination: BirdieWorldDestination;
  onReturnToBirdie: () => void;
  children: ReactNode;
}

export function EstateFeaturePanel({
  destination,
  onReturnToBirdie,
  children
}: EstateFeaturePanelProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const definition = getBirdieDestination(destination);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onReturnToBirdie();
  };

  return (
    <div
      className="estate-panel-overlay"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`estate-panel-title-${destination}`}
      data-estate-overlay={destination}
      onKeyDown={handleKeyDown}
    >
      <section
        id={`estate-panel-${destination}`}
        className={`estate-feature-panel estate-feature-panel--${destination}`}
        aria-labelledby={`estate-tab-${destination}`}
      >
        <header className="estate-feature-panel__header">
          <div>
            <p>{definition.eyebrow}</p>
            <h1 id={`estate-panel-title-${destination}`}>{definition.title}</h1>
            <span>{definition.description}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="estate-feature-panel__return"
            onClick={onReturnToBirdie}
          >
            <span aria-hidden="true">←</span>
            Zurück zu Birdie
          </button>
        </header>
        <div className="estate-feature-panel__body">{children}</div>
        <footer>
          Nur diese Sitzung · keine neue Identität, Berechtigung oder Speicherung
        </footer>
      </section>
    </div>
  );
}
