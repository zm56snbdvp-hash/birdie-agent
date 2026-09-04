export type CardFamily = "PLAYER" | "CLUB" | "BALL" | "SPIN" | "TACTIC" | "COURSE";

export interface CanonicalCardIdentity {
  id: string;
  physicalNumber: string;
  family: CardFamily;
  name: string;
}

export interface ArtworkManifestEntry {
  cardId: string;
  physicalNumber: string;
  family: CardFamily;
  name: string;
  assetPath: string;
  artworkVersion: string;
  verified: boolean;
}

export interface ArtworkResolution {
  status: "VERIFIED" | "MISSING" | "MISMATCH" | "UNVERIFIED";
  assetPath: string | null;
  reason: "CARD_ARTWORK_MISSING" | "CARD_ARTWORK_MISMATCH" | "CARD_ARTWORK_UNVERIFIED" | null;
}

/** Fail-safe replacement for the deployed number-only artwork lookup. */
export function resolveArtwork(
  card: CanonicalCardIdentity,
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
