import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UX_BOTTOM_NAV,
  UX_SCREEN_IDS,
  createRoundModeUxPrototype,
  createSandboxUxFixture
} from "../src/round-mode/ux-prototype.mjs";

test("UX fixture is synthetic, sandbox-only and platform-neutral", () => {
  const fixture = createSandboxUxFixture();
  assert.equal(fixture.sandbox, true);
  assert.equal(fixture.dataClassification, "SYNTHETIC_ONLY");
  assert.equal(fixture.platformDecision, "UNDECIDED");
  assert.equal(fixture.hardwareIdentification, "ABSTRACT");
  assert.ok(fixture.collection.every((item) => item.identityTechnology === null));
});

test("prototype exposes the six required mobile journey screens", () => {
  const prototype = createRoundModeUxPrototype();
  const screens = UX_SCREEN_IDS.map((screenId) => prototype.getView(screenId).screenId);
  assert.deepEqual(screens, [
    "ROUND_HOME",
    "SCORECARD",
    "MY_GOLF",
    "COLLECTION",
    "LOST_IN_THE_WILD",
    "YOU_FOUND_A_BIRDIE"
  ]);
});

test("bottom navigation is intentionally small and mobile-first", () => {
  assert.deepEqual(UX_BOTTOM_NAV.map((item) => item.label), ["Round", "My Golf", "Collection"]);
  const prototype = createRoundModeUxPrototype();
  prototype.navigate("MY_GOLF");
  const nav = prototype.getNavigation();
  assert.equal(nav.activeScreen, "MY_GOLF");
  assert.equal(nav.bottomNav.filter((item) => item.active).length, 1);
});

test("Round screen exposes scorecard, switch and lost-Birdie actions without side effects", () => {
  const view = createRoundModeUxPrototype().getView("ROUND_HOME");
  assert.deepEqual(view.actions.map((item) => item.id), [
    "OPEN_SCORECARD",
    "OPEN_LOST",
    "SWITCH_BIRDIE"
  ]);
  assert.equal(view.activeBirdie.objectState, "IN_PLAY");
  assert.match(view.privacyNote, /private/i);
});

test("scorecard uses reference-only course data and no GPS facts", () => {
  const view = createRoundModeUxPrototype().getView("SCORECARD");
  assert.equal(view.courseDataMode, "REFERENCE_ONLY");
  assert.equal(view.gpsDataUsed, false);
  assert.equal(view.totals.strokes, 9);
  assert.equal(view.holes[2].strokes, null);
});

test("Lost in the Wild view never exposes private location label or coordinates", () => {
  const view = createRoundModeUxPrototype().getView("LOST_IN_THE_WILD");
  assert.equal(view.lastSeen.visibility, "PRIVATE");
  assert.equal(view.lastSeen.label, "Private location saved");
  assert.equal(view.lastSeen.latitude, null);
  assert.equal(view.lastSeen.longitude, null);
});

test("You Found a Birdie is identification-only and cannot transfer ownership or Coins", () => {
  const view = createRoundModeUxPrototype().getView("YOU_FOUND_A_BIRDIE");
  assert.equal(view.object.identificationAction, "IDENTIFY_BIRDIE_ABSTRACTLY");
  assert.equal(view.object.transferEnabled, false);
  assert.equal(view.object.coinEffectEnabled, false);
});

test("prototype rejects non-sandbox or non-synthetic data", () => {
  const fixture = createSandboxUxFixture();
  assert.throws(() => createRoundModeUxPrototype({ ...fixture, sandbox: false }), /synthetic sandbox/i);
  assert.throws(
    () => createRoundModeUxPrototype({ ...fixture, dataClassification: "PRODUCTION" }),
    /synthetic sandbox/i
  );
});

test("static prototype is mobile viewport based and contains all main journey labels", async () => {
  const html = await readFile(new URL("../prototype/round-mode/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../prototype/round-mode/app.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../prototype/round-mode/styles.css", import.meta.url), "utf8");
  const combined = `${html}\n${app}\n${css}`;

  assert.match(html, /width=device-width/);
  assert.match(combined, /My Golf/);
  assert.match(combined, /Collection/);
  assert.match(combined, /Lost in the Wild/);
  assert.match(combined, /You Found a Birdie/);
  assert.match(combined, /Scorecard/);
  assert.match(css, /480px/);
});

test("static UX contains no concrete hardware-identification choice", async () => {
  const paths = [
    "../prototype/round-mode/index.html",
    "../prototype/round-mode/app.mjs",
    "../prototype/round-mode/styles.css",
    "../src/round-mode/ux-prototype.mjs"
  ];
  const sources = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), "utf8"))
  );
  assert.equal(/\bQR\b/i.test(sources.join("\n")), false);
  assert.equal(/\bNFC\b/i.test(sources.join("\n")), false);
});
