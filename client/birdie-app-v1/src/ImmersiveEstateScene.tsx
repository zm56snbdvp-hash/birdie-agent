import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EstateFallbackWorld } from "./EstateFallbackWorld";
import type { EstateAvatarStyleId } from "./avatarStyle";
import {
  ESTATE_CONTRACT_VERSION,
  createEstateInteractionEvent,
  getEstateDistrict,
  getEstateInteraction,
  type EstateDistrictId,
  type EstateInteractionDefinition,
  type EstateInteractionEvent,
  type EstateInteractionId,
  type EstateWebglStatus
} from "./estateContract";

type MovementDirection = "forward" | "back" | "left" | "right";

const DRAG_DEAD_ZONE = 10;
const DRAG_MAX_RADIUS = 72;
const CAMERA_SAMPLE_STEP = 0.45;

export interface ImmersiveEstateSceneProps {
  onDistrictChange?: (district: EstateDistrictId) => void;
  onInteraction?: (interaction: EstateInteractionEvent) => void;
  onNearbyInteractionChange?: (
    interaction: EstateInteractionDefinition | null
  ) => void;
  onWebglStatusChange?: (status: EstateWebglStatus) => void;
  forceFallback?: boolean;
  paused?: boolean;
  avatarStyle?: EstateAvatarStyleId;
  className?: string;
}

interface PrivateInteractionPoint {
  id: EstateInteractionId;
  x: number;
  z: number;
  radius: number;
}

interface CollisionRectangle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CollisionCircle {
  x: number;
  z: number;
  radius: number;
}

const COLORS = {
  forestDeep: 0x132c20,
  forest: 0x244b32,
  forestLight: 0x567846,
  grass: 0x506f3e,
  fairway: 0x78a253,
  green: 0x91b968,
  cream: 0xf7f1e5,
  path: 0xd6c39f,
  pathEdge: 0x9e8a68,
  gold: 0xc7a54a,
  hotel: 0xb8a187,
  roof: 0x292d28,
  stable: 0x874b39,
  stableTrim: 0xe6d5ba,
  wood: 0x6d4d37,
  water: 0x376b70,
  sand: 0xdcc590,
  charcoal: 0x2f302d,
  warmLight: 0xffc876,
  sky: 0xd89d68
} as const;

const PRIVATE_INTERACTION_POINTS: readonly PrivateInteractionPoint[] = [
  { id: "hotel-reception", x: 0, z: -8.2, radius: 8.5 },
  { id: "greenkeeper", x: -42, z: 5, radius: 8.5 },
  { id: "stable-guide", x: 41, z: -4.5, radius: 8.5 }
] as const;

const BUILDING_COLLISIONS: readonly CollisionRectangle[] = [
  { minX: -22.6, maxX: 22.6, minZ: -32.6, maxZ: -13.2 },
  { minX: 29.2, maxX: 54.8, minZ: -25.8, maxZ: -9.2 }
] as const;

const ROUND_COLLISIONS: readonly CollisionCircle[] = [
  { x: -33, z: -21, radius: 8.5 }
] as const;

const TREE_POSITIONS = [
  [-65, -46, 1.4], [-58, -43, 1.0], [-49, -49, 1.3], [-38, -47, 0.9],
  [-25, -50, 1.2], [-12, -49, 1.0], [9, -49, 1.2], [21, -48, 0.95],
  [36, -48, 1.25], [52, -46, 1.0], [64, -42, 1.35], [66, -28, 1.0],
  [65, -12, 1.15], [65, 8, 1.0], [66, 24, 1.2], [63, 42, 1.0],
  [54, 51, 1.3], [40, 50, 0.9], [26, 52, 1.1], [12, 51, 0.85],
  [-14, 52, 0.9], [-29, 52, 1.2], [-44, 50, 1.0], [-57, 48, 1.3],
  [-65, 37, 1.0], [-66, 21, 1.2], [-65, 4, 1.0], [-66, -14, 1.25],
  [-57, -29, 0.9], [-49, 34, 0.8], [-38, 39, 0.9], [31, 38, 0.85],
  [46, 36, 0.95], [-18, 24, 0.78], [18, 24, 0.8], [-21, -34, 0.9],
  [20, -35, 0.9], [-57, -35, 1.05], [-44, -38, 0.88], [-30, -41, 1.0],
  [-16, -43, 0.82], [17, -43, 0.86], [31, -40, 1.05], [45, -37, 0.9],
  [57, -32, 1.1], [-56, 8, 0.82], [-53, 28, 0.94], [-41, 34, 0.8],
  [36, 3, 0.72], [52, 2, 0.86], [18, 1, 0.68], [-17, 2, 0.72],
  [-28, -29, 0.76], [25, -30, 0.7], [8, -39, 0.65], [-7, -40, 0.7]
] as const;

function createWebglRenderTarget() {
  const canvas = document.createElement("canvas");
  try {
    const context = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      powerPreference: "high-performance"
    });
    return context ? { canvas, context } : null;
  } catch {
    return null;
  }
}

function keyToDirection(key: string): MovementDirection | null {
  const normalized = key.toLowerCase();
  if (key === "ArrowUp" || normalized === "w") return "forward";
  if (key === "ArrowDown" || normalized === "s") return "back";
  if (key === "ArrowLeft" || normalized === "a") return "left";
  if (key === "ArrowRight" || normalized === "d") return "right";
  return null;
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, button, a, [contenteditable='true'], [role='dialog']"
      )
    )
  );
}

function identifyDistrict(x: number, z: number): EstateDistrictId {
  if (z > 30 && Math.abs(x) < 18) return "arrival-court";
  if (x < -18) return "golf-course";
  if (x >= 14 && x <= 24 && z >= -20 && z <= -7) return "terrace";
  if (x > 20) return "stables";
  if (Math.abs(x) < 18 && z < 24) return "hotel";
  return "estate-grounds";
}

function isBlocked(x: number, z: number) {
  if (
    BUILDING_COLLISIONS.some(
      (rect) =>
        x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ
    )
  ) {
    return true;
  }

  return ROUND_COLLISIONS.some(
    (circle) => Math.hypot(x - circle.x, z - circle.z) < circle.radius
  );
}

function resolveCameraDistance(
  avatarX: number,
  avatarZ: number,
  backwardX: number,
  backwardZ: number,
  desiredDistance: number
) {
  let lastClearDistance = 0;
  for (
    let distance = CAMERA_SAMPLE_STEP;
    distance <= desiredDistance;
    distance += CAMERA_SAMPLE_STEP
  ) {
    const x = avatarX + backwardX * distance;
    const z = avatarZ + backwardZ * distance;
    const blockedByBuilding = BUILDING_COLLISIONS.some(
      (rect) =>
        x > rect.minX - 0.8 &&
        x < rect.maxX + 0.8 &&
        z > rect.minZ - 0.8 &&
        z < rect.maxZ + 0.8
    );
    if (blockedByBuilding) {
      return Math.max(0, lastClearDistance - 0.1);
    }
    lastClearDistance = distance;
  }
  return desiredDistance;
}

function resolveMovement(
  previousX: number,
  previousZ: number,
  requestedX: number,
  requestedZ: number
) {
  let x = THREE.MathUtils.clamp(requestedX, -67, 67);
  let z = THREE.MathUtils.clamp(requestedZ, -52, 53);

  if (isBlocked(x, previousZ)) x = previousX;
  if (isBlocked(x, z)) z = previousZ;
  return { x, z };
}

