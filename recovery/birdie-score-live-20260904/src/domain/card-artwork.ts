import { CARD_BY_ID, type CanonicalCard, type CardFamily } from "./card-catalog";

export type ArtworkVersion = string;

export interface ArtworkManifestEntry {
  cardId: string;
  physicalNumber: string;
  family: CardFamily;
  name: string;
  assetPath: string;
  artworkVersion: ArtworkVersion;
  verified: boolean;
}

export interface ArtworkResolution {
  status: "VERIFIED" | "MISSING" | "MISMATCH" | "UNVERIFIED";
  assetPath: string | null;
  reason: string | null;
}

/**
 * Fail-safe artwork resolver recovered from the live incident.
 *
 * IMPORTANT: Never derive artwork solely from the numeric physical card number.
 * The deployed build did exactly that and silently paired the current BW1 catalog
 * with a legacy First Edition image set.
 */
export function resolveArtwork(
  card: CanonicalCard,
  manifest: ReadonlyMap<string, ArtworkManifestEntry>,
): ArtworkResolution {
  const entry = manifest.get(card.id);
  if (!entry) {
    return { status: "MISSING", assetPath: null, reason: "CARD_ARTWORK_MISSING" };
  }

  const exactIdentity =
    entry.cardId === card.id &&
    entry.physicalNumber === card.physicalNumber &&
    entry.family === card.family &&
    entry.name === card.name;

  if (!exactIdentity) {
    return { status: "MISMATCH", assetPath: null, reason: "CARD_ARTWORK_MISMATCH" };
  }

  if (!entry.verified) {
    return { status: "UNVERIFIED", assetPath: null, reason: "CARD_ARTWORK_UNVERIFIED" };
  }

  return { status: "VERIFIED", assetPath: entry.assetPath, reason: null };
}

export function resolveArtworkById(
  cardId: string,
  manifest: ReadonlyMap<string, ArtworkManifestEntry>,
): ArtworkResolution {
  const card = CARD_BY_ID.get(cardId);
  if (!card) {
    return { status: "MISSING", assetPath: null, reason: "CARD_ID_UNKNOWN" };
  }
  return resolveArtwork(card, manifest);
}
