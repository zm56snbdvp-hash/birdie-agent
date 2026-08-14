export function WebglFallbackWorld() {
  return (
    <div className="webgl-fallback" data-webgl-fallback="spatial-v0.2">
      <div className="fallback-sky" aria-hidden="true">
        <span className="fallback-sun" />
        <span className="fallback-hill fallback-hill--left" />
        <span className="fallback-hill fallback-hill--right" />
        <span className="fallback-hotel">
          <i className="fallback-roof" />
          <i className="fallback-sign">B&amp;B</i>
          <i className="fallback-window fallback-window--one" />
          <i className="fallback-window fallback-window--two" />
          <i className="fallback-door" />
        </span>
        <span className="fallback-path" />
        <span className="fallback-lantern fallback-lantern--one" />
        <span className="fallback-lantern fallback-lantern--two" />
        <span className="fallback-green"><i /></span>
        <span className="fallback-terrace"><i /><i /><i /></span>
        <span className="fallback-birdie" />
      </div>
      <div className="webgl-fallback__copy">
        <small>Räumliche Kompatibilitätsansicht</small>
        <strong>Das Hotel ist da. Birdie auch.</strong>
        <p>
          3D ist in diesem Browser nicht verfügbar. Ankunftsweg, Putting Green,
          Terrasse und alle drei Ziele bleiben erreichbar.
        </p>
      </div>
    </div>
  );
}
