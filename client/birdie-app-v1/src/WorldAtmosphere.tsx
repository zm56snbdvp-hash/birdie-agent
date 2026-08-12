export function WorldAtmosphere() {
  return (
    <div className="world-atmosphere" aria-hidden="true">
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
  );
}
