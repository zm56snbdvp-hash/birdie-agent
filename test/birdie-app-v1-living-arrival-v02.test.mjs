import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "client", "birdie-app-v1");
const sourceRoot = join(clientRoot, "src");
const readSource = (name) => readFile(join(sourceRoot, name), "utf8");

const host = await readSource("hostJourney.ts");
const app = await readSource("App.tsx");
const companion = await readSource("BirdieCompanion.tsx");
const loop = await readSource("arrivalLoop.ts");
const guide = await readSource("ArrivalLoopGuide.tsx");
const destinations = await readSource("birdieDestinations.ts");
const context = await readSource("worldContext.ts");
const scene = await readSource("ThreeHotelScene.tsx");
const fallback = await readSource("WebglFallbackWorld.tsx");
const heartbeat = await readSource("WorldHeartbeat.tsx");
const atmosphere = await readSource("WorldAtmosphere.tsx");
const styles = await readSource("styles.css");
const companionStyles = await readSource("birdieCompanion.css");
const index = await readFile(join(clientRoot, "index.html"), "utf8");

const hostSurface = [host, companion, app, heartbeat, fallback].join("\n");
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

test("Living Arrival has one ordered Birdie-as-Host V0.2 contract", () => {
  assert.match(host, /BIRDIE_HOST_JOURNEY_VERSION = "birdie-as-host-v0\.2"/);
  const registry = host.match(
    /BIRDIE_HOST_JOURNEY_STAGES = \[([\s\S]*?)\] as const/
  )?.[1] ?? "";
  const stages = [...registry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(stages, [
    "noticed",
    "welcomed",
    "oriented",
    "invited",
    "return-to-birdie"
  ]);
});

test("the accepted Arrival Loop V0.1 remains the rollback contract", () => {
  assert.match(loop, /BIRDIE_ARRIVAL_LOOP_VERSION = "birdie-arrival-loop-v0\.1"/);
  assert.match(guide, /data-arrival-loop="birdie-arrival-loop-v0\.1"/);
  assert.match(guide, /data-host-action="return-to-birdie"/);
});

test("V0.2 wires every host stage to a visible session transition", () => {
  assert.match(host, /stage: "noticed"/);
  assert.match(companion, /onHostStageChangeRef\.current\?\.\("welcomed"\)/);
  assert.match(companion, /onHostStageChangeRef\.current\?\.\("oriented"\)/);
  assert.match(app, /inviteFromBirdie\(current, hotspot\)/);
  assert.match(app, /returnToBirdieHost\(current\)/);
  assert.match(companion, /Da bist du wieder\./);
});

test("V0.2 reuses exactly the three locked destinations and V1 world context", () => {
  const registry = destinations.match(
    /BIRDIE_V1_DESTINATION_IDS = \[([\s\S]*?)\] as const/
  )?.[1] ?? "";
  const ids = [...registry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["golf-history", "ball-vault", "personal-birdie"]);
  assert.match(atmosphere, /export type WorldHotspotId = BirdieWorldDestination/);
  assert.match(context, /BIRDIE_WORLD_CONTEXT_VERSION = "birdie-world-context-v1"/);
});

test("the Host Spine stays transient and grants no new runtime authority", () => {
  for (const token of forbiddenRuntimeTokens) assert.doesNotMatch(hostSurface, token);
  assert.doesNotMatch(host, /identity|permission|authority|quest|coin|multiplayer|voice|gps/i);
});

test("the first-ten-second surface is one German hospitality narrative", () => {
  assert.match(index, /<html lang="de">/);
  assert.match(index, /<title>BirdieWorld – Living Arrival V0\.2<\/title>/);
  assert.match(app, /Du bist da\. Birdie auch\./);
  assert.match(companion, /Schön, dass du da bist\./);
  assert.match(companion, /Ich bin Birdie\. Komm erst einmal an/);
});

test("WebGL is preflighted before Three renderer construction", () => {
  const preflightIndex = scene.indexOf('canvas.getContext("webgl2"');
  const rendererIndex = scene.indexOf("new THREE.WebGLRenderer");
  assert.ok(preflightIndex >= 0);
  assert.ok(rendererIndex > preflightIndex);
  assert.match(scene, /canvas: renderTarget\.canvas/);
  assert.match(scene, /context: renderTarget\.context/);
});

test("movement keys are scene-scoped and touch controls are accessible", () => {
  assert.match(scene, /mount\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(scene, /mount\.addEventListener\("keyup", onKeyUp\)/);
  assert.doesNotMatch(scene, /window\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(scene, /tabIndex=\{0\}/);
  assert.match(scene, /\{webglAvailable && \(/);
  for (const label of [
    "Vorwärts gehen",
    "Rückwärts gehen",
    "Nach links gehen",
    "Nach rechts gehen"
  ]) assert.match(scene, new RegExp(`aria-label="${label}"`));
});

test("the compatibility view preserves the spatial arrival story", () => {
  assert.match(fallback, /data-webgl-fallback="spatial-v0\.2"/);
  for (const landmark of [
    "fallback-hotel",
    "fallback-path",
    "fallback-green",
    "fallback-terrace",
    "fallback-birdie"
  ]) assert.match(fallback, new RegExp(landmark));
  assert.match(fallback, /Ankunftsweg, Putting Green,/);
});

test("the living-world heartbeat is quiet, coarse and reset on return", () => {
  assert.match(heartbeat, /data-world-heartbeat="living-world-heartbeat-v0\.2"/);
  assert.match(heartbeat, /nur in dieser Sitzung/);
  assert.doesNotMatch(heartbeat, /aria-live|role="status"/);
  assert.doesNotMatch(heartbeat, /timestamp|people|players|friends|online/i);
  assert.match(app, /setWorldTarget\(null\)/);
});

test("destination and return navigation restore an accessible focus story", () => {
  assert.equal((app.match(/tabIndex=\{-1\}/g) ?? []).length, 3);
  assert.match(app, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /aria-live="polite"/);
  assert.match(app, /prefersReducedMotion\(\) \? "auto" : "smooth"/);
  assert.equal((app.match(/renderArrivalGuide\("/g) ?? []).length, 3);
  assert.match(guide, /Zurück zu Birdie/);
});

test("basic mobile accessibility remains visible and touch-sized", () => {
  assert.match(app, /role="region"/);
  assert.match(companionStyles, /\.birdie-companion__close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(companionStyles, /\.birdie-companion__primary \{[\s\S]*?min-height: 44px;/);
  assert.match(companionStyles, /@media \(max-width: 430px\)[\s\S]*?\.birdie-companion__bird \{[\s\S]*?display: block;/);
  assert.match(styles, /\.world-hotspot \{[^}]*width: 48px;[^}]*height: 48px;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