function nearestInteraction(x: number, z: number): EstateInteractionId | null {
  let nearest: PrivateInteractionPoint | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of PRIVATE_INTERACTION_POINTS) {
    const distance = Math.hypot(x - point.x, z - point.z);
    if (distance <= point.radius && distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest?.id ?? null;
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

interface SceneMaterials {
  grass: THREE.MeshStandardMaterial;
  meadowDark: THREE.MeshStandardMaterial;
  meadowLight: THREE.MeshStandardMaterial;
  fairway: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  path: THREE.MeshStandardMaterial;
  pathEdge: THREE.MeshStandardMaterial;
  hotel: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  cream: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  charcoal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  stable: THREE.MeshStandardMaterial;
  stableTrim: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  waterEdge: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  flowerWhite: THREE.MeshStandardMaterial;
  flowerGold: THREE.MeshStandardMaterial;
  flowerViolet: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageLight: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  warmLight: THREE.MeshStandardMaterial;
}

function createMaterials(): SceneMaterials {
  return {
    grass: new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 1 }),
    meadowDark: new THREE.MeshStandardMaterial({ color: 0x36583a, roughness: 1 }),
    meadowLight: new THREE.MeshStandardMaterial({ color: 0x688b4a, roughness: 1 }),
    fairway: new THREE.MeshStandardMaterial({ color: COLORS.fairway, roughness: 1 }),
    green: new THREE.MeshStandardMaterial({ color: COLORS.green, roughness: 1 }),
    path: new THREE.MeshStandardMaterial({ color: COLORS.path, roughness: 1 }),
    pathEdge: new THREE.MeshStandardMaterial({ color: COLORS.pathEdge, roughness: 1 }),
    hotel: new THREE.MeshStandardMaterial({ color: COLORS.hotel, roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.93 }),
    cream: new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: 0.82 }),
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.72 }),
    charcoal: new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.86 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x483823,
      emissive: COLORS.warmLight,
      emissiveIntensity: 0.35,
      roughness: 0.32
    }),
    stable: new THREE.MeshStandardMaterial({ color: COLORS.stable, roughness: 0.95 }),
    stableTrim: new THREE.MeshStandardMaterial({ color: COLORS.stableTrim, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.98 }),
    water: new THREE.MeshStandardMaterial({
      color: COLORS.water,
      roughness: 0.2,
      metalness: 0.08
    }),
    waterEdge: new THREE.MeshStandardMaterial({ color: 0x263e34, roughness: 1 }),
    sand: new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8f8778, roughness: 0.98 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x59605a, roughness: 1 }),
    flowerWhite: new THREE.MeshStandardMaterial({ color: 0xf4ead7, roughness: 0.9 }),
    flowerGold: new THREE.MeshStandardMaterial({ color: 0xd7aa42, roughness: 0.9 }),
    flowerViolet: new THREE.MeshStandardMaterial({ color: 0x80658f, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5d4334, roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({ color: COLORS.forestDeep, roughness: 1 }),
    foliageLight: new THREE.MeshStandardMaterial({ color: COLORS.forestLight, roughness: 1 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc99973, roughness: 0.88 }),
    warmLight: new THREE.MeshStandardMaterial({
      color: COLORS.warmLight,
      emissive: COLORS.warmLight,
      emissiveIntensity: 1.15,
      roughness: 0.42
    })
  };
}

function addPathSegment(
  scene: THREE.Scene,
  materials: SceneMaterials,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  width: number
) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.055, width + 0.72),
    materials.pathEdge
  );
  const path = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.065, width),
    materials.path
  );
  const angle = -Math.atan2(dz, dx);
  for (const [mesh, height] of [
    [edge, 0.025],
    [path, 0.06]
  ] as const) {
    mesh.position.set((fromX + toX) / 2, height, (fromZ + toZ) / 2);
    mesh.rotation.y = angle;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function addLandscapeEllipse(
  scene: THREE.Scene,
  material: THREE.Material,
  x: number,
  z: number,
  radiusX: number,
  radiusZ: number,
  height = 0.045,
  rotation = 0
) {
  const ellipse = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    material
  );
  ellipse.rotation.x = -Math.PI / 2;
  ellipse.rotation.y = rotation;
  ellipse.scale.set(radiusX, radiusZ, 1);
  ellipse.position.set(x, height, z);
  ellipse.receiveShadow = true;
  scene.add(ellipse);
  return ellipse;
}

function addWaterLandscape(
  scene: THREE.Scene,
  materials: SceneMaterials,
  qualityShadows: boolean
) {
  addLandscapeEllipse(scene, materials.waterEdge, 26, -43, 28, 15.5, 0.025, -0.08);
  addLandscapeEllipse(scene, materials.water, 26, -43, 25.7, 13.3, 0.06, -0.08);
  addLandscapeEllipse(scene, materials.grass, 29, -44, 4.5, 3.2, 0.09, 0.2);
  addLandscapeEllipse(scene, materials.meadowLight, 29, -44, 3.4, 2.4, 0.1, 0.2);

  const creekPoints = [
    [-26, 48, 4.6, 2.2, -0.42],
    [-31, 43, 5.5, 2.4, -0.58],
    [-37, 39, 5.6, 2.1, -0.7],
    [-43, 36, 4.8, 1.9, -0.72]
  ] as const;
  creekPoints.forEach(([x, z, radiusX, radiusZ, rotation]) => {
    addLandscapeEllipse(
      scene,
      materials.water,
      x,
      z,
      radiusX,
      radiusZ,
      0.065,
      rotation
    );
  });

  const bridge = new THREE.Group();
  for (const x of [-2.2, -1.1, 0, 1.1, 2.2]) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.2, 5.8),
      materials.wood
    );
    plank.position.set(x, 0.32, 0);
    plank.castShadow = qualityShadows;
    bridge.add(plank);
  }
  bridge.position.set(-30, 0, 45);
  bridge.rotation.y = -0.48;
  scene.add(bridge);
}

function addGardenDetails(
  scene: THREE.Scene,
  materials: SceneMaterials,
  qualityShadows: boolean
) {
  const shrubPositions = [
    [-11, -9, 1.1], [-8, -7, 0.8], [8, -7, 0.82], [11, -9, 1.1],
    [-14, 16, 0.9], [-11, 19, 0.72], [11, 19, 0.72], [14, 16, 0.9],
    [-9, 31, 0.74], [9, 31, 0.74], [-20, -10, 0.82], [25, -8, 0.8],
    [-34, 11, 0.74], [-48, 10, 0.8], [31, 9, 0.76], [52, 9, 0.8]
  ] as const;
  const shrubGeometry = new THREE.IcosahedronGeometry(0.85, 1);
  const shrubs = new THREE.InstancedMesh(
    shrubGeometry,
    materials.foliageLight,
    shrubPositions.length
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  shrubPositions.forEach(([x, z, shrubScale], index) => {
    position.set(x, 0.72 * shrubScale, z);
    scale.set(shrubScale * 1.35, shrubScale, shrubScale);
    matrix.compose(position, rotation, scale);
    shrubs.setMatrixAt(index, matrix);
  });
  shrubs.instanceMatrix.needsUpdate = true;
  shrubs.castShadow = qualityShadows;
  shrubs.receiveShadow = true;
  scene.add(shrubs);

  const flowerPositions = [
    [-12.5, 12], [-10.8, 13.2], [-9.4, 11.7], [9.2, 11.8], [10.8, 13.2],
    [12.4, 12], [-8.8, 29.5], [-7.6, 30.8], [7.6, 30.8], [8.8, 29.5],
    [-19.6, -8.7], [-18.4, -7.8], [23.8, -7.7], [25.1, -8.8]
  ] as const;
  const flowerMaterials = [
    materials.flowerWhite,
    materials.flowerGold,
    materials.flowerViolet
  ] as const;
  flowerPositions.forEach(([x, z], index) => {
    const flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 7, 5),
      flowerMaterials[index % flowerMaterials.length]
    );
    flower.position.set(x, 0.28, z);
    flower.castShadow = qualityShadows;
    scene.add(flower);
  });
}

