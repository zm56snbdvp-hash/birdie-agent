import React from "react";

export const EMERALD_WORLD_DESIGN_VERSION = "emerald-world-pass-01";

const EMERALD_WORLD_CSS = `
.bw-world {
  --bw-void: #020805;
  --bw-forest: #05130d;
  --bw-panel: rgba(5, 22, 14, .88);
  --bw-panel-strong: rgba(4, 17, 11, .96);
  --bw-emerald: #0b8d5b;
  --bw-emerald-bright: #38d08d;
  --bw-gold: #d8b765;
  --bw-gold-soft: #f0d890;
  --bw-cream: #f2ead5;
  --bw-moss: #94a992;
  --bw-line: rgba(219, 183, 98, .26);
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  overflow-x: hidden;
  color: var(--bw-cream);
  background:
    radial-gradient(110% 80% at 83% -8%, rgba(214, 172, 73, .17), transparent 43%),
    radial-gradient(95% 75% at -12% 33%, rgba(26, 126, 80, .22), transparent 55%),
    linear-gradient(155deg, #07180f 0%, #020805 42%, #06150d 100%);
}
.bw-world::before {
  content: "";
  position: fixed;
  z-index: -2;
  inset: -24vh -18vw;
  pointer-events: none;
  opacity: .74;
  background:
    radial-gradient(70% 22% at 18% 38%, transparent 49%, rgba(39, 104, 61, .30) 50%, rgba(17, 55, 34, .08) 68%, transparent 69%),
    radial-gradient(75% 24% at 88% 58%, transparent 50%, rgba(42, 119, 69, .25) 51%, rgba(5, 33, 19, .10) 70%, transparent 71%),
    radial-gradient(68% 20% at 44% 88%, transparent 50%, rgba(32, 90, 51, .26) 51%, rgba(7, 31, 19, .06) 71%, transparent 72%);
  transform: rotate(-8deg) scale(1.18);
}
.bw-world::after {
  content: "";
  position: fixed;
  z-index: -1;
  inset: 0;
  pointer-events: none;
  opacity: .72;
  background:
    linear-gradient(122deg, transparent 0 31%, rgba(244, 205, 111, 0) 31.1%, rgba(231, 188, 88, .24) 31.35%, rgba(245, 213, 131, .06) 31.55%, transparent 31.85% 100%),
    linear-gradient(164deg, transparent 0 71%, rgba(228, 187, 88, .15) 71.2%, transparent 71.55%);
}
.bw-page {
  width: min(1160px, 100%);
  margin: 0 auto;
  padding: max(22px, env(safe-area-inset-top)) clamp(16px, 3vw, 32px) max(34px, env(safe-area-inset-bottom));
}
.bw-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  border-bottom: 1px solid var(--bw-line);
}
.bw-brand {
  color: var(--bw-gold-soft);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(15px, 2vw, 20px);
  letter-spacing: .22em;
  text-transform: uppercase;
}
.bw-brand small {
  display: block;
  margin-top: 5px;
  color: var(--bw-moss);
  font: 600 8px/1.3 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: .24em;
}
.bw-coin {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--bw-line);
  border-radius: 999px;
  padding: 0 14px;
  color: var(--bw-gold-soft);
  background: rgba(0, 0, 0, .22);
  box-shadow: inset 0 1px rgba(255,255,255,.03);
}
.bw-kicker {
  margin: 0;
  color: var(--bw-gold);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .22em;
  text-transform: uppercase;
}
.bw-title {
  margin: 8px 0 0;
  max-width: 780px;
  color: #fff4dd;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(38px, 7vw, 68px);
  font-weight: 400;
  line-height: .98;
  letter-spacing: -.035em;
}
.bw-copy {
  max-width: 680px;
  margin: 14px 0 0;
  color: #a8b9a6;
  font-size: 14px;
  line-height: 1.75;
}
.bw-hero {
  position: relative;
  overflow: hidden;
  margin-top: 30px;
  padding: clamp(22px, 4vw, 42px);
  border: 1px solid var(--bw-line);
  border-radius: 34px;
  background:
    radial-gradient(80% 90% at 104% 0%, rgba(229, 188, 91, .14), transparent 48%),
    linear-gradient(145deg, rgba(16, 62, 37, .72), rgba(3, 17, 10, .96) 62%);
  box-shadow: 0 28px 80px rgba(0,0,0,.36), inset 0 1px rgba(255,255,255,.04);
}
.bw-hero::before {
  content: "";
  position: absolute;
  width: 72%;
  height: 170%;
  right: -26%;
  top: -44%;
  border-radius: 48% 52% 58% 42% / 38% 38% 62% 62%;
  background:
    linear-gradient(158deg, rgba(95, 151, 63, .25), rgba(9, 43, 24, .58) 58%, rgba(2, 15, 8, .12));
  border-left: 1px solid rgba(239, 203, 111, .34);
  transform: rotate(24deg);
  pointer-events: none;
}
.bw-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--bw-line);
  border-radius: 28px;
  background:
    linear-gradient(145deg, rgba(13, 45, 28, .78), rgba(3, 14, 9, .93) 70%);
  box-shadow: 0 18px 54px rgba(0,0,0,.24), inset 0 1px rgba(255,255,255,.035);
  backdrop-filter: blur(16px);
}
.bw-panel::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 0 72%, rgba(238, 199, 101, .035) 100%);
}
.bw-panel > * { position: relative; z-index: 1; }
.bw-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(219, 183, 98, .30);
  border-radius: 20px;
  background:
    radial-gradient(80% 70% at 75% 5%, rgba(41, 145, 89, .14), transparent 58%),
    linear-gradient(155deg, #0b2818, #030d08 72%);
  box-shadow: 0 14px 36px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.035);
}
.bw-card::before {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(242, 208, 120, .04);
}
.bw-card-meta {
  color: var(--bw-gold);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .16em;
  text-transform: uppercase;
}
.bw-segment {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(118px, 1fr);
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--bw-line);
  border-radius: 999px;
  background: rgba(0, 0, 0, .24);
}
.bw-segment button {
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  padding: 0 18px;
  color: #92a693;
  background: transparent;
  font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
}
.bw-segment button[aria-pressed="true"] {
  color: #fff4dc;
  background: linear-gradient(130deg, #0b7f51, #095b3d 65%, #133c2a);
  box-shadow: inset 0 0 0 1px rgba(236, 204, 121, .40), 0 0 28px rgba(21, 176, 107, .12);
}
.bw-gold-button {
  display: inline-flex;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 229, 159, .78);
  border-radius: 15px;
  padding: 0 21px;
  color: #102217;
  background: linear-gradient(115deg, #f1d88f, #c7a954 56%, #ebd184);
  box-shadow: 0 12px 36px rgba(196, 157, 66, .16), inset 0 1px rgba(255,255,255,.52);
  font-weight: 800;
}
.bw-gold-button:disabled { opacity: .48; cursor: default; }
.bw-emerald-button {
  display: inline-flex;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(238, 208, 124, .42);
  border-radius: 15px;
  padding: 0 21px;
  color: #f7efdc;
  background: linear-gradient(135deg, #0b8958, #075035 70%);
  box-shadow: 0 12px 34px rgba(9, 122, 76, .18), inset 0 1px rgba(255,255,255,.08);
  font-weight: 800;
}
.bw-progress {
  height: 9px;
  overflow: hidden;
  border: 1px solid rgba(219, 183, 98, .18);
  border-radius: 999px;
  background: rgba(0,0,0,.38);
}
.bw-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0b7f51, #38ce8a 70%, #ddbd67);
  box-shadow: 0 0 20px rgba(41, 207, 135, .18);
}
.bw-booster-stage {
  position: relative;
  display: grid;
  min-height: 340px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--bw-line);
  border-radius: 28px;
  background:
    radial-gradient(circle at 50% 50%, rgba(34, 177, 106, .18), transparent 34%),
    radial-gradient(circle at 50% 52%, rgba(224, 183, 83, .08), transparent 54%),
    linear-gradient(145deg, #071d12, #020805);
}
.bw-booster-stage::before,
.bw-booster-stage::after {
  content: "";
  position: absolute;
  width: 150%;
  height: 54%;
  left: -24%;
  border-radius: 50%;
  border: 1px solid rgba(219, 183, 98, .16);
  background: linear-gradient(180deg, rgba(34, 105, 62, .18), rgba(3, 14, 8, .05));
  transform: rotate(-10deg);
}
.bw-booster-stage::before { top: -18%; }
.bw-booster-stage::after { bottom: -23%; transform: rotate(7deg); }
.bw-booster-stage > * { position: relative; z-index: 1; }
.bw-status-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.bw-status-chip {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bw-line);
  border-radius: 14px;
  padding: 8px 10px;
  color: #aebca8;
  background: rgba(2, 11, 7, .58);
  font-size: 12px;
  text-align: center;
}
.bw-select {
  border-color: rgba(231, 195, 103, .62) !important;
  background: linear-gradient(145deg, rgba(19, 83, 50, .40), rgba(3, 15, 9, .78)) !important;
  box-shadow: 0 0 0 1px rgba(232, 196, 105, .07), 0 0 28px rgba(15, 147, 87, .10);
}
.bw-course-frame {
  position: relative;
  overflow: hidden;
  margin: 22px 0;
  border: 1px solid rgba(232, 195, 103, .42);
  border-radius: 30px;
  background: #05170f;
  box-shadow: 0 28px 86px rgba(0,0,0,.40), inset 0 1px rgba(255,255,255,.035);
}
.bw-course-frame::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 80px rgba(0,0,0,.25);
}
.bw-course-caption {
  position: relative;
  z-index: 2;
  margin-top: -1px;
  padding: 14px 18px 16px;
  border-top: 1px solid rgba(231, 195, 103, .18);
  color: #ded8bf;
  background: linear-gradient(180deg, rgba(4,18,11,.94), rgba(2,10,6,.98));
  font-size: 12px;
  line-height: 1.6;
}
.bw-game-card-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 12px;
}
.bw-note {
  color: #819785;
  font-size: 11px;
  line-height: 1.55;
}
@media (max-width: 700px) {
  .bw-page { padding-left: 14px; padding-right: 14px; }
  .bw-topbar { align-items: flex-start; }
  .bw-brand { font-size: 14px; letter-spacing: .18em; }
  .bw-title { font-size: clamp(36px, 13vw, 54px); }
  .bw-hero { border-radius: 26px; padding: 22px 18px; }
  .bw-panel { border-radius: 22px; }
  .bw-segment { display: grid; width: 100%; }
  .bw-status-strip { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .bw-world *, .bw-world *::before, .bw-world *::after {
    scroll-behavior: auto !important;
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

export function EmeraldWorldSkin() {
  return <style data-birdieworld-design={EMERALD_WORLD_DESIGN_VERSION}>{EMERALD_WORLD_CSS}</style>;
}
