import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Direction = "forward" | "back" | "left" | "right";
export type WorldZone = "Arrival Path" | "Hotel Entrance" | "Putting Green" | "Terrace" | "Hotel Grounds";

export interface ThreeHotelSceneProps {
  /** Renderer/UI-only projection. Exact coordinates never leave this scene. */
  onZoneChange?: (zone: WorldZone) => void;
}

const COLORS = {
  forest: 0x234734,
  forestDeep: 0x173226,
  cream: 0xf7f3eb,
  beige: 0xdcc9a4,
  gold: 0xc7a54a,
  charcoal: 0x2f2f2f,
  sunset: 0xf1bd78,
  grass: 0x54775a,
  path: 0xe7ddc9,
  wood: 0x75513b,
  warmLight: 0xffc86b
} as const;

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function createSignTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 300;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#173226";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#c7a54a";
  context.lineWidth = 8;
  context.strokeRect(22, 22, canvas.width - 44, canvas.height - 44);
  context.fillStyle = "#dcc9a4";
  context.textAlign = "center";
  context.font = "300 112px Georgia";
  context.fillText("B&B", canvas.width / 2, 142);
  context.fillStyle = "#c7a54a";
  context.font = "600 28px Arial";
  context.letterSpacing = "5px";
  context.fillText("BIRDIE & BREAKFAST", canvas.width / 2, 205);
  context.font = "500 19px Arial";
  context.fillStyle = "#f7f3eb";
  context.fillText("GOLF, WIE ES SICH ANFÜHLEN SOLLTE.", canvas.width / 2, 248);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addTree(scene: THREE.Scene, x: number, z: number, scale: number) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.26, 2.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x5c4032, roughness: 1 })
  );
  trunk.position.y = 1.35;
  trunk.castShadow = true;
  tree.add(trunk);

  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.forestDeep,
    roughness: 1
  });
  for (const [ox, oy, oz, size] of [
    [0, 3.2, 0, 1.35],
    [-0.65, 2.85, 0.1, 1.0],
    [0.65, 2.9, 0.05, 1.05],
    [0.1, 3.7, -0.2, 0.92]
  ] as const) {
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), foliageMaterial);
    crown.position.set(ox, oy, oz);
    crown.castShadow = true;
    tree.add(crown);
  }
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
  return tree;
}

function makeAvatar() {
  const avatar = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: COLORS.forest, roughness: 0.74 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd2a77e, roughness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.9 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.86 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.92, 6, 12), uniform);
  torso.position.y = 1.35;
  torso.castShadow = true;
  avatar.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14), skin);
  head.position.y = 2.35;
  head.castShadow = true;
  avatar.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  cap.position.set(0, 2.58, 0);
  cap.castShadow = true;
  avatar.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.28), dark);
  brim.position.set(0, 2.53, -0.29);
  avatar.add(brim);

  const leftLegPivot = new THREE.Group();
  const rightLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.2, 0.9, 0);
  rightLegPivot.position.set(0.2, 0.9, 0);
  avatar.add(leftLegPivot, rightLegPivot);

  for (const pivot of [leftLegPivot, rightLegPivot]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.58, 5, 8), dark);
    leg.position.y = -0.38;
    leg.castShadow = true;
    pivot.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.48), shoe);
    foot.position.set(0, -0.8, -0.08);
    foot.castShadow = true;
    pivot.add(foot);
  }

  const leftArmPivot = new THREE.Group();
  const rightArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.48, 1.78, 0);
  rightArmPivot.position.set(0.48, 1.78, 0);
  avatar.add(leftArmPivot, rightArmPivot);
  for (const pivot of [leftArmPivot, rightArmPivot]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 5, 8), uniform);
    arm.position.y = -0.28;
    arm.castShadow = true;
    pivot.add(arm);
  }

  avatar.position.set(0, 0.05, 7.4);
  avatar.userData = { leftLegPivot, rightLegPivot, leftArmPivot, rightArmPivot, torso };
  return avatar;
}

