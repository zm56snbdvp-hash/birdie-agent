import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EstateFallbackWorld } from "./EstateFallbackWorld";
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

export interface ImmersiveEstateSceneProps {
  onDistrictChange?: (district: EstateDistrictId) => void;
  onInteraction?: (interaction: EstateInteractionEvent) => void;
  onNearbyInteractionChange?: (
    interaction: EstateInteractionDefinition | null
  ) => void;
  onWebglStatusChange?: (status: EstateWebglStatus) => void;
  forceFallback?: boolean;
  paused?: boolean;
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
  forestDeep: 0x173226,
  forest: 0x284e39,
  forestLight: 0x4f7654,
  grass: 0x55775a,
  fairway: 0x729765,
  green: 0x8db373,
  cream: 0xf7f1e5,
  path: 0xd9ccb0,
  pathEdge: 0xb9a67f,
  gold: 0xc7a54a,
  hotel: 0xb99a78,
  roof: 0x203c2e,
  stable: 0x874b39,
  stableTrim: 0xe6d5ba,
  wood: 0x6d4d37,
  water: 0x578797,
  sand: 0xdcc590,
  charcoal: 0x2f302d,
  warmLight: 0xffc876,
  sky: 0xe8bd88
} as const;

const PRIVATE_INTERACTION_POINTS: readonly PrivateInteractionPoint[] = [
  { id: "hotel-reception", x: 0, z: -8.2, radius: 4.8 },
  { id: "greenkeeper", x: -42, z: 5, radius: 5.2 },
  { id: "stable-guide", x: 41, z: -4.5, radius: 5.2 }
] as const;

const BUILDING_COLLISIONS: readonly CollisionRectangle[] = [
  { minX: -14.6, maxX: 14.6, minZ: -30.6, maxZ: -13.2 },
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
  [20, -35, 0.9]
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
  sand: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageLight: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  warmLight: THREE.MeshStandardMaterial;
}

function createMaterials(): SceneMaterials {
  return {
    grass: new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 1 }),
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
      roughness: 0.3,
      metalness: 0.05
    }),
    sand: new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }),
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

function makeAvatar(materials: SceneMaterials, castShadow: boolean) {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.46, 1.05, 5, 10),
    materials.foliage
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
    materials.gold
  );
  cap.position.y = 2.72;
  group.add(cap);

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
      materials.foliage
    );
    arm.position.y = -0.31;
    arm.castShadow = castShadow;
    pivot.add(arm);
  });

  group.position.set(0, 0.08, 46);
  group.rotation.y = Math.PI;
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
  className
}: ImmersiveEstateSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const heldRef = useRef<Set<MovementDirection>>(new Set());
  const pausedRef = useRef(paused);
  const districtRef = useRef<EstateDistrictId>("arrival-court");
  const nearbyIdRef = useRef<EstateInteractionId | null>(null);
  const triggerInteractionRef = useRef<() => void>(() => undefined);
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
    if (paused) heldRef.current.clear();
    updatePausedLoopRef.current(paused);
  }, [paused]);

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
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = qualityShadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(
      reducedMotion ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
    );
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.FogExp2(0xd8b88d, 0.0095);

    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 240);
    camera.position.set(20, 23, 70);
    camera.lookAt(0, 0, 46);

    const materials = createMaterials();
    scene.add(new THREE.HemisphereLight(0xffead0, COLORS.forestDeep, 2.05));
    const sun = new THREE.DirectionalLight(0xffd49c, 2.8);
    sun.position.set(-35, 54, 36);
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
    scene.add(hotel);

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

    addFence(scene, materials, 29, 12, 57, 12);
    addFence(scene, materials, 57, 12, 57, 37);
    addFence(scene, materials, 57, 37, 29, 37);
    addFence(scene, materials, 29, 37, 29, 18);
    scene.add(makeHorse(materials, 40, 25, 0.4));
    scene.add(makeHorse(materials, 49, 30, -0.55));

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

    const avatar = makeAvatar(materials, qualityShadows);
    scene.add(avatar.group);
    const { birdie, leftWing, rightWing } = makeBirdie(materials);
    scene.add(birdie);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(320, mount.clientHeight);
      const aspect = width / height;
      const viewHeight = width < 640 ? 35 : 30;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const velocity = new THREE.Vector2();
    const input = new THREE.Vector2();
    const targetVelocity = new THREE.Vector2();
    const cameraTarget = new THREE.Vector3(20, 23, 70);
    const lookTarget = new THREE.Vector3(0, 1.1, 46);
    const clock = new THREE.Clock(false);
    let simulationElapsed = 0;
    let walkPhase = 0;
    let targetRotation = Math.PI;
    let frame = 0;
    let running = false;
    let renderUsable = true;

    triggerInteractionRef.current = () => {
      if (pausedRef.current) return;
      const interactionId = nearbyIdRef.current;
      if (!interactionId) return;
      const event = createEstateInteractionEvent(interactionId);
      setLastInteractionId(interactionId);
      setInteractionAnnouncement(`${event.speaker}: ${event.dialogue}`);
      onInteractionRef.current?.(event);
    };

    const clearInput = () => {
      heldRef.current.clear();
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
    window.addEventListener("blur", clearInput);
    window.addEventListener("pointerup", clearInput);

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
      const dt = Math.min(clock.getDelta(), 0.05);

      if (!pausedRef.current) {
        simulationElapsed += dt;
        input.set(0, 0);
        if (heldRef.current.has("forward")) input.y -= 1;
        if (heldRef.current.has("back")) input.y += 1;
        if (heldRef.current.has("left")) input.x -= 1;
        if (heldRef.current.has("right")) input.x += 1;
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

        cameraTarget.set(
          avatar.group.position.x + 20,
          23,
          avatar.group.position.z + 24
        );
        lookTarget.set(
          avatar.group.position.x,
          1.15,
          avatar.group.position.z
        );
        const cameraResponse = 1 - Math.exp(-dt * (reducedMotion ? 9 : 4.8));
        camera.position.lerp(cameraTarget, cameraResponse);
        camera.lookAt(lookTarget);

        birdie.position.set(
          avatar.group.position.x + 2.3,
          reducedMotion ? 3.8 : 3.8 + Math.sin(simulationElapsed * 2.1) * 0.18,
          avatar.group.position.z - 1.4
        );
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
      updatePausedLoopRef.current = () => undefined;
      heldRef.current.clear();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearInput);
      window.removeEventListener("pointerup", clearInput);
      reduceMotionQuery.removeEventListener("change", onReducedMotionChange);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [forceFallback]);

  const press = (direction: MovementDirection) => {
    if (!paused) heldRef.current.add(direction);
  };
  const release = (direction: MovementDirection) => {
    heldRef.current.delete(direction);
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
      aria-label="Begehbares Birdie & Breakfast Grundstück"
    >
      <div
        ref={mountRef}
        className="immersive-estate-scene__renderer"
        data-estate-renderer-host="webgl2"
        data-estate-scene-focus="true"
        data-estate-world-focus="true"
        tabIndex={paused || fallbackVisible ? -1 : 0}
        aria-label="3D-Welt fokussieren. Bewegen mit WASD, Pfeiltasten oder Touch. Interagieren mit E oder Enter."
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

          <div
            className="immersive-estate-scene__touch"
            data-estate-touch-controls="directional"
            aria-label="Bewegungssteuerung"
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
            >
              →
            </button>
          </div>
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
