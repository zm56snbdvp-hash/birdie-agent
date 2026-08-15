import {
  ESTATE_CONTRACT_VERSION,
  ESTATE_DISTRICTS,
  ESTATE_INTERACTIONS,
  createEstateInteractionEvent,
  type EstateDistrictId,
  type EstateInteractionEvent
} from "./estateContract";

export interface EstateFallbackWorldProps {
  activeDistrict?: EstateDistrictId;
  onDistrictChange?: (district: EstateDistrictId) => void;
  onInteraction?: (interaction: EstateInteractionEvent) => void;
  reason?: "unavailable" | "context-lost" | "forced";
  paused?: boolean;
  className?: string;
}

const REASON_COPY: Record<
  NonNullable<EstateFallbackWorldProps["reason"]>,
  string
> = {
  unavailable: "3D ist in diesem Browser nicht verfügbar.",
  "context-lost": "Die 3D-Verbindung wurde unterbrochen.",
  forced: "Die räumliche Kompatibilitätsansicht ist für diesen Test aktiv."
};

export function EstateFallbackWorld({
  activeDistrict = "arrival-court",
  onDistrictChange,
  onInteraction,
  reason = "unavailable",
  paused = false,
  className
}: EstateFallbackWorldProps) {
  const classNames = ["estate-fallback", className].filter(Boolean).join(" ");

  return (
    <section
      className={classNames}
      data-estate-fallback={ESTATE_CONTRACT_VERSION}
      data-estate-fallback-reason={reason}
      data-estate-district={activeDistrict}
      data-estate-paused={paused ? "true" : "false"}
      data-estate-world-focus="true"
      tabIndex={-1}
      aria-labelledby="estate-fallback-title"
    >
      <div className="estate-fallback__map">
        <svg
          viewBox="0 0 1000 620"
          role="img"
          aria-labelledby="estate-fallback-map-title estate-fallback-map-copy"
          preserveAspectRatio="xMidYMid meet"
        >
          <title id="estate-fallback-map-title">
            Das vollständige Birdie &amp; Breakfast Grundstück
          </title>
          <desc id="estate-fallback-map-copy">
            Ein zusammenhängendes Grundstück mit Ankunftshof und Hotel in der
            Mitte, Golfplatz links und Reiterhof rechts.
          </desc>
          <defs>
            <linearGradient id="fallback-ground" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#496d52" />
              <stop offset="1" stopColor="#284b38" />
            </linearGradient>
            <linearGradient id="fallback-path" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f1e7d2" />
              <stop offset="1" stopColor="#cbbd9f" />
            </linearGradient>
          </defs>
          <rect width="1000" height="620" rx="34" fill="url(#fallback-ground)" />
          <path
            d="M500 620 L500 365 M500 405 C420 375 320 335 220 275 M500 405 C580 375 680 335 790 275"
            fill="none"
            stroke="url(#fallback-path)"
            strokeWidth="56"
            strokeLinecap="round"
          />
          <path
            d="M125 225 C105 125 185 62 310 84 C390 98 402 182 348 244 C290 310 145 301 125 225Z"
            fill="#6f9b5f"
            stroke="#d7c27a"
            strokeWidth="5"
          />
          <ellipse cx="245" cy="195" rx="80" ry="48" fill="#8db672" />
          <ellipse cx="175" cy="125" rx="42" ry="23" fill="#dfc591" />
          <circle cx="330" cy="112" r="42" fill="#5d91a4" />
          <path
            d="M665 150 L885 150 L910 335 L650 335Z"
            fill="#748957"
            stroke="#e2cfaa"
            strokeWidth="7"
            strokeDasharray="20 12"
          />
          <rect x="690" y="180" width="165" height="106" rx="8" fill="#8a4937" />
          <path d="M675 184 L772 115 L870 184Z" fill="#173226" />
          <rect x="405" y="160" width="190" height="145" rx="8" fill="#c7ab87" />
          <path d="M380 170 L500 75 L620 170Z" fill="#173226" />
          <rect x="470" y="235" width="60" height="70" fill="#2f302d" />
          <circle cx="500" cy="468" r="31" fill="#c7a54a" opacity=".22" />
          <circle cx="500" cy="468" r="12" fill="#f8f3e8" />
          <g fill="#f8f3e8" fontFamily="system-ui, sans-serif" textAnchor="middle">
            <text x="500" y="55" fontSize="24" fontWeight="700">Birdie Hotel</text>
            <text x="228" y="352" fontSize="24" fontWeight="700">Golfplatz</text>
            <text x="777" y="372" fontSize="24" fontWeight="700">Reiterhof</text>
            <text x="500" y="535" fontSize="22" fontWeight="700">Ankunftshof</text>
          </g>
        </svg>
      </div>

      <div className="estate-fallback__content">
        <p className="estate-fallback__eyebrow">Kompatibilitätsansicht</p>
        <h2 id="estate-fallback-title">Die ganze Estate bleibt erreichbar.</h2>
        <p>
          {REASON_COPY[reason]} Hotel, Golfplatz und Reiterhof bleiben als
          zusammenhängende, bedienbare Karte verfügbar.
        </p>

        <nav className="estate-fallback__districts" aria-label="Orte auf dem Grundstück">
          {ESTATE_DISTRICTS.map((district) => (
            <button
              type="button"
              key={district.id}
              aria-pressed={activeDistrict === district.id}
              disabled={paused}
              data-estate-fallback-district={district.id}
              onClick={() => onDistrictChange?.(district.id)}
            >
              <span>{district.eyebrow}</span>
              <strong>{district.label}</strong>
            </button>
          ))}
        </nav>

        <div
          className="estate-fallback__interactions"
          aria-label="Begegnungen in der Kompatibilitätsansicht"
        >
          {ESTATE_INTERACTIONS.map((interaction) => (
            <button
              type="button"
              key={interaction.id}
              data-estate-fallback-interaction={interaction.id}
              disabled={paused}
              onClick={() =>
                onInteraction?.(createEstateInteractionEvent(interaction.id))
              }
            >
              <span>{interaction.speaker}</span>
              <strong>{interaction.prompt}</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
