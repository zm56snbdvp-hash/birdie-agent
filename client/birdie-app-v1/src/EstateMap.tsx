import { useEffect, useRef, type KeyboardEvent } from "react";
import { ESTATE_DISTRICTS, type EstateDistrictId } from "./estateContract";

export interface EstateMapProps {
  activeDistrict: EstateDistrictId;
  onClose: () => void;
}

export function EstateMap({ activeDistrict, onClose }: EstateMapProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      id="estate-map"
      className="estate-map"
      role="dialog"
      aria-modal="false"
      aria-labelledby="estate-map-title"
      onKeyDown={handleKeyDown}
    >
      <header>
        <div>
          <p>Birdie &amp; Breakfast Grundstück</p>
          <h2 id="estate-map-title">Alles gehört zu einer Welt.</h2>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Karte schließen">×</button>
      </header>
      <div className="estate-map__visual" aria-hidden="true">
        <span className="estate-map__path estate-map__path--golf" />
        <span className="estate-map__path estate-map__path--stable" />
        <span className="estate-map__node estate-map__node--hotel">Hotel</span>
        <span className="estate-map__node estate-map__node--terrace">Terrasse</span>
        <span className="estate-map__node estate-map__node--golf">Golfplatz</span>
        <span className="estate-map__node estate-map__node--stable">Reiterhof</span>
        <span className="estate-map__node estate-map__node--arrival">Ankunft</span>
      </div>
      <ol className="estate-map__legend">
        {ESTATE_DISTRICTS.filter((district) => district.id !== "estate-grounds").map((district) => (
          <li key={district.id} className={district.id === activeDistrict ? "is-current" : ""}>
            <span aria-hidden="true" />
            <div><strong>{district.label}</strong><small>{district.description}</small></div>
            {district.id === activeDistrict ? <em>Du bist hier</em> : null}
          </li>
        ))}
      </ol>
      <p className="estate-map__boundary">Die Karte orientiert dich. Zwischen den Orten gehst du selbst – ohne Teleport und ohne Standortdaten.</p>
    </aside>
  );
}
