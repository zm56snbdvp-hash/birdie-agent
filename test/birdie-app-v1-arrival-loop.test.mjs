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
  assert.match(app, /arriveAtBirdieDestination\(current, hotspot\)/);
  assert.match(app, /target\?\.scrollIntoView/);
});

test("the destination renders a visible return guide", () => {
  assert.match(loop, /Du bist angekommen/);
  assert.match(guide, /Zurück zu Birdie/);
  assert.match(app, /renderArrivalGuide\("golf-history"\)/);
  assert.match(app, /renderArrivalGuide\("ball-vault"\)/);
  assert.match(app, /renderArrivalGuide\("personal-birdie"\)/);
});

test("returning closes the arrival and requests the Birdie guide", () => {
  assert.match(app, /returnFromBirdieDestination\(current\)/);
  assert.match(app, /setGuideRequestId\(\(current\) => current \+ 1\)/);
  assert.match(companion, /guideRequestId/);
  assert.match(companion, /setPhase\("guide"\)/);
  assert.match(companion, /setOpen\(true\)/);
});

test("return navigation leads back to the existing world composition", () => {
  assert.match(app, /worldCompositionRef/);
  assert.match(app, /worldCompositionRef\.current\?\.scrollIntoView/);
});

test("loop performs no network, model or cross-window call", () => {
  for (const token of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /postMessage\s*\(/]) {
    assert.doesNotMatch(combined, token);
  }
});

test("desktop hotspot cards use equal minmax columns", () => {
  assert.match(styles, /\.hotspots \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.panel \{[^}]*min-width: 0/);
});

test("tablet cards collapse without squeezing Personal Birdie", () => {
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?\.personal-birdie \{ grid-column: 1 \/ -1/);
});

test("phone cards stay single-column and copy can wrap", () => {
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.hotspots \{ grid-template-columns: 1fr/);
  assert.match(styles, /overflow-wrap: anywhere/);
});
