import type { BirdieWorldDestination } from "./birdieDestinations";

export const ESTATE_CONTRACT_VERSION =
  "birdieworld-immersive-estate-v0.3.4" as const;

export const ESTATE_DISTRICT_IDS = [
  "arrival-court",
  "hotel",
  "golf-course",
  "terrace",
  "stables",
  "estate-grounds"
] as const;

export type EstateDistrictId = (typeof ESTATE_DISTRICT_IDS)[number];

export interface EstateDistrictDefinition {
  id: EstateDistrictId;
  label: string;
  eyebrow: string;
  description: string;
}

/**
 * Coarse, presentation-only places inside the estate renderer. These IDs are
 * not application destinations and grant no data or domain authority.
 */
export const ESTATE_DISTRICTS: readonly EstateDistrictDefinition[] = [
  {
    id: "arrival-court",
    label: "Ankunftshof",
    eyebrow: "Du bist da",
    description: "Der gemeinsame Weg zu Hotel, Golfplatz und Reiterhof."
  },
  {
    id: "hotel",
    label: "Birdie Hotel",
    eyebrow: "Das Herz des Grundstücks",
    description: "Ankommen, orientieren und Birdie jederzeit wiederfinden."
  },
  {
    id: "golf-course",
    label: "Golfplatz",
    eyebrow: "Weite und Spiel",
    description: "Putting Green, Fairways und der Weg zu deiner Golfgeschichte."
  },
  {
    id: "terrace",
    label: "Hotelterrasse",
    eyebrow: "Zwischen Haus und Garten",
    description: "Der vertraute Treffpunkt direkt neben dem Birdie Hotel."
  },
  {
    id: "stables",
    label: "Reiterhof",
    eyebrow: "Ruhiger Hof",
    description: "Stall, Koppel und eine erste, klar begrenzte Begegnung."
  },
  {
    id: "estate-grounds",
    label: "Birdie Gelände",
    eyebrow: "Zwischen den Orten",
    description: "Die verbindenden Wege des großen Birdie-Grundstücks."
  }
] as const;

export const ESTATE_INTERACTION_IDS = [
  "hotel-reception",
  "greenkeeper",
  "stable-guide"
] as const;

export type EstateInteractionId = (typeof ESTATE_INTERACTION_IDS)[number];

export interface EstateInteractionDefinition {
  id: EstateInteractionId;
  district: EstateDistrictId;
  speaker: string;
  title: string;
  prompt: string;
  dialogue: string;
  suggestedDestination: BirdieWorldDestination | null;
}

export interface EstateInteractionEvent {
  contractVersion: typeof ESTATE_CONTRACT_VERSION;
  id: EstateInteractionId;
  district: EstateDistrictId;
  speaker: string;
  title: string;
  dialogue: string;
  suggestedDestination: BirdieWorldDestination | null;
  sessionOnly: true;
}

/**
 * Static, synthetic NPC presentation. It contains no identity, coordinates,
 * timestamps, persistence key, telemetry, account state or write authority.
 */
export const ESTATE_INTERACTIONS: readonly EstateInteractionDefinition[] = [
  {
    id: "hotel-reception",
    district: "hotel",
    speaker: "Mara · Empfang",
    title: "Willkommen im Birdie Hotel",
    prompt: "Mit Mara am Empfang sprechen",
    dialogue:
      "Schön, dass du da bist. Golfplatz und Reiterhof erreichst du über die beiden Gartenwege – und Birdie bleibt überall in Rufweite.",
    suggestedDestination: "personal-birdie"
  },
  {
    id: "greenkeeper",
    district: "golf-course",
    speaker: "Tom · Greenkeeping",
    title: "Am Putting Green",
    prompt: "Mit Tom am Green sprechen",
    dialogue:
      "Hier beginnt der Golfweg. Wenn du deine bisherigen Runden sehen möchtest, führt dich Golf History direkt dorthin.",
    suggestedDestination: "golf-history"
  },
  {
    id: "stable-guide",
    district: "stables",
    speaker: "Lina · Stallteam",
    title: "Am Reiterhof",
    prompt: "Mit Lina am Stall sprechen",
    dialogue:
      "Willkommen am Reiterhof. Heute kannst du Hof und Koppel erkunden; weitere Pferde-Funktionen sind in diesem Pass bewusst noch nicht freigegeben.",
    suggestedDestination: null
  }
] as const;

export type EstateWebglStatus =
  | "initializing"
  | "ready"
  | "unavailable"
  | "context-lost";

export function isEstateDistrictId(value: unknown): value is EstateDistrictId {
  return (
    typeof value === "string" &&
    (ESTATE_DISTRICT_IDS as readonly string[]).includes(value)
  );
}

export function isEstateInteractionId(
  value: unknown
): value is EstateInteractionId {
  return (
    typeof value === "string" &&
    (ESTATE_INTERACTION_IDS as readonly string[]).includes(value)
  );
}

export function getEstateDistrict(
  district: EstateDistrictId
): EstateDistrictDefinition {
  const definition = ESTATE_DISTRICTS.find(
    (candidate) => candidate.id === district
  );
  if (!definition) throw new Error(`Unknown estate district: ${district}`);
  return definition;
}

export function getEstateInteraction(
  interaction: EstateInteractionId
): EstateInteractionDefinition {
  const definition = ESTATE_INTERACTIONS.find(
    (candidate) => candidate.id === interaction
  );
  if (!definition) {
    throw new Error(`Unknown estate interaction: ${interaction}`);
  }
  return definition;
}

export function createEstateInteractionEvent(
  interaction: EstateInteractionId
): EstateInteractionEvent {
  const definition = getEstateInteraction(interaction);
  return Object.freeze({
    contractVersion: ESTATE_CONTRACT_VERSION,
    id: definition.id,
    district: definition.district,
    speaker: definition.speaker,
    title: definition.title,
    dialogue: definition.dialogue,
    suggestedDestination: definition.suggestedDestination,
    sessionOnly: true
  });
}