function addDistantRidge(
  scene: THREE.Scene,
  materials: SceneMaterials
) {
  const ridge = [
    [-65, -63, 17, 11, 9], [-48, -66, 15, 14, 10], [-28, -67, 18, 12, 11],
    [53, -67, 16, 12, 10], [68, -63, 19, 15, 11]
  ] as const;
  ridge.forEach(([x, z, sx, sy, sz]) => {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      materials.rock
    );
    rock.position.set(x, sy * 0.38, z);
    rock.scale.set(sx, sy, sz);
    rock.rotation.set(0.1, x * 0.01, -0.08);
    rock.receiveShadow = true;
    scene.add(rock);
  });
}

function addInstancedTrees(
  scene: THREE.Scene,
  materials: SceneMaterials,
  castShadow: boolean
) {
  const trunkGeometry = new THREE.CylinderGeometry(0.35, 0.48, 4.4, 7);
  const crownGeometry = new THREE.IcosahedronGeometry(1.8, 1);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    materials.trunk,
    TREE_POSITIONS.length
  );
  const darkCrowns = new THREE.InstancedMesh(
    crownGeometry,
    materials.foliage,
    TREE_POSITIONS.length * 3
  );
  const lightCrowns = new THREE.InstancedMesh(
    crownGeometry,
    materials.foliageLight,
    TREE_POSITIONS.length
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const meshScale = new THREE.Vector3();
  const darkCrownOffsets = [
    [0, 5.1, 0, 1.0],
    [-1.05, 4.5, 0.2, 0.78],
    [0.1, 5.95, 0.05, 0.72]
  ] as const;
  const lightCrownOffset = [1.0, 4.55, -0.05, 0.82] as const;
  let darkIndex = 0;

  TREE_POSITIONS.forEach(([x, z, scale], treeIndex) => {
    position.set(x, 2.2 * scale, z);
    meshScale.setScalar(scale);
    matrix.compose(position, rotation, meshScale);
    trunks.setMatrixAt(treeIndex, matrix);

    darkCrownOffsets.forEach(([cx, cy, cz, crownScale]) => {
      position.set(x + cx * scale, cy * scale, z + cz * scale);
      meshScale.setScalar(scale * crownScale);
      matrix.compose(position, rotation, meshScale);
      darkCrowns.setMatrixAt(darkIndex, matrix);
      darkIndex += 1;
    });

    const [cx, cy, cz, crownScale] = lightCrownOffset;
    position.set(x + cx * scale, cy * scale, z + cz * scale);
    meshScale.setScalar(scale * crownScale);
    matrix.compose(position, rotation, meshScale);
    lightCrowns.setMatrixAt(treeIndex, matrix);
  });

  for (const mesh of [trunks, darkCrowns, lightCrowns]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    scene.add(mesh);
  }
}

function addFence(
  scene: THREE.Scene,
  materials: SceneMaterials,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  const angle = -Math.atan2(dz, dx);
  for (const height of [0.75, 1.45]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.12, 0.12),
      materials.stableTrim
    );
    rail.position.set((fromX + toX) / 2, height, (fromZ + toZ) / 2);
    rail.rotation.y = angle;
    rail.castShadow = true;
    scene.add(rail);
  }
  const posts = Math.max(2, Math.ceil(length / 4));
  for (let index = 0; index <= posts; index += 1) {
    const t = index / posts;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 1.9, 0.25),
      materials.stableTrim
    );
    post.position.set(fromX + dx * t, 0.95, fromZ + dz * t);
    post.castShadow = true;
    scene.add(post);
  }
}

function makeAvatar(
  materials: SceneMaterials,
  avatarStyle: EstateAvatarStyleId,
  castShadow: boolean
) {
  const shirtMaterial = avatarStyle === "clubhouse"
    ? materials.cream
    : avatarStyle === "after-hours"
      ? materials.charcoal
      : materials.foliage;
  const accentMaterial = avatarStyle === "clubhouse"
    ? materials.foliage
    : materials.gold;
  const group = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.46, 1.05, 5, 10),
    shirtMaterial
  );
  torso.position.y = 1.45;
  torso.castShadow = castShadow;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 14, 10),
    materials.skin
  );
  head.position.y = 2.5;
  head.castShadow = castShadow;
  group.add(head);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    accentMaterial
  );
  cap.position.y = 2.72;
  group.add(cap);
  const capBrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.54, 0.07, 0.3),
    accentMaterial
  );
  capBrim.position.set(0, 2.67, -0.35);
  capBrim.castShadow = castShadow;
  group.add(capBrim);

  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.2, 0.95, 0);
  rightLeg.position.set(0.2, 0.95, 0);
  group.add(leftLeg, rightLeg);
  [leftLeg, rightLeg].forEach((pivot) => {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.13, 0.65, 4, 8),
      materials.charcoal
    );
    leg.position.y = -0.42;
    leg.castShadow = castShadow;
    pivot.add(leg);
  });

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-0.5, 1.85, 0);
  rightArm.position.set(0.5, 1.85, 0);
  group.add(leftArm, rightArm);
  [leftArm, rightArm].forEach((pivot) => {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.11, 0.58, 4, 8),
      shirtMaterial
    );
    arm.position.y = -0.31;
    arm.castShadow = castShadow;
    pivot.add(arm);
  });

  group.position.set(0, 0.08, 46);
  group.rotation.y = 0;
  return { group, torso, leftLeg, rightLeg, leftArm, rightArm };
}

function makeNpc(
  materials: SceneMaterials,
  shirt: THREE.Material,
  hat: THREE.Material,
  x: number,
  z: number,
  rotation: number,
  castShadow: boolean
) {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.92, 5, 9),
    shirt
  );
  torso.position.y = 1.35;
  torso.castShadow = castShadow;
  group.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 9),
    materials.skin
  );
  head.position.y = 2.3;
  head.castShadow = castShadow;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.18, 10), hat);
  cap.position.y = 2.58;
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.28), hat);
  brim.position.set(0, 2.52, -0.28);
  group.add(brim);
  group.position.set(x, 0.08, z);
  group.rotation.y = rotation;
  return group;
}

function makeHorse(
  materials: SceneMaterials,
  x: number,
  z: number,
  rotation: number
) {
  const horse = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0x76523c, roughness: 0.96 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.4, 5, 10), coat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.55;
  horse.add(body);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), coat);
  neck.rotation.z = -0.45;
  neck.position.set(-0.8, 2.0, 0);
  horse.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.58, 0.52), coat);
  head.position.set(-1.28, 2.52, 0);
  horse.add(head);
  for (const legX of [-0.62, 0.62]) {
    for (const legZ of [-0.36, 0.36]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.1, 1.25, 7),
        materials.charcoal
      );
      leg.position.set(legX, 0.7, legZ);
      horse.add(leg);
    }
  }
  horse.position.set(x, 0, z);
  horse.rotation.y = rotation;
  return horse;
}

function makeBirdie(materials: SceneMaterials) {
  const birdie = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 9),
    materials.gold
  );
  body.scale.set(1.1, 0.82, 1.35);
  birdie.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 11, 8),
    materials.cream
  );
  head.position.set(0, 0.12, -0.25);
  birdie.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), materials.gold);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.1, -0.43);
  birdie.add(beak);
  const leftWing = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 5), materials.foliage);
  const rightWing = leftWing.clone();
  leftWing.position.x = -0.25;
  rightWing.position.x = 0.25;
  leftWing.rotation.z = Math.PI / 2;
  rightWing.rotation.z = -Math.PI / 2;
  birdie.add(leftWing, rightWing);
  return { birdie, leftWing, rightWing };
}

