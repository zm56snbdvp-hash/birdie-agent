import {
  isBirdieWorldDestination,
  type BirdieWorldDestination
} from "./birdieDestinations";

export const BIRDIE_WORLD_CONTEXT_VERSION = "birdie-world-context-v1" as const;
export const BIRDIE_WORLD_CONTEXT_SOURCE = "renderer-projection" as const;
export const BIRDIE_WORLD_CONTEXT_PRECISION = "coarse-zone" as const;

export const BIRDIE_WORLD_ZONE_IDS = [
  "arrival-path",
  "hotel-entrance",
  "putting-green",
  "terrace",
  "hotel-grounds"
] as const;

export type BirdieWorldZone = (typeof BIRDIE_WORLD_ZONE_IDS)[number];

export const THREE_HOTEL_SCENE_ZONES = [
  "Arrival Path",
  "Hotel Entrance",
  "Putting Green",
  "Terrace",
  "Hotel Grounds"
] as const;

export type ThreeHotelSceneZone = (typeof THREE_HOTEL_SCENE_ZONES)[number];

/**
 * Deliberately coarse and transient UI projection.
 *
 * It excludes coordinates, route history, timestamps, account identity,
 * permissions, persistence keys, model authority, internal BirdieOS context,
 * quests, Coin effects, multiplayer state and domain-write capability.
 */
export interface BirdieWorldContextProjection {
  contractVersion: typeof BIRDIE_WORLD_CONTEXT_VERSION;
  source: typeof BIRDIE_WORLD_CONTEXT_SOURCE;
  precision: typeof BIRDIE_WORLD_CONTEXT_PRECISION;
  zone: BirdieWorldZone;
  zoneLabel: ThreeHotelSceneZone;
  suggestedDestination: BirdieWorldDestination | null;
}

export const BIRDIE_WORLD_CONTEXT_ALLOWED_KEYS = [
  "contractVersion",
  "source",
  "precision",
  "zone",
  "zoneLabel",
  "suggestedDestination"
] as const satisfies readonly (keyof BirdieWorldContextProjection)[];

const ZONE_CONTEXT: Readonly<
  Record<
    BirdieWorldZone,
    Pick<BirdieWorldContextProjection, "zoneLabel" | "suggestedDestination">
  >
> = {
  "arrival-path": {
    zoneLabel: "Arrival Path",
    suggestedDestination: "personal-birdie"
  },
  "hotel-entrance": {
    zoneLabel: "Hotel Entrance",
    suggestedDestination: "personal-birdie"
  },
  "putting-green": {
    zoneLabel: "Putting Green",
    suggestedDestination: "golf-history"
  },
  terrace: {
    zoneLabel: "Terrace",
    suggestedDestination: "personal-birdie"
  },
  "hotel-grounds": {
    zoneLabel: "Hotel Grounds",
    suggestedDestination: "ball-vault"
  }
};

export function isBirdieWorldZone(value: unknown): value is BirdieWorldZone {
  return (
    typeof value === "string" &&
    (BIRDIE_WORLD_ZONE_IDS as readonly string[]).includes(value)
  );
}

export function isThreeHotelSceneZone(
  value: unknown
): value is ThreeHotelSceneZone {
  return (
    typeof value === "string" &&
    (THREE_HOTEL_SCENE_ZONES as readonly string[]).includes(value)
  );
}

export function createBirdieWorldContext(
  zone: BirdieWorldZone
): BirdieWorldContextProjection {
  const context = ZONE_CONTEXT[zone];
  return Object.freeze({
    contractVersion: BIRDIE_WORLD_CONTEXT_VERSION,
    source: BIRDIE_WORLD_CONTEXT_SOURCE,
    precision: BIRDIE_WORLD_CONTEXT_PRECISION,
    zone,
    zoneLabel: context.zoneLabel,
    suggestedDestination: context.suggestedDestination
  });
}

export function sceneZoneToBirdieWorldContext(
  zone: ThreeHotelSceneZone
): BirdieWorldContextProjection {
  switch (zone) {
    case "Arrival Path":
      return createBirdieWorldContext("arrival-path");
    case "Hotel Entrance":
      return createBirdieWorldContext("hotel-entrance");
    case "Putting Green":
      return createBirdieWorldContext("putting-green");
    case "Terrace":
      return createBirdieWorldContext("terrace");
    case "Hotel Grounds":
      return createBirdieWorldContext("hotel-grounds");
  }
}

export function isBirdieWorldContextProjection(
  value: unknown
): value is BirdieWorldContextProjection {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== BIRDIE_WORLD_CONTEXT_ALLOWED_KEYS.length ||
    keys.some(
      (key) =>
        !(BIRDIE_WORLD_CONTEXT_ALLOWED_KEYS as readonly string[]).includes(key)
    )
  ) {
    return false;
  }

  if (
    candidate.contractVersion !== BIRDIE_WORLD_CONTEXT_VERSION ||
    candidate.source !== BIRDIE_WORLD_CONTEXT_SOURCE ||
    candidate.precision !== BIRDIE_WORLD_CONTEXT_PRECISION ||
    !isBirdieWorldZone(candidate.zone) ||
    !isThreeHotelSceneZone(candidate.zoneLabel) ||
    !(
      candidate.suggestedDestination === null ||
      isBirdieWorldDestination(candidate.suggestedDestination)
    )
  ) {
    return false;
  }

  const canonical = createBirdieWorldContext(candidate.zone);
  return (
    candidate.zoneLabel === canonical.zoneLabel &&
    candidate.suggestedDestination === canonical.suggestedDestination
  );
}

export const INITIAL_BIRDIE_WORLD_CONTEXT =
  createBirdieWorldContext("arrival-path");
