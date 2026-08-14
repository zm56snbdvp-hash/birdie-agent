import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "client", "birdie-app-v1");
const sourceRoot = join(clientRoot, "src");
const readSource = (name) => readFile(join(sourceRoot, name), "utf8");

const app = await readSource("App.tsx");
const scene = await readSource("ImmersiveEstateScene.tsx");
const worldLoader = await readSource("EstateWorld.tsx");
const fallback = await readSource("EstateFallbackWorld.tsx");
const contract = await readSource("estateContract.ts");
const hud = await readSource("EstateHud.tsx");
const map = await readSource("EstateMap.tsx");
const dialogue = await readSource("EstateNpcDialogue.tsx");
const featurePanel = await readSource("EstateFeaturePanel.tsx");
const destinations = await readSource("birdieDestinations.ts");
const styles = await readSource("styles.css");
const index = await readFile(join(clientRoot, "index.html"), "utf8");
const vite = await readFile(join(clientRoot, "vite.config.ts"), "utf8");
const packageJson = JSON.parse(await readFile(join(clientRoot, "package.json"), "utf8"));

test("Immersive Estate has one explicit V0.3.1 presentation contract", () => {
  assert.match(contract, /ESTATE_CONTRACT_VERSION =\s*\n?\s*"birdieworld-immersive-estate-v0\.3\.1"/);
  const districtRegistry = contract.match(/ESTATE_DISTRICT_IDS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  const districts = [...districtRegistry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(districts, ["arrival-court", "hotel", "golf-course", "terrace", "stables", "estate-grounds"]);
  const interactionRegistry = contract.match(/ESTATE_INTERACTION_IDS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  const interactions = [...interactionRegistry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(interactions, ["hotel-reception", "greenkeeper", "stable-guide"]);
});

test("estate places never expand the three locked product destinations", () => {
  const destinationRegistry = destinations.match(/BIRDIE_V1_DESTINATION_IDS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  const destinationIds = [...destinationRegistry.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(destinationIds, ["golf-history", "ball-vault", "personal-birdie"]);
  assert.match(contract, /BirdieWorldDestination/);
  assert.doesNotMatch(contract, /"horse-profile"|"hotel-booking"|"stable-management"/);
  assert.match(app, /LEGACY_ZONE_BY_ESTATE/);
});

test("the world is the full viewport and product functions are overlays", () => {
  assert.match(app, /className="estate-app"/);
  assert.match(app, /data-immersive-estate=\{ESTATE_CONTRACT_VERSION\}/);
  assert.match(styles, /html,[\s\S]*?body,[\s\S]*?#root \{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.estate-app \{[\s\S]*?height: 100dvh;[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.estate-world,[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  assert.match(featurePanel, /role="dialog"/);
  assert.match(featurePanel, /aria-modal="false"/);
  assert.doesNotMatch(app, /scrollIntoView/);
});

test("all three existing functions receive their own accessible menu control", () => {
  assert.match(hud, /aria-label="BirdieWorld Funktionen"/);
  assert.match(hud, /BIRDIE_V1_DESTINATIONS\.map/);
  assert.match(hud, /aria-haspopup="dialog"/);
  assert.match(hud, /aria-expanded=\{active\}/);
  assert.match(hud, /inert=\{controlsDisabled \? true : undefined\}/);
  assert.match(hud, /aria-hidden=\{controlsDisabled \? true : undefined\}/);
  assert.match(hud, /ArrowDown/);
  assert.match(hud, /ArrowRight/);
  assert.match(hud, /Home/);
  assert.match(hud, /End/);
});

test("mobile Birdie stays globally available without covering open overlay headers", () => {
  assert.match(styles, /data-estate-overlay-open="true"\] \.birdie-companion__launcher \{/);
  assert.match(styles, /top: calc\(9px \+ env\(safe-area-inset-top\)\);/);
  assert.match(styles, /width: 48px;/);
  assert.match(styles, /data-estate-overlay-open="true"\] \.birdie-companion__launcher-copy/);
});

test("Birdie remains global and every function returns to the host", () => {
  assert.match(app, /<BirdieCompanion/);
  assert.match(app, /dockAfterOrientation/);
  assert.match(app, /onChoose=\{openDestination\}/);
  assert.match(featurePanel, /Zurück zu Birdie/);
  assert.match(app, /returnToBirdieHost\(current\)/);
  assert.match(app, /setGuideRequestId\(\(current\) => current \+ 1\)/);
});

test("NPC encounters are deterministic, coarse and session-only", () => {
  assert.match(contract, /sessionOnly: true/);
  assert.match(dialogue, /data-session-only="true"/);
  assert.match(dialogue, /Geskriptete Begegnung · nur diese Sitzung/);
  assert.match(scene, /nearestInteraction/);
  assert.match(scene, /createEstateInteractionEvent/);
  const runtimeSurface = [scene, fallback, contract, dialogue].join("\n");
  for (const token of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /navigator\.geolocation/]) {
    assert.doesNotMatch(runtimeSurface, token);
  }
});

test("WebGL lifecycle and performance guardrails are explicit", () => {
  assert.ok(scene.indexOf('canvas.getContext("webgl2"') < scene.indexOf("new THREE.WebGLRenderer"));
  assert.match(scene, /Math\.min\(window\.devicePixelRatio \|\| 1, 1\.75\)/);
  assert.match(scene, /THREE\.InstancedMesh/);
  assert.match(scene, /visibilitychange/);
  assert.match(scene, /webglcontextlost/);
  assert.match(scene, /updatePausedLoopRef\.current = \(nextPaused\)/);
  assert.match(scene, /if \(nextPaused\) stopLoop\(\)/);
  assert.match(scene, /data-scene-ready/);
  assert.match(scene, /data-render-mode/);
  assert.match(scene, /data-estate-zone/);
  assert.match(scene, /data-nearby-interaction/);
});

test("one-thumb drag and a true third-person camera replace the visible D-pad as primary movement", () => {
  assert.match(scene, /new THREE\.PerspectiveCamera/);
  assert.doesNotMatch(scene, /new THREE\.OrthographicCamera/);
  assert.match(scene, /data-estate-camera-mode="third-person-follow"/);
  assert.match(scene, /data-estate-touch-input="drag-to-move"/);
  assert.match(scene, /setPointerCapture/);
  assert.match(scene, /DRAG_DEAD_ZONE/);
  assert.match(scene, /dragBasisForward/);
  assert.match(scene, /dragControl/);
  assert.match(scene, /resolveCameraDistance/);
  assert.match(scene, /data-estate-drag-joystick/);
  assert.match(scene, /Alternative Richtungstasten umschalten/);
  assert.match(styles, /\.immersive-estate-scene__thumbstick/);
  assert.match(styles, /\.immersive-estate-scene__touch-alternative/);
});

test("the fallback retains hotel, golf, stables and all interactions", () => {
  assert.match(fallback, /Das vollständige Birdie &amp; Breakfast Grundstück/);
  for (const label of ["Birdie Hotel", "Golfplatz", "Reiterhof", "Ankunftshof"]) {
    assert.match(fallback, new RegExp(label));
  }
  assert.match(fallback, /ESTATE_DISTRICTS\.map/);
  assert.match(fallback, /ESTATE_INTERACTIONS\.map/);
  assert.match(fallback, /disabled=\{paused\}/);
});

test("map orientation never becomes a teleport or location-data surface", () => {
  assert.match(map, /Zwischen den Orten gehst du selbst/);
  assert.match(map, /ohne Teleport und ohne Standortdaten/);
  assert.doesNotMatch(map, /onDistrictChange|geolocation|latitude|longitude/i);
});

test("production bundles React and Three instead of relying on runtime CDNs", () => {
  assert.doesNotMatch(index, /importmap|esm\.sh/);
  assert.doesNotMatch(vite, /external:/);
  assert.match(worldLoader, /lazy\(async \(\) =>/);
  assert.match(worldLoader, /supportsWebgl2/);
  assert.match(worldLoader, /import\("\.\/ImmersiveEstateScene"\)/);
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit -p tsconfig.json");
});
