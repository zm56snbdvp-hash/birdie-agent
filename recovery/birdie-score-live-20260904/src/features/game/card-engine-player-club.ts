import type { CanonicalCard } from "../../domain/card-catalog";
import type { ClubKind, Lie } from "./shot-engine.ts";
import { asString, numberRecord, stringArray, type ClubEngineBinding, type PlayerEngineBinding } from "./card-engine-types.ts";

const ENGINE_KIND_BY_SOURCE_TYPE: Readonly<Record<string, ClubKind>> = {
  DRIVER: "DRIVER",
  "3_WOOD": "HYBRID",
  "5_WOOD": "HYBRID",
  HYBRID: "HYBRID",
  "4_IRON": "HYBRID",
  "7_IRON": "HYBRID",
  "9_IRON": "HYBRID",
  WEDGE_52: "WEDGE",
  WEDGE_58: "WEDGE",
  PITCHING_WEDGE: "WEDGE",
  LOB_WEDGE_60: "WEDGE",
  SAND_WEDGE_54: "WEDGE",
  PUTTER: "PUTTER",
  BLADE_PUTTER: "PUTTER",
  MALLET_PUTTER: "PUTTER",
};

function toLie(value: string): Lie | null {
  return ["TEE", "FAIRWAY", "ROUGH", "BUNKER", "GREEN", "HOLED"].includes(value) ? (value as Lie) : null;
}

export function bindPlayerCard(card: CanonicalCard): PlayerEngineBinding {
  if (card.family !== "PLAYER") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:PLAYER`);
  const stats = numberRecord(card.stats);
  for (const key of ["power", "precision", "control", "recovery", "focus"] as const) {
    if (typeof stats[key] !== "number") throw new Error(`CARD_ENGINE_PLAYER_STAT_MISSING:${card.id}:${key}`);
  }
  return {
    family: "PLAYER",
    status: "EXACT",
    player: { power: stats.power, precision: stats.precision, control: stats.control, recovery: stats.recovery, focus: stats.focus },
    signatureMode: card.id === "BW1-PLY-006" ? "ONE_READ" : "DEFERRED",
    note: card.id === "BW1-PLY-006"
      ? "Base stats and Lee-Ann ONE READ are directly represented by the recovered shot engine."
      : "Base stats are exact; this player's unique signature is not represented by the generic recovered shot-engine input.",
  };
}

export function bindClubCard(card: CanonicalCard): ClubEngineBinding {
  if (card.family !== "CLUB") throw new Error(`CARD_ENGINE_FAMILY_MISMATCH:${card.id}:CLUB`);
  const stats = numberRecord(card.stats);
  const sourceType = asString(card.type);
  const kind = ENGINE_KIND_BY_SOURCE_TYPE[sourceType];
  if (!kind) throw new Error(`CARD_ENGINE_CLUB_KIND_UNKNOWN:${card.id}:${sourceType}`);
  for (const key of ["range", "precision", "control"] as const) {
    if (typeof stats[key] !== "number") throw new Error(`CARD_ENGINE_CLUB_STAT_MISSING:${card.id}:${key}`);
  }
  const allowedLies = stringArray(card.allowedLies).map(toLie).filter((lie): lie is Lie => Boolean(lie));
  return {
    family: "CLUB",
    status: "PROVISIONAL",
    sourceType,
    club: { id: card.id, name: card.name, kind, w: stats.range, p: stats.precision, k: stats.control, allowedLies },
    note: "W/P/K and allowed lies are direct catalog fields. The original server-side mapping from detailed club type to the recovered four engine buckets was not present in browser bundles, so the type bucket remains explicitly provisional.",
  };
}
