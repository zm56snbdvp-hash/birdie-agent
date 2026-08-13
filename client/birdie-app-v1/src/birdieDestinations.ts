export const BIRDIE_V1_DESTINATION_IDS = [
  "golf-history",
  "ball-vault",
  "personal-birdie"
] as const;

export type BirdieWorldDestination =
  (typeof BIRDIE_V1_DESTINATION_IDS)[number];

export interface BirdieDestinationDefinition {
  id: BirdieWorldDestination;
  targetId: string;
  eyebrow: string;
  title: string;
  description: string;
  dock: string;
  activeTitle: string;
  activeCopy: string;
}

/**
 * The single presentation-level registry for the three bounded V1 destinations.
 * It does not grant data access or domain authority. Each destination continues
 * to rely on its existing governed adapter/gateway boundary.
 */
export const BIRDIE_V1_DESTINATIONS: readonly BirdieDestinationDefinition[] = [
  {
    id: "golf-history",
    targetId: "golf-history",
    eyebrow: "Deine Geschichte",
    title: "Golf History",
    description: "Runden, Scorecards und die Momente, die geblieben sind.",
    dock: "Bei deiner Golf History",
    activeTitle: "Deine Geschichte ist offen.",
    activeCopy:
      "Ich bleibe hier, während du durch deine Runden und Scorecards gehst."
  },
  {
    id: "ball-vault",
    targetId: "ball-vault",
    eyebrow: "Deine Begleiter",
    title: "Ball Vault",
    description: "Lebende Birdie-Bälle, ihre Pässe und ihre sichere Reise.",
    dock: "Im Ball Vault",
    activeTitle: "Deine Begleiter sind da.",
    activeCopy:
      "Hier leben die Pässe und Reisen deiner eigenen Birdie-Bälle."
  },
  {
    id: "personal-birdie",
    targetId: "personal-birdie",
    eyebrow: "Dein Gespräch",
    title: "Personal Birdie",
    description:
      "Dein eigener Golf-Kontext – ohne interne BirdieOS-Autorität.",
    dock: "Bei Personal Birdie",
    activeTitle: "Ich höre dir zu.",
    activeCopy:
      "Dieser Raum bleibt auf deinen freigegebenen persönlichen Golf-Kontext begrenzt."
  }
] as const;

export const BIRDIE_V1_TARGET_IDS: Readonly<
  Record<BirdieWorldDestination, string>
> = Object.freeze(
  Object.fromEntries(
    BIRDIE_V1_DESTINATIONS.map((destination) => [
      destination.id,
      destination.targetId
    ])
  ) as Record<BirdieWorldDestination, string>
);

export function isBirdieWorldDestination(
  value: unknown
): value is BirdieWorldDestination {
  return (
    typeof value === "string" &&
    (BIRDIE_V1_DESTINATION_IDS as readonly string[]).includes(value)
  );
}

export function getBirdieDestination(
  destination: BirdieWorldDestination
): BirdieDestinationDefinition {
  const definition = BIRDIE_V1_DESTINATIONS.find(
    (candidate) => candidate.id === destination
  );
  if (!definition) {
    throw new Error(`Unknown bounded Birdie destination: ${destination}`);
  }
  return definition;
}
