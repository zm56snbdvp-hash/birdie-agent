import React from "react";
import type { CanonicalCard, CardFamily, CardRarity } from "../domain/card-catalog";
import { CardArtwork } from "./CardArtwork";

const FAMILY_LABEL: Record<CardFamily, string> = {
  PLAYER: "PLAYER", CLUB: "CLUB", BALL: "BALL", SPIN: "SPIN", TACTIC: "TACTIC", COURSE: "COURSE",
};
const RARITY_LABEL: Record<CardRarity, string> = {
  FLOCK: "FLOCK", TOUR: "TOUR", MAJOR: "MAJOR", LEGACY: "LEGACY",
};

export interface EmeraldCardFrameProps {
  card: CanonicalCard;
  compact?: boolean;
  selected?: boolean;
  interactive?: boolean;
  outcome?: "new" | "duplicate" | null;
  className?: string;
}

export function EmeraldCardFrame({ card, compact = false, selected = false, interactive = false, outcome, className = "" }: EmeraldCardFrameProps) {
  const rarity = card.rarity ? RARITY_LABEL[card.rarity] : "FIRST EDITION";
  return <article
    className={`bw-collectible bw-family-${card.family.toLowerCase()} bw-rarity-${(card.rarity ?? "base").toLowerCase()} ${selected ? "is-selected" : ""} ${interactive ? "is-interactive" : ""} ${className}`}
    data-card-family={card.family}
    data-card-rarity={card.rarity ?? "BASE"}
  >
    <div className="bw-collectible-art">
      <CardArtwork id={card.id} physicalNumber={card.physicalNumber} name={card.name} decorative/>
      <span className="bw-collectible-sheen" aria-hidden="true"/>
      <span className="bw-family-sigil" aria-hidden="true">{FAMILY_LABEL[card.family].slice(0, 1)}</span>
      {outcome && <span className={`bw-card-outcome is-${outcome}`}>{outcome === "new" ? "NEW" : "DUPLICATE"}</span>}
    </div>
    <div className="bw-collectible-copy">
      <div className="bw-card-meta flex justify-between gap-2"><span>{FAMILY_LABEL[card.family]}</span><span>{rarity}</span></div>
      <h3 className={compact ? "mt-2 text-sm font-semibold" : "mt-2 text-base font-semibold"}>{card.name}</h3>
      {!compact && <p className="mt-2 text-xs leading-5 text-moss">{String(card.rulesText ?? "")}</p>}
      <div className="mt-3 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[.13em] text-moss"><span>{card.physicalNumber}</span><span>BirdieWorld</span></div>
    </div>
  </article>;
}
