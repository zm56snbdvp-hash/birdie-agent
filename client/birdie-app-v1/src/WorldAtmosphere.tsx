import type { CSSProperties } from "react";
import type { BirdieWorldDestination } from "./birdieDestinations";

export type WorldHotspotId = BirdieWorldDestination;

type WorldAtmosphereProps = {
  onOpenHotspot: (hotspot: WorldHotspotId) => void;
  activeHotspot?: WorldHotspotId | null;
};

const markerBase: CSSProperties = {
  position: "absolute",
  zIndex: 5,
  display: "grid",
  gridTemplateColumns: "30px 1fr",
  alignItems: "center",
  gap: 8,
  minWidth: "clamp(132px, 17vw, 184px)",
  padding: "8px 10px",
  borderRadius: 16,
  border: "1px solid rgba(199,165,74,.76)",
  background: "rgba(23,50,38,.84)",
  color: "#f7f3eb",
  boxShadow: "0 8px 26px rgba(23,50,38,.22), inset 0 1px 0 rgba(255,255,255,.08)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  pointerEvents: "auto",
  cursor: "pointer",
  textAlign: "left",
  lineHeight: 1.05,
  transition: "transform .16s ease, box-shadow .16s ease, background .16s ease"
};

const markerIcon: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "rgba(199,165,74,.18)",
  border: "1px solid rgba(199,165,74,.7)",
  color: "#dcc9a4",
  fontSize: 14,
  fontWeight: 800
};

function markerStyle(active: boolean, position: CSSProperties): CSSProperties {
  return {
    ...markerBase,
    ...position,
    transform: active ? "translateY(-3px) scale(1.025)" : "translateY(0) scale(1)",
    background: active ? "rgba(35,71,52,.96)" : markerBase.background,
    boxShadow: active
      ? "0 12px 32px rgba(23,50,38,.3), 0 0 0 3px rgba(199,165,74,.18), inset 0 1px 0 rgba(255,255,255,.1)"
      : markerBase.boxShadow
  };
}

export function WorldAtmosphere({ onOpenHotspot, activeHotspot }: WorldAtmosphereProps) {
  return (
    <div className="world-atmosphere" aria-label="Drei erreichbare Orte in der BirdieWorld">
      <div aria-hidden="true">
        <div className="ambient-cloud cloud-a"><i /><i /><i /></div>
        <div className="ambient-cloud cloud-b"><i /><i /><i /></div>
        <div className="ambient-cloud cloud-c"><i /><i /><i /></div>

        <div className="ambient-steam steam-a"><i /><i /><i /></div>
        <div className="ambient-steam steam-b"><i /><i /><i /></div>

        <div className="ambient-cart">
          <span className="cart-roof" />
          <span className="cart-body" />
          <span className="cart-wheel wheel-left" />
          <span className="cart-wheel wheel-right" />
        </div>

        <svg
          viewBox="0 0 180 110"
          style={{ position: "absolute", right: "4%", bottom: "17%", width: "18%", minWidth: 120, opacity: 0.3 }}
        >
          <g fill="#173226">
            <g>
              <circle cx="54" cy="31" r="7" />
              <rect x="48" y="39" width="12" height="27" rx="6" />
              <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.8;0 0" dur="4.6s" repeatCount="indefinite" />
            </g>
            <g>
              <circle cx="82" cy="29" r="7" />
              <rect x="76" y="37" width="12" height="29" rx="6" />
              <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.2;0 0" dur="5.1s" repeatCount="indefinite" />
            </g>
            <rect x="45" y="67" width="47" height="4" rx="2" />
            <rect x="66" y="69" width="5" height="24" rx="2" />
          </g>
          <circle cx="69" cy="61" r="4" fill="#f7f3eb" opacity=".85" />
        </svg>

        <svg
          viewBox="0 0 220 90"
          style={{ position: "absolute", left: "7%", bottom: "16%", width: "20%", minWidth: 130, opacity: 0.24 }}
        >
          <g fill="#234734">
            <circle cx="24" cy="28" r="6" />
            <rect x="19" y="35" width="10" height="23" rx="5" />
            <rect x="30" y="42" width="29" height="3" rx="1.5" />
            <rect x="52" y="38" width="19" height="3" rx="1.5" />
            <circle cx="58" cy="35" r="4" fill="#c7a54a" />
            <animateTransform attributeName="transform" type="translate" values="0 0;145 0;145 0" keyTimes="0;0.72;1" dur="18s" repeatCount="indefinite" />
          </g>
        </svg>

        <div className="ambient-glow glow-a" />
        <div className="ambient-glow glow-b" />
        <div className="ambient-glow glow-c" />
      </div>

      <button
        type="button"
        className="world-hotspot world-hotspot--golf-history"
        style={markerStyle(activeHotspot === "golf-history", { left: "3.5%", bottom: "31%" })}
        onClick={() => onOpenHotspot("golf-history")}
        aria-label="Golf History am Putting Green öffnen"
      >
        <span style={markerIcon}>01</span>
        <span><strong style={{ display: "block", fontSize: 12 }}>Golf History</strong><small style={{ color: "#dcc9a4", fontSize: 10 }}>Am Putting Green</small></span>
      </button>

      <button
        type="button"
        className="world-hotspot world-hotspot--ball-vault"
        style={markerStyle(activeHotspot === "ball-vault", { left: "43%", top: "25%" })}
        onClick={() => onOpenHotspot("ball-vault")}
        aria-label="Ball Vault im Hotel öffnen"
      >
        <span style={markerIcon}>02</span>
        <span><strong style={{ display: "block", fontSize: 12 }}>Ball Vault</strong><small style={{ color: "#dcc9a4", fontSize: 10 }}>Im Hotel</small></span>
      </button>

      <button
        type="button"
        className="world-hotspot world-hotspot--personal-birdie"
        style={markerStyle(activeHotspot === "personal-birdie", { right: "3.5%", bottom: "29%" })}
        onClick={() => onOpenHotspot("personal-birdie")}
        aria-label="Personal Birdie auf der Terrasse öffnen"
      >
        <span style={markerIcon}>03</span>
        <span><strong style={{ display: "block", fontSize: 12 }}>Personal Birdie</strong><small style={{ color: "#dcc9a4", fontSize: 10 }}>Auf der Terrasse</small></span>
      </button>
    </div>
  );
}
