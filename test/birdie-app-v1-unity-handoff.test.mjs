import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "client", "birdie-app-v1", "src");
const manifestPath = join(
  sourceRoot,
  "contracts",
  "birdieworld-estate-handoff-v1.json"
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const scene = await readFile(join(sourceRoot, "ImmersiveEstateScene.tsx"), "utf8");
const estateContract = await readFile(join(sourceRoot, "estateContract.ts"), "utf8");
const destinations = await readFile(join(sourceRoot, "birdieDestinations.ts"), "utf8");

const registryIds = (source, registryName) => {
  const body = source.match(
    new RegExp(`${registryName} = \\[([\\s\\S]*?)\\] as const`)
  )?.[1] ?? "";
  return [...body.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
};

test("Unity handoff has one explicit version and preserves the V0.3.5 source", () => {
  assert.equal(manifest.contractVersion, "birdieworld-estate-handoff-v1");
  assert.equal(
    manifest.sourcePresentationContract,
    "birdieworld-immersive-estate-v0.3.5"
  );
  assert.equal(manifest.worldId, "birdie-estate");
  assert.equal(manifest.units, "meters");
});

test("Unity coordinate conversion is explicit and deterministic", () => {
  assert.equal(manifest.coordinateSpace.canonical.handedness, "right-handed");
  assert.deepEqual(manifest.coordinateSpace.unityAdapter.position, ["x", "y", "-z"]);
  assert.equal(manifest.coordinateSpace.unityAdapter.yawMultiplier, -1);

  const spawn = manifest.player.spawn;
  const unitySpawn = { x: spawn.x, y: spawn.y, z: -spawn.z };
  assert.deepEqual(unitySpawn, { x: 0, y: 0.08, z: -46 });

  const hotel = manifest.landmarks.find(({ id }) => id === "birdie-hotel").anchor;
  assert.deepEqual(
    { x: hotel.x, y: hotel.y, z: -hotel.z },
    { x: 0, y: 0, z: 22 }
  );
});

test("district and interaction IDs stay renderer-neutral and aligned", () => {
  assert.deepEqual(
    [...manifest.districts.map(({ id }) => id)].sort(),
    [...registryIds(estateContract, "ESTATE_DISTRICT_IDS")].sort()
  );
  assert.deepEqual(
    manifest.interactionAnchors.map(({ id }) => id),
    registryIds(estateContract, "ESTATE_INTERACTION_IDS")
  );
  assert.deepEqual(
    manifest.productDestinations,
    registryIds(destinations, "BIRDIE_V1_DESTINATION_IDS")
  );
  assert.deepEqual(
    manifest.districts.map(({ priority }) => priority),
    [1, 2, 3, 4, 5, 6]
  );
  assert.deepEqual(
    manifest.districts.map(({ id }) => id),
    ["arrival-court", "golf-course", "terrace", "stables", "hotel", "estate-grounds"]
  );
});

test("the WebGL scene consumes the same handoff data Unity will consume", () => {
  assert.match(scene, /from "\.\/estateWorldManifest"/);
  assert.match(scene, /data-estate-handoff=\{ESTATE_WORLD_HANDOFF_VERSION\}/);
  for (const exportedValue of [
    "ESTATE_WORLD_MANIFEST",
    "ESTATE_WORLD_COLORS as COLORS",
    "ESTATE_DISTRICT_RESOLVERS",
    "ESTATE_COLLISION_RECTANGLES as BUILDING_COLLISIONS",
    "ESTATE_COLLISION_CIRCLES as ROUND_COLLISIONS",
    "ESTATE_INTERACTION_ANCHORS as PRIVATE_INTERACTION_POINTS",
    "ESTATE_TREE_INSTANCES as TREE_POSITIONS"
  ]) {
    assert.ok(scene.includes(exportedValue), `${exportedValue} is not wired`);
  }
  assert.doesNotMatch(scene, /const COLORS = \{/);
  assert.doesNotMatch(scene, /const TREE_POSITIONS = \[/);
});

test("handoff captures the estate blockout and golden color grade", () => {
  assert.deepEqual(manifest.worldBounds.groundSize, { x: 150, z: 118 });
  assert.equal(manifest.treeInstances.length, 56);
  assert.equal(manifest.collisionShapes.rectangles.length, 2);
  assert.equal(manifest.collisionShapes.circles.length, 1);
  assert.equal(manifest.visual.colorGradeVersion, "golden-estate-v0.3.5");
  assert.equal(manifest.visual.palette.forestNight, "#10271c");
  assert.equal(manifest.visual.palette.fairway, "#88a94f");
  assert.equal(manifest.visual.palette.water, "#2d6b70");
  assert.equal(manifest.visual.palette.gold, "#d0aa43");
  assert.equal(manifest.visual.lighting.toneMapping, "ACES-filmic");
});

test("quests and authoritative systems remain outside the Unity handoff", () => {
  assert.deepEqual(manifest.capabilities, {
    quests: false,
    progression: false,
    multiplayer: false,
    persistentWorldState: false,
    teleport: false,
    locationTracking: false
  });
  assert.deepEqual(manifest.governance, {
    containsCanonicalBusinessState: false,
    containsPersonalData: false,
    grantsWriteAuthority: false,
    unknownAdditiveFieldsMayBeIgnored: true
  });
});