export function ImmersiveEstateScene({
  onDistrictChange,
  onInteraction,
  onNearbyInteractionChange,
  onWebglStatusChange,
  forceFallback = false,
  paused = false,
  avatarStyle = "fairway",
  className
}: ImmersiveEstateSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const heldRef = useRef<Set<MovementDirection>>(new Set());
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgeDirectionRef = useRef<MovementDirection | null>(null);
  const pausedRef = useRef(paused);
  const districtRef = useRef<EstateDistrictId>("arrival-court");
  const nearbyIdRef = useRef<EstateInteractionId | null>(null);
  const triggerInteractionRef = useRef<() => void>(() => undefined);
  const endDragRef = useRef<() => void>(() => undefined);
  const updatePausedLoopRef = useRef<(nextPaused: boolean) => void>(() => undefined);
  const onDistrictChangeRef = useRef(onDistrictChange);
  const onInteractionRef = useRef(onInteraction);
  const onNearbyInteractionChangeRef = useRef(onNearbyInteractionChange);
  const onWebglStatusChangeRef = useRef(onWebglStatusChange);

  const [district, setDistrict] = useState<EstateDistrictId>("arrival-court");
  const [nearbyInteraction, setNearbyInteraction] =
    useState<EstateInteractionDefinition | null>(null);
  const [lastInteractionId, setLastInteractionId] =
    useState<EstateInteractionId | null>(null);
  const [interactionAnnouncement, setInteractionAnnouncement] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [dragHintVisible, setDragHintVisible] = useState(true);
  const [webglStatus, setWebglStatus] = useState<EstateWebglStatus>(
    forceFallback ? "unavailable" : "initializing"
  );

  useEffect(() => {
    onDistrictChangeRef.current = onDistrictChange;
  }, [onDistrictChange]);

  useEffect(() => {
    onInteractionRef.current = onInteraction;
  }, [onInteraction]);

  useEffect(() => {
    onNearbyInteractionChangeRef.current = onNearbyInteractionChange;
  }, [onNearbyInteractionChange]);

  useEffect(() => {
    onWebglStatusChangeRef.current = onWebglStatusChange;
  }, [onWebglStatusChange]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      heldRef.current.clear();
      endDragRef.current();
    }
    updatePausedLoopRef.current(paused);
  }, [paused]);

  useEffect(
    () => () => {
      if (nudgeTimerRef.current !== null) {
        window.clearTimeout(nudgeTimerRef.current);
      }
      if (nudgeDirectionRef.current) {
        heldRef.current.delete(nudgeDirectionRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const publishStatus = (status: EstateWebglStatus) => {
      setWebglStatus(status);
      onWebglStatusChangeRef.current?.(status);
    };
    const publishDistrict = (nextDistrict: EstateDistrictId) => {
      districtRef.current = nextDistrict;
      setDistrict(nextDistrict);
      onDistrictChangeRef.current?.(nextDistrict);
    };
    const publishNearby = (interactionId: EstateInteractionId | null) => {
      nearbyIdRef.current = interactionId;
      const definition = interactionId
        ? getEstateInteraction(interactionId)
        : null;
      setNearbyInteraction(definition);
      onNearbyInteractionChangeRef.current?.(definition);
    };

    publishDistrict("arrival-court");
    publishNearby(null);

    if (forceFallback) {
      publishStatus("unavailable");
      triggerInteractionRef.current = () => undefined;
      return;
    }

    publishStatus("initializing");
    const renderTarget = createWebglRenderTarget();
    if (!renderTarget) {
      publishStatus("unavailable");
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: renderTarget.canvas,
        context: renderTarget.context,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
      });
    } catch {
      renderTarget.context.getExtension("WEBGL_lose_context")?.loseContext();
      publishStatus("unavailable");
      return;
    }

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reduceMotionQuery.matches;
    const qualityShadows =
      window.matchMedia("(min-width: 760px)").matches && !reducedMotion;

    renderer.domElement.dataset.estateRenderer = "webgl2";
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = qualityShadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(
      reducedMotion ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
    );
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.FogExp2(0xb98b67, 0.0074);

    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 260);
    camera.position.set(0, 8.5, 60);
    camera.lookAt(0, 1.8, 40);

    const materials = createMaterials();
    scene.add(new THREE.HemisphereLight(0xffe2b4, COLORS.forestDeep, 1.7));
    const sun = new THREE.DirectionalLight(0xffc878, 3.1);
    sun.position.set(-42, 48, 28);
    sun.castShadow = qualityShadows;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -82;
    sun.shadow.camera.right = 82;
    sun.shadow.camera.top = 82;
    sun.shadow.camera.bottom = -82;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 155;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 118),
      materials.grass
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    addLandscapeEllipse(scene, materials.meadowDark, -51, -7, 25, 52, 0.02, -0.08);
    addLandscapeEllipse(scene, materials.meadowLight, 43, 10, 28, 42, 0.021, 0.12);
    addLandscapeEllipse(scene, materials.meadowDark, 3, -45, 42, 14, 0.022, 0);

    const hillMaterial = new THREE.MeshStandardMaterial({
      color: 0x41664a,
      roughness: 1
    });
    const hills = [
      [-58, -56, 25, 5.5, 11],
      [-18, -59, 31, 6.5, 12],
      [30, -59, 35, 6, 12],
      [65, -52, 24, 5, 11]
    ] as const;
    hills.forEach(([x, z, sx, sy, sz]) => {
      const hill = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 9),
        hillMaterial
      );
      hill.position.set(x, -0.6, z);
      hill.scale.set(sx, sy, sz);
      hill.receiveShadow = true;
      scene.add(hill);
    });
    addDistantRidge(scene, materials);
    addWaterLandscape(scene, materials, qualityShadows);

    addPathSegment(scene, materials, 0, 53, 0, 8, 6.4);
    addPathSegment(scene, materials, 0, 8, 0, -10, 7.2);
    addPathSegment(scene, materials, -1, 9, -21, 11, 5.2);
    addPathSegment(scene, materials, -21, 11, -42, 5, 5.2);
    addPathSegment(scene, materials, 1, 9, 22, 11, 5.2);
    addPathSegment(scene, materials, 22, 11, 41, -4, 5.2);
    addPathSegment(scene, materials, -42, 5, -50, -20, 3.6);
    addPathSegment(scene, materials, 41, -4, 46, 24, 3.6);

    const arrivalCourt = new THREE.Mesh(
      new THREE.CircleGeometry(12, 40),
      materials.path
    );
    arrivalCourt.rotation.x = -Math.PI / 2;
    arrivalCourt.position.set(0, 0.07, 44);
    arrivalCourt.receiveShadow = true;
    scene.add(arrivalCourt);
    const arrivalRing = new THREE.Mesh(
      new THREE.RingGeometry(10.8, 11.5, 40),
      materials.gold
    );
    arrivalRing.rotation.x = -Math.PI / 2;
    arrivalRing.position.set(0, 0.09, 44);
    scene.add(arrivalRing);

    const hotel = new THREE.Group();
    const hotelMain = new THREE.Mesh(
      new THREE.BoxGeometry(28, 8.8, 16),
      materials.hotel
    );
    hotelMain.position.set(0, 4.4, -22);
    hotelMain.castShadow = qualityShadows;
    hotelMain.receiveShadow = true;
    hotel.add(hotelMain);
    const hotelRoof = new THREE.Mesh(
      new THREE.ConeGeometry(20, 5.2, 4),
      materials.roof
    );
    hotelRoof.rotation.y = Math.PI / 4;
    hotelRoof.scale.z = 0.66;
    hotelRoof.position.set(0, 11.3, -22);
    hotelRoof.castShadow = qualityShadows;
    hotel.add(hotelRoof);
    const hotelAwning = new THREE.Mesh(
      new THREE.BoxGeometry(8.4, 0.34, 3.2),
      materials.roof
    );
    hotelAwning.position.set(0, 4.6, -12.6);
    hotelAwning.castShadow = qualityShadows;
    hotel.add(hotelAwning);
    const hotelDoor = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 4.3, 0.3),
      materials.charcoal
    );
    hotelDoor.position.set(0, 2.2, -13.82);
    hotel.add(hotelDoor);
    const hotelSign = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 2.15, 0.36),
      materials.roof
    );
    hotelSign.position.set(0, 7.1, -13.78);
    hotel.add(hotelSign);
    for (const x of [-3.4, -1.7, 0, 1.7, 3.4]) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(x === 0 ? 0.35 : 0.22, 1.25, 0.12),
        materials.gold
      );
      bar.position.set(x, 7.1, -13.56);
      hotel.add(bar);
    }
    for (const x of [-10.5, -7, 7, 10.5]) {
      for (const y of [3.2, 6.4]) {
        const windowMesh = new THREE.Mesh(
          new THREE.BoxGeometry(2.1, 1.7, 0.22),
          materials.glass
        );
        windowMesh.position.set(x, y, -13.86);
        hotel.add(windowMesh);
      }
    }

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(10, 7.4, 13),
        materials.hotel
      );
      wing.position.set(side * 17, 3.7, -23.5);
      wing.castShadow = qualityShadows;
      wing.receiveShadow = true;
      hotel.add(wing);

      const wingRoof = new THREE.Mesh(
        new THREE.ConeGeometry(8.8, 4.4, 4),
        materials.roof
      );
      wingRoof.rotation.y = Math.PI / 4;
      wingRoof.scale.z = 0.72;
      wingRoof.position.set(side * 17, 9.5, -23.5);
      wingRoof.castShadow = qualityShadows;
      hotel.add(wingRoof);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(3.1, 3.3, 9.8, 8),
        materials.hotel
      );
      tower.position.set(side * 21, 4.9, -19);
      tower.castShadow = qualityShadows;
      hotel.add(tower);
      const towerRoof = new THREE.Mesh(
        new THREE.ConeGeometry(4.4, 4.7, 8),
        materials.roof
      );
      towerRoof.position.set(side * 21, 12.1, -19);
      towerRoof.castShadow = qualityShadows;
      hotel.add(towerRoof);

      for (const y of [3.1, 5.9]) {
        const wingWindow = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.55, 0.22),
          materials.glass
        );
        wingWindow.position.set(side * 17, y, -16.9);
        hotel.add(wingWindow);
      }
    }

    for (const x of [-8, 0, 8]) {
      const chimney = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 3.2, 1.25),
        materials.stone
      );
      chimney.position.set(x, 12.2, -22);
      chimney.castShadow = qualityShadows;
      hotel.add(chimney);
    }
    scene.add(hotel);

    const conservatory = new THREE.Group();
    const glassHouse = new THREE.Mesh(
      new THREE.BoxGeometry(12.5, 4.8, 7.2),
      materials.glass
    );
    glassHouse.position.set(-15.5, 2.4, -12.5);
    glassHouse.castShadow = qualityShadows;
    conservatory.add(glassHouse);
    for (const x of [-20, -17, -14, -11]) {
      const mullion = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 5.1, 7.5),
        materials.stone
      );
      mullion.position.set(x, 2.55, -12.5);
      conservatory.add(mullion);
    }
    scene.add(conservatory);

    const terrace = new THREE.Mesh(
      new THREE.BoxGeometry(19, 0.22, 7.2),
      materials.wood
    );
    terrace.position.set(18, 0.12, -13.5);
    terrace.receiveShadow = true;
    scene.add(terrace);
    for (const x of [12.5, 18, 23.5]) {
      const table = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 0.16, 16),
        materials.charcoal
      );
      table.position.set(x, 1.05, -13);
      table.castShadow = qualityShadows;
      scene.add(table);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.18, 1, 8),
        materials.charcoal
      );
      stem.position.set(x, 0.52, -13);
      scene.add(stem);
    }

    const fairways = [
      [-44, -8, 8, 22, -0.22],
      [-52, 17, 7.5, 20, 0.32],
      [-30, 27, 7, 18, -0.52]
    ] as const;
    fairways.forEach(([x, z, sx, sz, rotation]) => {
      const fairway = new THREE.Mesh(
        new THREE.CircleGeometry(1, 32),
        materials.fairway
      );
      fairway.rotation.x = -Math.PI / 2;
      fairway.rotation.y = rotation;
      fairway.scale.set(sx, sz, 1);
      fairway.position.set(x, 0.045, z);
      fairway.receiveShadow = true;
      scene.add(fairway);

      for (const offset of [-0.45, 0, 0.45]) {
        const stripe = new THREE.Mesh(
          new THREE.CircleGeometry(1, 32),
          offset === 0 ? materials.meadowLight : materials.green
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.rotation.y = rotation;
        stripe.scale.set(sx * 0.18, sz * 0.92, 1);
        stripe.position.set(x + offset * sx, 0.054, z);
        stripe.receiveShadow = true;
        scene.add(stripe);
      }
    });
    const puttingGreen = new THREE.Mesh(
      new THREE.CircleGeometry(7.2, 36),
      materials.green
    );
    puttingGreen.rotation.x = -Math.PI / 2;
    puttingGreen.position.set(-42, 0.07, 5);
    scene.add(puttingGreen);
    for (const [x, z, sx, sz] of [
      [-51, -3, 3.2, 1.9],
      [-29, 26, 3, 1.5],
      [-56, 22, 2.8, 1.6]
    ] as const) {
      const bunker = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        materials.sand
      );
      bunker.rotation.x = -Math.PI / 2;
      bunker.scale.set(sx, sz, 1);
      bunker.position.set(x, 0.08, z);
      scene.add(bunker);
    }
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(8.2, 36),
      materials.water
    );
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.2, 0.8, 1);
    pond.position.set(-33, 0.08, -21);
    scene.add(pond);
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 3.7, 8),
      materials.cream
    );
    flagPole.position.set(-43.5, 1.85, 2.5);
    scene.add(flagPole);
    const flagMaterial = materials.gold.clone();
    flagMaterial.side = THREE.DoubleSide;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.72),
      flagMaterial
    );
    flag.position.set(-42.85, 3.25, 2.5);
    scene.add(flag);

    const stable = new THREE.Group();
    const barn = new THREE.Mesh(
      new THREE.BoxGeometry(24, 7.2, 15),
      materials.stable
    );
    barn.position.set(42, 3.6, -17.5);
    barn.castShadow = qualityShadows;
    barn.receiveShadow = true;
    stable.add(barn);
    const barnRoof = new THREE.Mesh(
      new THREE.ConeGeometry(17, 5.4, 4),
      materials.roof
    );
    barnRoof.rotation.y = Math.PI / 4;
    barnRoof.scale.z = 0.7;
    barnRoof.position.set(42, 9.65, -17.5);
    barnRoof.castShadow = qualityShadows;
    stable.add(barnRoof);
    const barnDoor = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 5.8, 0.32),
      materials.stableTrim
    );
    barnDoor.position.set(42, 2.9, -9.86);
    stable.add(barnDoor);
    const crossOne = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 7.4, 0.16),
      materials.stable
    );
    crossOne.rotation.z = 0.82;
    crossOne.position.set(42, 2.9, -9.65);
    stable.add(crossOne);
    const crossTwo = crossOne.clone();
    crossTwo.rotation.z = -0.82;
    stable.add(crossTwo);
    scene.add(stable);

    const paddock = new THREE.Mesh(
      new THREE.TorusGeometry(8.8, 0.16, 8, 54),
      materials.stableTrim
    );
    paddock.rotation.x = Math.PI / 2;
    paddock.scale.z = 0.72;
    paddock.position.set(43, 0.16, 26);
    scene.add(paddock);

    addFence(scene, materials, 29, 12, 57, 12);
    addFence(scene, materials, 57, 12, 57, 37);
    addFence(scene, materials, 57, 37, 29, 37);
    addFence(scene, materials, 29, 37, 29, 18);
    scene.add(makeHorse(materials, 40, 25, 0.4));
    scene.add(makeHorse(materials, 49, 30, -0.55));

    addGardenDetails(scene, materials, qualityShadows);
    addInstancedTrees(scene, materials, qualityShadows);

    const receptionShirt = new THREE.MeshStandardMaterial({
      color: 0xe6d7c2,
      roughness: 0.9
    });
    const greenkeeperShirt = new THREE.MeshStandardMaterial({
      color: 0x355f42,
      roughness: 0.9
    });
    const stableShirt = new THREE.MeshStandardMaterial({
      color: 0x925743,
      roughness: 0.9
    });
    const npcGroups = [
      makeNpc(materials, receptionShirt, materials.gold, 0, -8.2, 0, qualityShadows),
      makeNpc(materials, greenkeeperShirt, materials.cream, -42, 5, -0.4, qualityShadows),
      makeNpc(materials, stableShirt, materials.charcoal, 41, -4.5, 0.2, qualityShadows)
    ];
    npcGroups.forEach((npc) => scene.add(npc));

    const interactionRings = new Map<EstateInteractionId, THREE.Mesh>();
    PRIVATE_INTERACTION_POINTS.forEach((point) => {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: COLORS.gold,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.45, 1.75, 32),
        ringMaterial
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(point.x, 0.1, point.z);
      ring.userData.baseScale = 1;
      scene.add(ring);
      interactionRings.set(point.id, ring);
    });

    const lanterns: THREE.Mesh[] = [];
    for (const [x, z] of [
      [-3.8, 39], [3.8, 39], [-3.8, 27], [3.8, 27], [-3.8, 15], [3.8, 15],
      [-18, 12], [-31, 9], [18, 12], [31, 7]
    ] as const) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.1, 1.7, 7),
        materials.roof
      );
      post.position.set(x, 0.85, z);
      scene.add(post);
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 9, 7),
        materials.warmLight.clone()
      );
      light.position.set(x, 1.82, z);
      scene.add(light);
      lanterns.push(light);
    }

    const avatar = makeAvatar(materials, avatarStyle, qualityShadows);
    scene.add(avatar.group);
    const { birdie, leftWing, rightWing } = makeBirdie(materials);
    scene.add(birdie);

    let cameraDistance = 13;
    let cameraHeight = 7.4;
    let cameraLookAhead = 5.8;
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(320, mount.clientHeight);
      const aspect = width / height;
      const compact = width < 640;
      camera.aspect = aspect;
      camera.fov = compact ? 62 : 54;
      cameraDistance = compact ? 13.8 : 13;
      cameraHeight = compact ? 8.2 : 7.4;
      cameraLookAhead = compact ? 6.4 : 5.8;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const velocity = new THREE.Vector2();
    const input = new THREE.Vector2();
    const targetVelocity = new THREE.Vector2();
    const dragControl = new THREE.Vector2();
    const dragBasisForward = new THREE.Vector2(0, -1);
    const dragBasisRight = new THREE.Vector2(1, 0);
    const cameraDirection = new THREE.Vector3();
    const avatarForward = new THREE.Vector3(0, 0, -1);
    const avatarRight = new THREE.Vector3(1, 0, 0);
    const cameraTarget = new THREE.Vector3(0, 8.5, 60);
    const desiredLookTarget = new THREE.Vector3(0, 1.8, 40);
    const lookTarget = new THREE.Vector3(0, 1.8, 40);
    const clock = new THREE.Clock(false);
    let simulationElapsed = 0;
    let walkPhase = 0;
    let targetRotation = 0;
    let frame = 0;
    let running = false;
    let renderUsable = true;
    let activePointerId: number | null = null;
    let pointerOriginX = 0;
    let pointerOriginY = 0;
    let dragHintDismissed = false;

    triggerInteractionRef.current = () => {
      if (pausedRef.current) return;
      const interactionId = nearbyIdRef.current;
      if (!interactionId) return;
      const event = createEstateInteractionEvent(interactionId);
      setLastInteractionId(interactionId);
      setInteractionAnnouncement(`${event.speaker}: ${event.dialogue}`);
      onInteractionRef.current?.(event);
    };

    const updateJoystickVisual = (
      originX: number,
      originY: number,
      knobX: number,
      knobY: number,
      distance: number
    ) => {
      const joystick = joystickRef.current;
      if (!joystick) return;
      joystick.style.setProperty("--estate-stick-origin-x", `${originX}px`);
      joystick.style.setProperty("--estate-stick-origin-y", `${originY}px`);
      joystick.style.setProperty("--estate-stick-knob-x", `${knobX}px`);
      joystick.style.setProperty("--estate-stick-knob-y", `${knobY}px`);
      joystick.style.setProperty(
        "--estate-stick-angle",
        `${Math.atan2(knobY, knobX)}rad`
      );
      joystick.style.setProperty("--estate-stick-distance", `${distance}px`);
    };
    const finishDrag = (pointerId?: number) => {
      if (
        activePointerId === null ||
        (pointerId !== undefined && pointerId !== activePointerId)
      ) {
        return;
      }
      const finishedPointerId = activePointerId;
      activePointerId = null;
      dragControl.set(0, 0);
      updateJoystickVisual(pointerOriginX, pointerOriginY, 0, 0, 0);
      setDragActive(false);
      try {
        if (mount.hasPointerCapture(finishedPointerId)) {
          mount.releasePointerCapture(finishedPointerId);
        }
      } catch {
        // Synthetic and already-cancelled pointers may not own capture.
      }
    };
    endDragRef.current = () => finishDrag();

    const onPointerDown = (event: PointerEvent) => {
      if (
        pausedRef.current ||
        !event.isPrimary ||
        event.button !== 0 ||
        activePointerId !== null
      ) {
        return;
      }
      const bounds = mount.getBoundingClientRect();
      activePointerId = event.pointerId;
      pointerOriginX = event.clientX - bounds.left;
      pointerOriginY = event.clientY - bounds.top;
      camera.getWorldDirection(cameraDirection);
      cameraDirection.y = 0;
      if (cameraDirection.lengthSq() > 0.0001) cameraDirection.normalize();
      else cameraDirection.set(0, 0, -1);
      dragBasisForward.set(cameraDirection.x, cameraDirection.z).normalize();
      dragBasisRight.set(-dragBasisForward.y, dragBasisForward.x);
      dragControl.set(0, 0);
      updateJoystickVisual(pointerOriginX, pointerOriginY, 0, 0, 0);
      setDragActive(true);
      try {
        mount.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can be unavailable for synthetic events.
      }
      mount.focus({ preventScroll: true });
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      const bounds = mount.getBoundingClientRect();
      const deltaX = event.clientX - bounds.left - pointerOriginX;
      const deltaY = event.clientY - bounds.top - pointerOriginY;
      const rawDistance = Math.hypot(deltaX, deltaY);
      const visualDistance = Math.min(rawDistance, DRAG_MAX_RADIUS);
      const directionX = rawDistance > 0 ? deltaX / rawDistance : 0;
      const directionY = rawDistance > 0 ? deltaY / rawDistance : 0;
      const strength = THREE.MathUtils.clamp(
        (rawDistance - DRAG_DEAD_ZONE) /
          (DRAG_MAX_RADIUS - DRAG_DEAD_ZONE),
        0,
        1
      );
      const localRight = directionX * strength;
      const localForward = -directionY * strength;
      dragControl.set(
        dragBasisRight.x * localRight +
          dragBasisForward.x * localForward,
        dragBasisRight.y * localRight +
          dragBasisForward.y * localForward
      );
      updateJoystickVisual(
        pointerOriginX,
        pointerOriginY,
        directionX * visualDistance,
        directionY * visualDistance,
        visualDistance
      );
      if (strength > 0 && !dragHintDismissed) {
        dragHintDismissed = true;
        setDragHintVisible(false);
      }
      event.preventDefault();
    };
    const onPointerEnd = (event: PointerEvent) => finishDrag(event.pointerId);
    mount.addEventListener("pointerdown", onPointerDown, { passive: false });
    mount.addEventListener("pointermove", onPointerMove, { passive: false });
    mount.addEventListener("pointerup", onPointerEnd);
    mount.addEventListener("pointercancel", onPointerEnd);
    mount.addEventListener("lostpointercapture", onPointerEnd);

    const clearInput = () => {
      heldRef.current.clear();
      dragControl.set(0, 0);
      velocity.set(0, 0);
      targetVelocity.set(0, 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current || isEditableTarget(event.target)) return;
      const direction = keyToDirection(event.key);
      if (direction) {
        event.preventDefault();
        heldRef.current.add(direction);
        return;
      }
      if ((event.key.toLowerCase() === "e" || event.key === "Enter") && !event.repeat) {
        if (nearbyIdRef.current) event.preventDefault();
        triggerInteractionRef.current();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = keyToDirection(event.key);
      if (direction) heldRef.current.delete(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const onWindowBlur = () => {
      finishDrag();
      clearInput();
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pointerup", onPointerEnd);

    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      renderer.setPixelRatio(
        reducedMotion ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
      );
      resize();
    };
    reduceMotionQuery.addEventListener("change", onReducedMotionChange);

    const animate = () => {
      if (!running) return;
      frame = window.requestAnimationFrame(animate);
      // Keep walking tied to elapsed time on low-FPS mobile/software WebGL.
      // The 250 ms cap still limits one collision step to 2.05 world units.
      const dt = Math.min(clock.getDelta(), 0.25);

      if (!pausedRef.current) {
        simulationElapsed += dt;
        input.set(0, 0);
        if (heldRef.current.has("forward")) input.y -= 1;
        if (heldRef.current.has("back")) input.y += 1;
        if (heldRef.current.has("left")) input.x -= 1;
        if (heldRef.current.has("right")) input.x += 1;
        input.add(dragControl);
        if (input.lengthSq() > 1) input.normalize();

        targetVelocity.copy(input).multiplyScalar(8.2);
        const movementResponse =
          1 - Math.exp(-dt * (input.lengthSq() > 0 ? 9.5 : 7));
        velocity.lerp(targetVelocity, movementResponse);
        if (input.lengthSq() === 0 && velocity.lengthSq() < 0.008) {
          velocity.set(0, 0);
        }

        const previousX = avatar.group.position.x;
        const previousZ = avatar.group.position.z;
        const requestedX = previousX + velocity.x * dt;
        const requestedZ = previousZ + velocity.y * dt;
        const resolved = resolveMovement(
          previousX,
          previousZ,
          requestedX,
          requestedZ
        );
        avatar.group.position.x = resolved.x;
        avatar.group.position.z = resolved.z;
        if (Math.abs(resolved.x - requestedX) > 0.01) velocity.x = 0;
        if (Math.abs(resolved.z - requestedZ) > 0.01) velocity.y = 0;

        const moving = velocity.lengthSq() > 0.04;
        if (moving) {
          targetRotation = Math.atan2(velocity.x, velocity.y) + Math.PI;
          walkPhase += dt * (10 + Math.min(4, velocity.length() * 0.35));
        }
        let rotationDelta = targetRotation - avatar.group.rotation.y;
        rotationDelta = Math.atan2(
          Math.sin(rotationDelta),
          Math.cos(rotationDelta)
        );
        avatar.group.rotation.y += rotationDelta * Math.min(1, dt * 10);

        if (!reducedMotion) {
          const strideStrength = Math.min(1, velocity.length() / 5.5);
          const stride = moving
            ? Math.sin(walkPhase) * 0.5 * strideStrength
            : 0;
          avatar.leftLeg.rotation.x +=
            (stride - avatar.leftLeg.rotation.x) * 0.24;
          avatar.rightLeg.rotation.x +=
            (-stride - avatar.rightLeg.rotation.x) * 0.24;
          avatar.leftArm.rotation.x +=
            (-stride * 0.72 - avatar.leftArm.rotation.x) * 0.24;
          avatar.rightArm.rotation.x +=
            (stride * 0.72 - avatar.rightArm.rotation.x) * 0.24;
          avatar.torso.position.y =
            1.45 + (moving ? Math.abs(Math.sin(walkPhase * 2)) * 0.045 : 0);
        }

        const nextDistrict = identifyDistrict(
          avatar.group.position.x,
          avatar.group.position.z
        );
        if (nextDistrict !== districtRef.current) publishDistrict(nextDistrict);

        const nextNearby = nearestInteraction(
          avatar.group.position.x,
          avatar.group.position.z
        );
        if (nextNearby !== nearbyIdRef.current) publishNearby(nextNearby);

        avatarForward.set(
          -Math.sin(avatar.group.rotation.y),
          0,
          -Math.cos(avatar.group.rotation.y)
        );
        avatarRight.set(
          Math.cos(avatar.group.rotation.y),
          0,
          -Math.sin(avatar.group.rotation.y)
        );
        const safeCameraDistance = resolveCameraDistance(
          avatar.group.position.x,
          avatar.group.position.z,
          -avatarForward.x,
          -avatarForward.z,
          cameraDistance
        );
        cameraTarget
          .copy(avatar.group.position)
          .addScaledVector(avatarForward, -safeCameraDistance);
        cameraTarget.y += cameraHeight;
        desiredLookTarget
          .copy(avatar.group.position)
          .addScaledVector(avatarForward, cameraLookAhead);
        desiredLookTarget.y += 1.7;
        const cameraResponse = 1 - Math.exp(-dt * (reducedMotion ? 9 : 5.4));
        const lookResponse = 1 - Math.exp(-dt * (reducedMotion ? 10 : 7.2));
        camera.position.lerp(cameraTarget, cameraResponse);
        lookTarget.lerp(desiredLookTarget, lookResponse);
        camera.lookAt(lookTarget);

        birdie.position
          .copy(avatar.group.position)
          .addScaledVector(avatarRight, 2.15)
          .addScaledVector(avatarForward, -0.45);
        birdie.position.y = reducedMotion
          ? 3.8
          : 3.8 + Math.sin(simulationElapsed * 2.1) * 0.18;
        birdie.rotation.y = avatar.group.rotation.y - 0.5;
        if (!reducedMotion) {
          const wingBeat = Math.sin(simulationElapsed * 10) * 0.45;
          leftWing.rotation.z = Math.PI / 2 + wingBeat;
          rightWing.rotation.z = -Math.PI / 2 - wingBeat;
          lanterns.forEach((lantern, index) => {
            const material = lantern.material as THREE.MeshStandardMaterial;
            material.emissiveIntensity =
              1.05 + Math.sin(simulationElapsed * 1.5 + index) * 0.14;
          });
          interactionRings.forEach((ring, id) => {
            const active = id === nearbyIdRef.current;
            const pulse = active
              ? 1.12 + Math.sin(simulationElapsed * 3.5) * 0.09
              : 1;
            ring.scale.setScalar(pulse);
            const material = ring.material as THREE.MeshBasicMaterial;
            material.opacity = active ? 0.82 : 0.42;
          });
        }
      } else {
        clearInput();
      }

      renderer.render(scene, camera);
    };

    const startLoop = () => {
      if (running || !renderUsable) return;
      running = true;
      clock.start();
      frame = window.requestAnimationFrame(animate);
    };
    const stopLoop = () => {
      if (!running) return;
      running = false;
      window.cancelAnimationFrame(frame);
      clock.stop();
      finishDrag();
      clearInput();
    };
    const onVisibilityChange = () => {
      if (document.hidden) stopLoop();
      else if (!pausedRef.current) startLoop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    updatePausedLoopRef.current = (nextPaused) => {
      if (nextPaused) stopLoop();
      else if (!document.hidden) startLoop();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      renderUsable = false;
      stopLoop();
      publishNearby(null);
      publishStatus("context-lost");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    renderer.render(scene, camera);
    publishStatus("ready");
    if (!document.hidden && !pausedRef.current) startLoop();

    return () => {
      stopLoop();
      triggerInteractionRef.current = () => undefined;
      endDragRef.current = () => undefined;
      updatePausedLoopRef.current = () => undefined;
      heldRef.current.clear();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pointerup", onPointerEnd);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", onPointerEnd);
      mount.removeEventListener("pointercancel", onPointerEnd);
      mount.removeEventListener("lostpointercapture", onPointerEnd);
      reduceMotionQuery.removeEventListener("change", onReducedMotionChange);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [avatarStyle, forceFallback]);

  const press = (direction: MovementDirection) => {
    if (!paused) heldRef.current.add(direction);
  };
  const release = (direction: MovementDirection) => {
    heldRef.current.delete(direction);
  };
  const nudge = (direction: MovementDirection) => {
    if (paused) return;
    if (nudgeDirectionRef.current) {
      heldRef.current.delete(nudgeDirectionRef.current);
    }
    heldRef.current.add(direction);
    nudgeDirectionRef.current = direction;
    if (nudgeTimerRef.current !== null) {
      window.clearTimeout(nudgeTimerRef.current);
    }
    nudgeTimerRef.current = window.setTimeout(() => {
      heldRef.current.delete(direction);
      if (nudgeDirectionRef.current === direction) {
        nudgeDirectionRef.current = null;
      }
      nudgeTimerRef.current = null;
    }, 420);
  };
  const handleFallbackDistrict = (nextDistrict: EstateDistrictId) => {
    districtRef.current = nextDistrict;
    setDistrict(nextDistrict);
    onDistrictChangeRef.current?.(nextDistrict);
  };
  const handleFallbackInteraction = (interaction: EstateInteractionEvent) => {
    setLastInteractionId(interaction.id);
    setInteractionAnnouncement(`${interaction.speaker}: ${interaction.dialogue}`);
    onInteractionRef.current?.(interaction);
  };
  const classNames = ["immersive-estate-scene", className]
    .filter(Boolean)
    .join(" ");
  const districtDefinition = getEstateDistrict(district);
  const fallbackVisible =
    webglStatus === "unavailable" || webglStatus === "context-lost";

  return (
    <section
      className={classNames}
      data-immersive-estate={ESTATE_CONTRACT_VERSION}
      data-estate-district={district}
      data-estate-zone={district}
      data-estate-webgl={webglStatus}
      data-render-mode={fallbackVisible ? "fallback" : "webgl"}
      data-scene-ready={webglStatus === "ready" ? "true" : "false"}
      data-estate-paused={paused ? "true" : "false"}
      data-estate-last-interaction={lastInteractionId ?? "none"}
      data-estate-camera-mode="third-person-follow"
      data-estate-touch-input="drag-to-move"
      data-estate-drag-active={dragActive ? "true" : "false"}
      data-estate-avatar-style={avatarStyle}
      aria-label="Begehbares Birdie & Breakfast Grundstück"
    >
      <div
        ref={mountRef}
        className="immersive-estate-scene__renderer"
        data-estate-renderer-host="webgl2"
        data-estate-scene-focus="true"
        data-estate-world-focus="true"
        tabIndex={paused || fallbackVisible ? -1 : 0}
        aria-label="3D-Welt fokussieren. Auf Touchgeräten den Daumen auf die Welt legen und in Gehrichtung ziehen. Alternativ mit WASD, Pfeiltasten oder den einblendbaren Richtungstasten bewegen. Interagieren mit E oder Enter."
        aria-describedby="estate-scene-controls-help"
        hidden={fallbackVisible}
      />

      {fallbackVisible ? (
        <EstateFallbackWorld
          activeDistrict={district}
          paused={paused}
          reason={
            forceFallback
              ? "forced"
              : webglStatus === "context-lost"
                ? "context-lost"
                : "unavailable"
          }
          onDistrictChange={handleFallbackDistrict}
          onInteraction={handleFallbackInteraction}
        />
      ) : (
        <>
          <div
            className="immersive-estate-scene__place"
            data-estate-current-district={district}
            aria-live="polite"
          >
            <span>{districtDefinition.eyebrow}</span>
            <strong>{districtDefinition.label}</strong>
          </div>

          <div
            ref={joystickRef}
            className="immersive-estate-scene__thumbstick"
            data-estate-touch-controls="drag"
            data-estate-drag-joystick={dragActive ? "active" : "idle"}
            aria-hidden="true"
          >
            <span className="immersive-estate-scene__thumbstick-base" />
            <span className="immersive-estate-scene__thumbstick-trail" />
            <span className="immersive-estate-scene__thumbstick-knob">↑</span>
          </div>

          <p
            className="immersive-estate-scene__drag-hint"
            data-estate-drag-hint={dragHintVisible ? "visible" : "dismissed"}
            aria-hidden="true"
          >
            Daumen auflegen &amp; ziehen
          </p>

          <div
            className="immersive-estate-scene__interaction"
            data-nearby-interaction={nearbyInteraction?.id ?? "none"}
          >
            <span className="immersive-estate-scene__interaction-copy">
              {nearbyInteraction
                ? `${nearbyInteraction.speaker} · ${nearbyInteraction.prompt}`
                : "Erkunde das Grundstück und nähere dich einer Person."}
            </span>
            <button
              type="button"
              data-estate-interact="npc"
              onClick={() => triggerInteractionRef.current()}
              disabled={!nearbyInteraction || paused}
              aria-label={nearbyInteraction?.prompt ?? "Keine Begegnung in Reichweite"}
            >
              <kbd>E</kbd>
              <span>{nearbyInteraction ? "Sprechen" : "Interagieren"}</span>
            </button>
          </div>

          <details className="immersive-estate-scene__touch-alternative">
            <summary aria-label="Alternative Richtungstasten umschalten">
              <span aria-hidden="true">＋</span>
            </summary>
            <div
              className="immersive-estate-scene__touch"
              data-estate-touch-controls="directional-alternative"
              role="group"
              aria-label="Alternative Bewegungssteuerung"
            >
            <button
              type="button"
              data-estate-move="forward"
              aria-label="Vorwärts gehen"
              disabled={paused}
              onPointerDown={() => press("forward")}
              onPointerUp={() => release("forward")}
              onPointerCancel={() => release("forward")}
              onPointerLeave={() => release("forward")}
              onClick={(event) => {
                if (event.detail === 0) nudge("forward");
              }}
            >
              ↑
            </button>
            <button
              type="button"
              data-estate-move="left"
              aria-label="Nach links gehen"
              disabled={paused}
              onPointerDown={() => press("left")}
              onPointerUp={() => release("left")}
              onPointerCancel={() => release("left")}
              onPointerLeave={() => release("left")}
              onClick={(event) => {
                if (event.detail === 0) nudge("left");
              }}
            >
              ←
            </button>
            <button
              type="button"
              data-estate-move="back"
              aria-label="Rückwärts gehen"
              disabled={paused}
              onPointerDown={() => press("back")}
              onPointerUp={() => release("back")}
              onPointerCancel={() => release("back")}
              onPointerLeave={() => release("back")}
              onClick={(event) => {
                if (event.detail === 0) nudge("back");
              }}
            >
              ↓
            </button>
            <button
              type="button"
              data-estate-move="right"
              aria-label="Nach rechts gehen"
              disabled={paused}
              onPointerDown={() => press("right")}
              onPointerUp={() => release("right")}
              onPointerCancel={() => release("right")}
              onPointerLeave={() => release("right")}
              onClick={(event) => {
                if (event.detail === 0) nudge("right");
              }}
            >
              →
            </button>
            </div>
          </details>
        </>
      )}

      <p id="estate-scene-controls-help" className="sr-only">
        Das Grundstück ist nur eine sitzungsgebundene Darstellung. Exakte
        Positionen verlassen den Renderer nicht. Öffne Birdie und Menüs über
        die sichtbaren App-Schaltflächen.
      </p>
      <p
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-estate-interaction-feedback={lastInteractionId ?? "none"}
      >
        {interactionAnnouncement}
      </p>
    </section>
  );
}
