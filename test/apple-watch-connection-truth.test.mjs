import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const relayPath = new URL("../clients/apple/BirdiePhone/WatchRelay.swift", import.meta.url);
const setupViewPath = new URL("../clients/apple/BirdiePhone/BirdiePhoneSetupView.swift", import.meta.url);

test("iPhone relay publishes the physical Watch session state", async () => {
  const source = await readFile(relayPath, "utf8");

  for (const property of ["activationState", "isPaired", "isWatchAppInstalled", "isReachable"]) {
    assert.match(source, new RegExp(`@Published private\\(set\\) var ${property}`));
  }

  assert.match(source, /sessionWatchStateDidChange/);
  assert.match(source, /sessionReachabilityDidChange/);
  assert.match(source, /activationDidCompleteWith/);
  assert.match(source, /publishConnectionState\(from: session\)/);
});

test("iPhone setup keeps API credential state separate from Watch connectivity", async () => {
  const source = await readFile(setupViewPath, "utf8");

  assert.match(source, /@ObservedObject private var relay = WatchRelay\.shared/);
  assert.match(source, /@State private var hasWatchToken = false/);
  assert.match(source, /API-Schlüssel hinterlegt/);
  assert.match(source, /Watch gekoppelt/);
  assert.match(source, /Watch-App installiert/);
  assert.match(source, /Watch erreichbar/);
  assert.doesNotMatch(source, /@State private var isConnected/);
  assert.doesNotMatch(source, /Birdie Watch ist verbunden/);
});
