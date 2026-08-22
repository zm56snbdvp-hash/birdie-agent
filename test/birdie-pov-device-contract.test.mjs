import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const project = read("clients/apple/project.yml");
const entitlements = read("clients/apple/BirdiePOV/BirdiePOV.entitlements");
const info = read("clients/apple/BirdiePOV/Info.plist");
const metaConfig = read("clients/apple/BirdiePOV/Config/Meta.xcconfig");
const metaConfigExample = read(
  "clients/apple/BirdiePOV/Config/Meta.local.xcconfig.example"
);
const gitignore = read(".gitignore");
const controller = read("clients/apple/BirdiePOV/POVController.swift");
const broadcaster = read("clients/apple/BirdiePOV/TwitchBroadcaster.swift");
const workflow = read(".github/workflows/birdie-pov-testflight.yml");

test("Birdie POV pins the reviewed SDK versions exactly", () => {
  assert.match(
    project,
    /MetaWearablesDAT:\n    url: https:\/\/github\.com\/facebook\/meta-wearables-dat-ios\n    exactVersion: 0\.9\.0/
  );
  assert.match(
    project,
    /HaishinKit:\n    url: https:\/\/github\.com\/HaishinKit\/HaishinKit\.swift\n    exactVersion: 2\.2\.5/
  );
  assert.doesNotMatch(project, /\n    from: (?:0\.8\.0|2\.1\.0)\n/);
});

test("XcodeGen binds Birdie POV config and device Wi-Fi entitlements", () => {
  assert.match(
    project,
    /configFiles:\n      Debug: BirdiePOV\/Config\/Meta\.xcconfig\n      Release: BirdiePOV\/Config\/Meta\.xcconfig/
  );
  assert.match(project, /path: BirdiePOV\/BirdiePOV\.entitlements/);
  for (const key of [
    "com.apple.developer.networking.HotspotConfiguration",
    "com.apple.developer.networking.wifi-info"
  ]) {
    assert.match(project, new RegExp(`${key}: true`));
    assert.match(entitlements, new RegExp(`<key>${key}</key>\\s*<true\\/>`));
  }
});

test("Meta registration values stay in a gitignored local override", () => {
  assert.match(info, /<string>\$\(BIRDIE_META_APP_ID\)<\/string>/);
  assert.match(info, /<string>\$\(BIRDIE_META_CLIENT_TOKEN\)<\/string>/);
  assert.match(metaConfig, /^BIRDIE_META_APP_ID = 0$/m);
  assert.match(metaConfig, /^BIRDIE_META_CLIENT_TOKEN =$/m);
  assert.match(metaConfig, /^#include\? "Meta\.local\.xcconfig"$/m);
  assert.match(metaConfigExample, /YOUR_META_APP_ID/);
  assert.match(metaConfigExample, /YOUR_META_CLIENT_TOKEN/);
  assert.match(
    gitignore,
    /^clients\/apple\/BirdiePOV\/Config\/Meta\.local\.xcconfig$/m
  );
  for (const pattern of ["*.p8", "*.p12", "*.mobileprovision", "*.pem"]) {
    assert.match(gitignore, new RegExp(`^\\${pattern}$`, "m"));
  }
});

test("camera state gates audio setup and exposes a retry path", () => {
  const controllerInit = controller.slice(
    controller.indexOf("    init() {"),
    controller.indexOf("    deinit {")
  );
  assert.doesNotMatch(controllerInit, /configureAudioSession/);
  assert.match(
    controller,
    /func startTwitch\(streamKey: String\) \{\n        guard isGlassesStreaming else/
  );
  assert.match(controller, /private func restartPreviewSession/);
  assert.match(controller, /private func handleStoppedSession/);
  assert.match(controller, /Session failed — tap to retry/);

  const audioSetup = broadcaster.indexOf("configureAudioSession()", broadcaster.indexOf("func start("));
  const connectionSetup = broadcaster.indexOf("connection.connect", broadcaster.indexOf("func start("));
  assert.ok(audioSetup > broadcaster.indexOf("func start("));
  assert.ok(audioSetup < connectionSetup);
});

test("RTMP publishing and frame append errors are surfaced", () => {
  assert.doesNotMatch(broadcaster, /try\?\s+await\s+(?:self\.)?stream\.append/);
  assert.match(broadcaster, /try await self\.stream\.append\(sampleBuffer\)/);
  assert.match(broadcaster, /Twitch publish error:/);
  assert.match(broadcaster, /Twitch video error:/);
  assert.match(broadcaster, /verify Twitch channel reception/);
  assert.doesNotMatch(broadcaster, /status = "LIVE on Twitch"/);
});

test("TestFlight requires an explicit manual dispatch", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
});
