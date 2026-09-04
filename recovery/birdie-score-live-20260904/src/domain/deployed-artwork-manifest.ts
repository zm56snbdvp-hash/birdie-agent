import { CARDS } from "./card-catalog";
import type { ArtworkManifestEntry } from "./card-artwork";

/**
 * Every deployed front-art asset was proven to belong to an incompatible
 * legacy catalog. We preserve that state explicitly as UNVERIFIED without
 * carrying the unsafe number-derived JPEG path into maintainable source.
 */
export const DEPLOYED_ARTWORK_ENTRIES: readonly ArtworkManifestEntry[] = CARDS.map((card) => ({
  cardId: card.id,
  physicalNumber: card.physicalNumber,
  family: card.family,
  name: card.name,
  assetPath: "",
  artworkVersion: "LEGACY_UNKNOWN",
  verified: false,
}));

export const DEPLOYED_ARTWORK_MANIFEST = new Map(
  DEPLOYED_ARTWORK_ENTRIES.map((entry) => [entry.cardId, entry] as const),
);
