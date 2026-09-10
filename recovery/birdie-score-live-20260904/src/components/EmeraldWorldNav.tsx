import React from "react";

export type EmeraldWorldNavTarget = "home" | "play" | "scorecard" | "cards" | "progress";

const NAV_ITEMS: readonly { id: EmeraldWorldNavTarget; href: string; label: string; glyph: string }[] = [
  { id: "home", href: "/", label: "Start", glyph: "⌂" },
  { id: "play", href: "/spiel", label: "Spielen", glyph: "⚑" },
  { id: "scorecard", href: "/scorecard", label: "Scorecard", glyph: "≡" },
  { id: "cards", href: "/karten", label: "Karten", glyph: "▱" },
  { id: "progress", href: "/fortschritt", label: "Fortschritt", glyph: "↗" },
];

const CHROME_CSS = `
.bw-global-nav{position:sticky;bottom:max(8px,env(safe-area-inset-bottom));z-index:30;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin:28px auto 0;padding:5px;border:1px solid rgba(219,183,98,.28);border-radius:22px;background:rgba(2,12,7,.88);box-shadow:0 22px 60px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.04);backdrop-filter:blur(18px)}
.bw-global-nav a{min-height:52px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:17px;color:#819786;text-decoration:none;font:700 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;transition:background .18s ease,border-color .18s ease,color .18s ease,transform .18s ease}
.bw-global-nav a:hover{color:#e9dfc4;background:rgba(19,66,41,.42)}
.bw-global-nav a[aria-current=page]{color:#fff0cc;border-color:rgba(234,199,108,.42);background:linear-gradient(140deg,rgba(14,117,73,.82),rgba(7,54,35,.92));box-shadow:0 0 26px rgba(26,181,109,.10),inset 0 1px rgba(255,255,255,.06)}
.bw-global-nav .bw-nav-glyph{display:grid;width:25px;height:25px;place-items:center;border-radius:50%;color:#e3c777;font-size:17px;line-height:1}
.bw-global-nav a:focus-visible{outline:2px solid #f0d890;outline-offset:2px}
@media(max-width:700px){.bw-global-nav{gap:2px;margin-left:-4px;margin-right:-4px;border-radius:20px}.bw-global-nav a{min-height:56px;flex-direction:column;gap:3px;padding:5px 2px;font-size:9px}.bw-global-nav .bw-nav-glyph{height:20px;font-size:16px}}
@media(prefers-reduced-motion:reduce){.bw-global-nav a{transition:none}}
`;

export function EmeraldWorldNav({ active }: { active: EmeraldWorldNavTarget }) {
  return <>
    <style data-birdieworld-chrome="emerald-world-pass-02">{CHROME_CSS}</style>
    <nav className="bw-global-nav" aria-label="BirdieWorld Hauptnavigation" data-authority="presentation-only">
      {NAV_ITEMS.map((item) => <a key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}>
        <span className="bw-nav-glyph" aria-hidden="true">{item.glyph}</span>
        <span>{item.label}</span>
      </a>)}
    </nav>
  </>;
}