function makeBirdie() {
  const bird = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.7 })
  );
  body.scale.set(1.15, 0.85, 1.35);
  bird.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 10),
    new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: 0.78 })
  );
  head.position.set(0, 0.08, -0.18);
  bird.add(head);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.14, 6),
    new THREE.MeshStandardMaterial({ color: 0xd89035, roughness: 0.8 })
  );
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.06, -0.31);
  bird.add(beak);
  const wingMaterial = new THREE.MeshStandardMaterial({ color: COLORS.forest, roughness: 0.75 });
  const leftWing = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 5), wingMaterial);
  const rightWing = leftWing.clone();
  leftWing.rotation.z = Math.PI / 2;
  rightWing.rotation.z = -Math.PI / 2;
  leftWing.position.x = -0.19;
  rightWing.position.x = 0.19;
  bird.add(leftWing, rightWing);
  bird.userData = { leftWing, rightWing };
  return bird;
}

function identifyZone(x: number, z: number): WorldZone {
  if (Math.hypot(x, z + 0.15) < 2.05) return "Hotel Entrance";
  if (x > 2.7 && z < 2.7) return "Terrace";
  if (Math.hypot(x + 6.5, z - 4.1) < 2.8) return "Putting Green";
  if (Math.abs(x) < 2.15 && z >= 0.4) return "Arrival Path";
  return "Hotel Grounds";
}

function pushOutsideCircle(x: number, z: number, cx: number, cz: number, radius: number) {
  const dx = x - cx;
  const dz = z - cz;
  const distance = Math.hypot(dx, dz);
  if (distance >= radius || distance === 0) return { x, z };
  const scale = radius / distance;
  return { x: cx + dx * scale, z: cz + dz * scale };
}

