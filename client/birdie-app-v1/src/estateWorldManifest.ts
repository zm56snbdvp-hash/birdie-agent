import type {
  EstateDistrictId,
  EstateInteractionId
} from "./estateContract";
import manifestJson from "./contracts/birdieworld-estate-handoff-v1.json";

export const ESTATE_WORLD_HANDOFF_VERSION =
  "birdieworld-estate-handoff-v1" as const;

interface InteractionAnchor {
  id: EstateInteractionId;
  x: number;
  z: number;
  radius: number;
}

interface CollisionRectangle {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CollisionCircle {
  id: string;
  x: number;
  z: number;
  radius: number;
}

type TreeInstance = readonly [x: number, z: number, scale: number];

interface DistrictRule {
  kind: "range" | "half-plane" | "fallback";
  axis?: "x" | "z";
  lessThan?: number;
  greaterThan?: number;
  minXInclusive?: number;
  minXExclusive?: number;
  maxXInclusive?: number;
  maxXExclusive?: number;
  minZInclusive?: number;
  minZExclusive?: number;
  maxZInclusive?: number;
  maxZExclusive?: number;
}

export const ESTATE_WORLD_MANIFEST = manifestJson;

if (ESTATE_WORLD_MANIFEST.contractVersion !== ESTATE_WORLD_HANDOFF_VERSION) {
  throw new Error("BirdieWorld estate handoff contract version mismatch");
}

export const ESTATE_WORLD_COLORS = Object.freeze(
  Object.fromEntries(
    Object.entries(ESTATE_WORLD_MANIFEST.visual.palette).map(([token, hex]) => [
      token,
      Number.parseInt(hex.slice(1), 16)
    ])
  ) as Record<keyof typeof ESTATE_WORLD_MANIFEST.visual.palette, number>
);

export const ESTATE_INTERACTION_ANCHORS =
  ESTATE_WORLD_MANIFEST.interactionAnchors as readonly InteractionAnchor[];

export const ESTATE_COLLISION_RECTANGLES =
  ESTATE_WORLD_MANIFEST.collisionShapes.rectangles as readonly CollisionRectangle[];

export const ESTATE_COLLISION_CIRCLES =
  ESTATE_WORLD_MANIFEST.collisionShapes.circles as readonly CollisionCircle[];

export const ESTATE_TREE_INSTANCES =
  ESTATE_WORLD_MANIFEST.treeInstances as unknown as readonly TreeInstance[];

export const ESTATE_DISTRICT_RESOLVERS =
  ESTATE_WORLD_MANIFEST.districts as unknown as readonly {
    id: EstateDistrictId;
    priority: number;
    rule: DistrictRule;
  }[];

export function toUnityPosition(position: {
  x: number;
  y: number;
  z: number;
}) {
  return Object.freeze({ x: position.x, y: position.y, z: -position.z });
}

export function toUnityYawDegrees(canonicalYawDegrees: number) {
  return -canonicalYawDegrees;
}
