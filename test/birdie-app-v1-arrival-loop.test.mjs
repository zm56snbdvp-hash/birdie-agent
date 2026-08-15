import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "client", "birdie-app-v1", "src");
const read = (name) => readFile(join(sourceRoot, name), "utf8");

const loop = await read("arrivalLoop.ts");
const guide = await read("ArrivalLoopGuide.tsx");
const app = await read("App.tsx");
const companion = await read("BirdieCompanion.tsx");
const styles = await read("styles.css");
const combined = [loop, guide, app, companion].join("\n");

test("arrival loop has one explicit V0.1 contract", () => {
  assert.match(loop, /BIRDIE_ARRIVAL_LOOP_VERSION = "birdie-arrival-loop-v0\.1"/);
  assert.match(guide, /data-arrival-loop="birdie-arrival-loop-v0\.1"/);
});

test("arrival state is session-local React state", () => {
  assert.match(app, /useState\(INITIAL_BIRDIE_ARRIVAL_LOOP\)/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test("loop phases are bounded to ready, arrived and returned", () => {
  assert.match(loop, /phase: "ready" \| "arrived" \| "returned"/);
  assert.match(loop, /phase: "arrived"/);
  assert.match(loop, /phase: "returned"/);
});

test("arrival destinations reuse the locked V1 destination type", () => {
  assert.match(loop, /type BirdieWorldDestination/);
  assert.doesNotMatch(loop, /quest|coin|multiplayer|permission|authority/i);
});

test("choosing a hotspot records an arrival before navigation", () => {
  assert.match(app, /arriveAtBirdieDestination\(current, destination\)/);
  assert.match(app, /setActiveDestination\(destination\)/);
});

test("the destination renders a visible return guide", () => {
  assert.match(loop, /Du bist angekommen/);
  assert.match(guide, /Zurück zu Birdie/);
  assert.match(app, /renderArrivalGuide\(destination\)/);
  assert.match(app, /destination === "golf-history"/);
  assert.match(app, /destination === "ball-vault"/);
});

test("returning closes the arrival and requests the Birdie guide", () => {
  assert.match(app, /returnFromBirdieDestination\(current\)/);
  assert.match(app, /setGuideRequestId\(\(current\) => current \+ 1\)/);
  assert.match(companion, /guideRequestId/);
  assert.match(companion, /setPhase\("guide"\)/);
  assert.match(companion, /setOpen\(true\)/);
});

test("return navigation closes the overlay and restores the Birdie guide", () => {
  assert.match(app, /setActiveDestination\(null\)/);
  assert.match(app, /returnToBirdieHost\(current\)/);
  assert.match(app, /setGuideRequestId\(\(current\) => current \+ 1\)/);
});

test("loop performs no network, model or cross-window call", () => {
  for (const token of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /postMessage\s*\(/]) {
    assert.doesNotMatch(combined, token);
  }
});

test("desktop uses a full-height world with overlay feature panels", () => {
  assert.match(styles, /\.estate-app \{[\s\S]*?height: 100dvh;/);
  assert.match(styles, /\.estate-panel-overlay \{[\s\S]*?position: absolute;/);
  assert.match(styles, /\.estate-feature-panel__body \{[\s\S]*?overflow: auto;/);
});

test("tablet keeps the world primary while narrowing the function dock", () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.estate-function-nav \{ width: 162px;/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.estate-panel-overlay \{ padding-left: 194px;/);
});

test("phone uses a bottom function dock and internally scrollable sheets", () => {
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.estate-function-nav \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.estate-panel-overlay \{/);
  assert.match(styles, /overflow-wrap: anywhere/);
});