export function ThreeHotelScene({ onZoneChange }: ThreeHotelSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const heldRef = useRef<Set<Direction>>(new Set());
  const zoneRef = useRef<WorldZone>("Arrival Path");
  const onZoneChangeRef = useRef(onZoneChange);
  const [worldZone, setWorldZone] = useState<WorldZone>("Arrival Path");
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    onZoneChangeRef.current = onZoneChange;
  }, [onZoneChange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    onZoneChangeRef.current?.(zoneRef.current);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setWebglAvailable(false);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1c891);
    scene.fog = new THREE.FogExp2(0xeac89a, 0.026);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120);
    camera.position.set(0, 7.2, 15.2);
    camera.lookAt(0, 2.2, -1.2);

    scene.add(new THREE.HemisphereLight(0xffead1, COLORS.forestDeep, 2.25));
    const sun = new THREE.DirectionalLight(0xffd49a, 3.35);
    sun.position.set(-9, 9, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 34),
      new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x49664d, roughness: 1 });
    for (const [x, z, sx, sy, sz] of [
      [-10, -14, 9, 2.6, 4],
      [1, -16, 12, 3.2, 5],
      [13, -14, 10, 2.8, 4.5]
    ] as const) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), hillMaterial);
      hill.position.set(x, 0.4, z);
      hill.scale.set(sx, sy, sz);
      hill.receiveShadow = true;
      scene.add(hill);
    }

    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 12),
      new THREE.MeshStandardMaterial({ color: COLORS.path, roughness: 1 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.02, 4.7);
    scene.add(path);

    const pathLanterns: THREE.Mesh[] = [];
    const lanternMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.warmLight,
      emissive: COLORS.warmLight,
      emissiveIntensity: 1.15,
      roughness: 0.35
    });
    for (const z of [2.0, 4.2, 6.4, 8.55]) {
      for (const x of [-1.8, 1.8]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.05, 0.62, 7),
          new THREE.MeshStandardMaterial({ color: COLORS.forestDeep, roughness: 0.92 })
        );
        post.position.set(x, 0.31, z);
        scene.add(post);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), lanternMaterial.clone());
        lamp.position.set(x, 0.68, z);
        scene.add(lamp);
        pathLanterns.push(lamp);
      }
    }

    const putting = new THREE.Mesh(
      new THREE.CircleGeometry(2.15, 36),
      new THREE.MeshStandardMaterial({ color: 0x6a935e, roughness: 1 })
    );
    putting.rotation.x = -Math.PI / 2;
    putting.position.set(-6.5, 0.035, 4.1);
    scene.add(putting);
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 2.35, 8),
      new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: 0.8 })
    );
    flagPole.position.set(-6.5, 1.18, 4.1);
    scene.add(flagPole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.38),
      new THREE.MeshStandardMaterial({ color: COLORS.gold, side: THREE.DoubleSide, roughness: 0.75 })
    );
    flag.position.set(-6.13, 2.04, 4.1);
    scene.add(flag);

    const hotel = new THREE.Group();
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(12.8, 5.4, 4.2),
      new THREE.MeshStandardMaterial({ color: 0xb69a79, roughness: 0.96 })
    );
    building.position.set(0, 2.7, -3.65);
    building.castShadow = true;
    building.receiveShadow = true;
    hotel.add(building);

    const darkWing = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 4.35, 3.7),
      new THREE.MeshStandardMaterial({ color: COLORS.forestDeep, roughness: 0.88 })
    );
    darkWing.position.set(6.55, 2.2, -3.25);
    darkWing.castShadow = true;
    hotel.add(darkWing);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(8.55, 2.25, 4),
      new THREE.MeshStandardMaterial({ color: COLORS.forest, roughness: 0.92 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 6.2, -3.65);
    roof.scale.z = 0.5;
    roof.castShadow = true;
    hotel.add(roof);

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 0.22, 1.5),
      new THREE.MeshStandardMaterial({ color: COLORS.forestDeep, roughness: 0.86 })
    );
    awning.position.set(0, 3.1, -1.35);
    hotel.add(awning);

    const doorPivot = new THREE.Group();
    doorPivot.position.set(-1.025, 0, -1.52);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 2.8, 0.22),
      new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.66, metalness: 0.05 })
    );
    door.position.set(1.025, 1.4, 0);
    doorPivot.add(door);
    hotel.add(doorPivot);

    const entranceHaloMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.gold,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const entranceHalo = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.08, 42), entranceHaloMaterial);
    entranceHalo.rotation.x = -Math.PI / 2;
    entranceHalo.position.set(0, 0.045, -0.02);
    scene.add(entranceHalo);

    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x442f21,
      emissive: COLORS.warmLight,
      emissiveIntensity: 0.38,
      roughness: 0.28,
      metalness: 0.08
    });
    const windows: THREE.Mesh[] = [];
    for (const x of [-4.65, -2.75, 2.75, 4.65]) {
      const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.42, 0.16), glassMaterial.clone());
      windowMesh.position.set(x, 3.45, -1.52);
      hotel.add(windowMesh);
      windows.push(windowMesh);
    }

    const simulatorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 2.4, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x0b1510, roughness: 0.82 })
    );
    simulatorFrame.position.set(6.55, 2.28, -1.3);
    hotel.add(simulatorFrame);
    const simulatorScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.85, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x527c52, emissive: 0x79ac62, emissiveIntensity: 0.4 })
    );
    simulatorScreen.position.set(6.55, 2.3, -1.18);
    hotel.add(simulatorScreen);

    const signTexture = createSignTexture();
    if (signTexture) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(4.7, 2.2),
        new THREE.MeshBasicMaterial({ map: signTexture })
      );
      sign.position.set(0, 4.75, -1.49);
      hotel.add(sign);
    }

    scene.add(hotel);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(7.1, 0.18, 3.7),
      new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.92 })
    );
    deck.position.set(6.2, 0.09, 0.35);
    deck.receiveShadow = true;
    scene.add(deck);

    const tableCenters = [4.35, 6.25, 8.15];
    for (const x of tableCenters) {
      const tableTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.58, 0.11, 18),
        new THREE.MeshStandardMaterial({ color: 0x4c3529, roughness: 0.9 })
      );
      tableTop.position.set(x, 0.95, 0.2);
      tableTop.castShadow = true;
      scene.add(tableTop);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.13, 0.8, 10),
        new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.88 })
      );
      stem.position.set(x, 0.5, 0.2);
      scene.add(stem);
    }

    const lightBulbs: THREE.Mesh[] = [];
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.warmLight,
      emissive: COLORS.warmLight,
      emissiveIntensity: 1.6,
      roughness: 0.35
    });
    for (let index = 0; index < 10; index += 1) {
      const t = index / 9;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), bulbMaterial.clone());
      bulb.position.set(3.2 + t * 6.5, 4.65 - Math.sin(t * Math.PI) * 0.38, -0.05);
      scene.add(bulb);
      lightBulbs.push(bulb);
      if (index % 3 === 0) {
        const point = new THREE.PointLight(COLORS.warmLight, 0.35, 4.2, 2);
        point.position.copy(bulb.position);
        scene.add(point);
      }
    }

    const bag = new THREE.Group();
    const bagBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.48, 1.55, 12),
      new THREE.MeshStandardMaterial({ color: 0xe3d7c4, roughness: 0.9 })
    );
    bagBody.position.y = 0.9;
    bagBody.rotation.z = -0.08;
    bagBody.castShadow = true;
    bag.add(bagBody);
    for (const x of [-0.18, 0, 0.18]) {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6),
        new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.55, roughness: 0.4 })
      );
      shaft.position.set(x, 2.0 + Math.abs(x), 0);
      shaft.rotation.z = x * 0.45;
      bag.add(shaft);
    }
    bag.position.set(-7.8, 0, 1.7);
    scene.add(bag);

    const trees = [
      addTree(scene, -10.2, -2.5, 1.25),
      addTree(scene, -9.1, 6.2, 0.9),
      addTree(scene, 10.2, -5.5, 1.0),
      addTree(scene, 11.2, 5.4, 0.85)
    ];

    const particleCount = 72;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      particlePositions[index * 3] = (Math.random() - 0.5) * 23;
      particlePositions[index * 3 + 1] = 0.7 + Math.random() * 5.5;
      particlePositions[index * 3 + 2] = -7 + Math.random() * 17;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffd27b,
      size: 0.065,
      transparent: true,
      opacity: 0.58,
      depthWrite: false
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const birdie = makeBirdie();
    scene.add(birdie);

    const avatar = makeAvatar();
    scene.add(avatar);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(260, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const keyDirection = (key: string): Direction | null => {
      if (key === "ArrowUp" || key.toLowerCase() === "w") return "forward";
      if (key === "ArrowDown" || key.toLowerCase() === "s") return "back";
      if (key === "ArrowLeft" || key.toLowerCase() === "a") return "left";
      if (key === "ArrowRight" || key.toLowerCase() === "d") return "right";
      return null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyDirection(event.key);
      if (!direction) return;
      event.preventDefault();
      heldRef.current.add(direction);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = keyDirection(event.key);
      if (direction) heldRef.current.delete(direction);
    };
    const clearHeld = () => heldRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeld);
    window.addEventListener("pointerup", clearHeld);

    const velocity = new THREE.Vector2();
    const input = new THREE.Vector2();
    const targetVelocity = new THREE.Vector2();
    const clock = new THREE.Clock();
    let frame = 0;
    let walkPhase = 0;
    let targetRotation = Math.PI;

    const resolveMovement = (nextX: number, nextZ: number) => {
      let x = THREE.MathUtils.clamp(nextX, -8.8, 9.2);
      let z = THREE.MathUtils.clamp(nextZ, -0.45, 9.35);

      // The player can reach the entrance, but cannot walk through the hotel facade.
      if (z < 0.35 && Math.abs(x) > 1.08 && Math.abs(x) < 9.15) z = 0.35;

      // Terrace furniture gets simple soft collision circles so the world feels physical.
      for (const tableX of tableCenters) {
        const resolved = pushOutsideCircle(x, z, tableX, 0.2, 0.8);
        x = resolved.x;
        z = resolved.z;
      }
      return { x, z };
    };

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      input.set(0, 0);
      if (heldRef.current.has("forward")) input.y -= 1;
      if (heldRef.current.has("back")) input.y += 1;
      if (heldRef.current.has("left")) input.x -= 1;
      if (heldRef.current.has("right")) input.x += 1;
      if (input.lengthSq() > 1) input.normalize();

      targetVelocity.copy(input).multiplyScalar(3.8);
      const response = 1 - Math.exp(-dt * (input.lengthSq() > 0 ? 8.5 : 6.2));
      velocity.lerp(targetVelocity, response);
      if (input.lengthSq() === 0 && velocity.lengthSq() < 0.006) velocity.set(0, 0);

      const previousX = avatar.position.x;
      const previousZ = avatar.position.z;
      const resolved = resolveMovement(previousX + velocity.x * dt, previousZ + velocity.y * dt);
      avatar.position.x = resolved.x;
      avatar.position.z = resolved.z;
      if (Math.abs(resolved.x - (previousX + velocity.x * dt)) > 0.02) velocity.x *= 0.15;
      if (Math.abs(resolved.z - (previousZ + velocity.y * dt)) > 0.02) velocity.y *= 0.15;

      const moving = velocity.lengthSq() > 0.025;
      if (moving) {
        targetRotation = Math.atan2(velocity.x, velocity.y) + Math.PI;
        walkPhase += dt * (8.6 + Math.min(3.5, velocity.length()));
      }
      let rotationDelta = targetRotation - avatar.rotation.y;
      rotationDelta = Math.atan2(Math.sin(rotationDelta), Math.cos(rotationDelta));
      avatar.rotation.y += rotationDelta * Math.min(1, dt * 8.5);

      const zone = identifyZone(avatar.position.x, avatar.position.z);
      if (zone !== zoneRef.current) {
        zoneRef.current = zone;
        setWorldZone(zone);
        onZoneChangeRef.current?.(zone);
      }

      const { leftLegPivot, rightLegPivot, leftArmPivot, rightArmPivot, torso } = avatar.userData as {
        leftLegPivot: THREE.Group;
        rightLegPivot: THREE.Group;
        leftArmPivot: THREE.Group;
        rightArmPivot: THREE.Group;
        torso: THREE.Mesh;
      };
      const strideStrength = Math.min(1, velocity.length() / 2.8);
      const stride = moving ? Math.sin(walkPhase) * 0.48 * strideStrength : 0;
      leftLegPivot.rotation.x += (stride - leftLegPivot.rotation.x) * 0.2;
      rightLegPivot.rotation.x += (-stride - rightLegPivot.rotation.x) * 0.2;
      leftArmPivot.rotation.x += (-stride * 0.72 - leftArmPivot.rotation.x) * 0.2;
      rightArmPivot.rotation.x += (stride * 0.72 - rightArmPivot.rotation.x) * 0.2;
      torso.position.y = 1.35 + (moving ? Math.abs(Math.sin(walkPhase * 2)) * 0.035 * strideStrength : Math.sin(elapsed * 1.4) * 0.012);

      const entranceDistance = Math.hypot(avatar.position.x, avatar.position.z + 0.08);
      const entranceNear = entranceDistance < 2.1;
      const doorTarget = entranceNear ? -0.42 : 0;
      doorPivot.rotation.y += (doorTarget - doorPivot.rotation.y) * Math.min(1, dt * 3.7);
      entranceHaloMaterial.opacity = (entranceNear ? 0.46 : 0.18) + Math.sin(elapsed * 2.4) * (entranceNear ? 0.09 : 0.025);
      const haloScale = entranceNear ? 1.05 + Math.sin(elapsed * 2.2) * 0.04 : 0.94;
      entranceHalo.scale.setScalar(haloScale);

      const cameraTargetX = avatar.position.x * 0.23;
      const cameraTargetZ = 15.25 + Math.max(0, avatar.position.z - 7) * 0.1;
      camera.position.x += (cameraTargetX - camera.position.x) * (1 - Math.exp(-dt * 2.0));
      camera.position.z += (cameraTargetZ - camera.position.z) * (1 - Math.exp(-dt * 1.55));
      const lookX = avatar.position.x * 0.16;
      const lookZ = zone === "Hotel Entrance" ? -1.55 : zone === "Terrace" ? -0.3 : -1.15;
      camera.lookAt(lookX, 2.15, lookZ);

      trees.forEach((tree, index) => {
        tree.rotation.z = Math.sin(elapsed * 0.55 + index) * 0.012;
        tree.rotation.x = Math.cos(elapsed * 0.43 + index) * 0.008;
      });
      lightBulbs.forEach((bulb, index) => {
        const material = bulb.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 1.35 + Math.sin(elapsed * 1.7 + index * 0.7) * 0.25;
      });
      pathLanterns.forEach((lamp, index) => {
        const material = lamp.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.95 + Math.sin(elapsed * 1.15 + index * 0.55) * 0.14;
      });
      windows.forEach((windowMesh, index) => {
        const material = windowMesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.32 + Math.sin(elapsed * 0.7 + index) * 0.05;
      });
      const simulatorMaterial = simulatorScreen.material as THREE.MeshStandardMaterial;
      simulatorMaterial.emissiveIntensity = 0.38 + Math.sin(elapsed * 1.1) * 0.08;
      particles.rotation.y = elapsed * 0.018;
      particles.position.y = Math.sin(elapsed * 0.35) * 0.08;

      flag.rotation.y = Math.sin(elapsed * 1.15) * 0.13;
      flag.scale.x = 1 + Math.sin(elapsed * 2.1) * 0.025;

      const birdRadius = 3.3;
      const birdAngle = elapsed * 0.42;
      birdie.position.set(
        Math.cos(birdAngle) * birdRadius,
        5.8 + Math.sin(elapsed * 1.6) * 0.22,
        -0.8 + Math.sin(birdAngle) * 1.2
      );
      birdie.rotation.y = -birdAngle + Math.PI / 2;
      const { leftWing, rightWing } = birdie.userData as { leftWing: THREE.Mesh; rightWing: THREE.Mesh };
      const wingBeat = Math.sin(elapsed * 8.5) * 0.45;
      leftWing.rotation.z = Math.PI / 2 + wingBeat;
      rightWing.rotation.z = -Math.PI / 2 - wingBeat;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeld);
      window.removeEventListener("pointerup", clearHeld);
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
      entranceHaloMaterial.dispose();
      signTexture?.dispose();
    };
  }, []);

  const press = (direction: Direction) => heldRef.current.add(direction);
  const release = (direction: Direction) => heldRef.current.delete(direction);

  return (
    <section className="world-stage" aria-label="Interactive Birdie and Breakfast hotel exterior">
      <div className="world-meta">
        <div>
          <p className="eyebrow">Hotel Hub · Golden Hour Sandbox</p>
          <strong>Welcome home. Walk the path, explore the grounds.</strong>
        </div>
        <div className="world-meta-status">
          <span className="zone-chip">{worldZone}</span>
          <span>WASD / arrows · touch controls</span>
        </div>
      </div>
      {webglAvailable ? (
        <div className="three-mount" ref={mountRef} />
      ) : (
        <div className="webgl-fallback">
          <strong>Compatibility view</strong>
          <p>WebGL is unavailable on this browser. Golf History, Ball Vault and Personal Birdie remain usable below.</p>
        </div>
      )}
      <div className="touch-controls" aria-label="Avatar touch controls">
        <button onPointerDown={() => press("forward")} onPointerUp={() => release("forward")} onPointerCancel={() => release("forward")} onPointerLeave={() => release("forward")}>↑</button>
        <div>
          <button onPointerDown={() => press("left")} onPointerUp={() => release("left")} onPointerCancel={() => release("left")} onPointerLeave={() => release("left")}>←</button>
          <button onPointerDown={() => press("back")} onPointerUp={() => release("back")} onPointerCancel={() => release("back")} onPointerLeave={() => release("back")}>↓</button>
          <button onPointerDown={() => press("right")} onPointerUp={() => release("right")} onPointerCancel={() => release("right")} onPointerLeave={() => release("right")}>→</button>
        </div>
      </div>
    </section>
  );
}
