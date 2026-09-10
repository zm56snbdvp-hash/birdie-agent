import React from "react";

export function EmeraldBoosterPack({ opening = false }: { opening?: boolean }) {
  return <div className={`bw-pack ${opening ? "is-opening" : ""}`} aria-hidden="true">
    <div className="bw-pack-ridge bw-pack-ridge-top"/>
    <div className="bw-pack-face">
      <span className="bw-pack-orbit"/>
      <span className="bw-pack-mark">B</span>
      <p>BIRDIEWORLD</p>
      <strong>FIRST EDITION</strong>
      <small>3 DIGITAL CARDS</small>
    </div>
    <div className="bw-pack-ridge bw-pack-ridge-bottom"/>
  </div>;
}
