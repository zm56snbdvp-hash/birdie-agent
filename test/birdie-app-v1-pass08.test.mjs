import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "client", "birdie-app-v1", "src");
const read = (name) => readFile(join(sourceRoot, name), "utf8");

const destinations = await read("birdieDestinations.ts");
const context = await read("worldContext.ts");
const cues = await read("birdieWorldCue.ts");
const companion = await read("BirdieCompanion.tsx");
const bridge = await read("useBirdieWorldBridge.ts");
const scene = await read("ThreeHotelScene.tsx");
const app = await read("App.tsx");

const destinationIds = ["golf-history", "ball-vault", "personal-birdie"];
const zoneIds = [
  "arrival-path",
  "hotel-entrance",
  "putting-green",
  "terrace",
  "hotel-grounds"
];

const combinedSource = [destinations, context, cues, companion, bridge].join("\n");
const forbiddenRuntimeTokens = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /localStorage/,
  /sessionStorage/,
  /document\.cookie/,
  /indexedDB/,
  /navigator\.geolocation/,
  /postMessage\s*\(/
];

test("one registry contains exactly the three bounded V1 destinations", () => {
  const registry = destinations.match(
    /BIRDIE_V1_DESTINATION_IDS = \[([\s\S]*?)\] as const/
  )?.[1] ?? "";
  const ids = [...registry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, destinationIds);
  for (const id of destinationIds) {
    assert.match(destinations, new RegExp(`id: "${id}"`));
    assert.match(app, new RegExp(`id="${id}"`));
  }
});

test("world projection is versioned, coarse and exactly five zones", () => {
  assert.match(context, /BIRDIE_WORLD_CONTEXT_VERSION = "birdie-world-context-v1"/);
  assert.match(context, /BIRDIE_WORLD_CONTEXT_PRECISION = "coarse-zone"/);
  const registry = context.match(
    /BIRDIE_WORLD_ZONE_IDS = \[([\s\S]*?)\] as const/
  )?.[1] ?? "";
  const ids = [...registry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, zoneIds);
});

test("projection excludes coordinates, identity and authority", () => {
  const block = context.match(
    /export interface BirdieWorldContextProjection \{([\s\S]*?)\n\}/
  )?.[1] ?? "";
  for (const field of [
    "x", "y", "z", "latitude", "longitude", "coordinates", "route",
    "history", "userId", "email", "role", "permission", "authority",
    "quest", "coins", "multiplayer", "model", "token"
  ]) {
    assert.doesNotMatch(block, new RegExp(`\\b${field}\\??:`));
  }
});

test("bridge stays transient and recommendations require an explicit click", () => {
  assert.match(bridge, /useState<BirdieWorldContextProjection>/);
  assert.match(companion, /onClick=\{\(\) => choose\(destination\.id\)\}/);
  assert.match(companion, /if \(onChoose\) onChoose\(destination\)/);
  assert.doesNotMatch(context, /scrollIntoView|onChoose|setOpen/);
  assert.doesNotMatch(cues, /scrollIntoView|onChoose|setOpen/);
  for (const token of forbiddenRuntimeTokens) assert.doesNotMatch(combinedSource, token);
});

test("Three.js emits only coarse zone labels and App performs the conversion", () => {
  assert.match(scene, /onZoneChange\?: \(zone: WorldZone\) => void/);
  assert.match(scene, /onZoneChangeRef\.current\?\.\(zone\)/);
  assert.match(scene, /onZoneChangeRef\.current\?\.\(zoneRef\.current\)/);
  assert.match(app, /useBirdieWorldBridge/);
  assert.match(app, /onZoneChange=\{onSceneZoneChange\}/);
  assert.match(app, /worldContext=\{worldContext\}/);
});

test("there is one companion and the existing Pass-04 hotspots remain", () => {
  assert.equal((app.match(/<BirdieCompanion/g) ?? []).length, 1);
  assert.match(app, /<WorldAtmosphere onOpenHotspot=\{openWorldHotspot\}/);
  assert.match(app, /onChoose=\{openWorldHotspot\}/);
  assert.doesNotMatch(combinedSource, /visitedZones|placesVisited|progressCount/);
});
