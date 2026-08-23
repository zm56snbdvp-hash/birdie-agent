import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
const view = read("clients/apple/BirdiePOV/POVView.swift");
const compositor = read("clients/apple/BirdiePOV/BirdieHUDCompositor.swift");
const birdiePOVSources = readdirSync("clients/apple/BirdiePOV")
  .filter((name) => name.endsWith(".swift"))
  .sort()
  .map((name) => read(`clients/apple/BirdiePOV/${name}`))
  .join("\n");
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
  assert.match(broadcaster, /try await self\.stream\.append\(\w+\)/);
  assert.match(broadcaster, /Twitch publish error:/);
  assert.match(broadcaster, /Twitch video error:/);
  assert.match(broadcaster, /verify Twitch (?:channel )?reception/);
  assert.doesNotMatch(broadcaster, /status = "LIVE on Twitch"/);
});

test("Twitch video output uses the approved landscape Full HD profile", () => {
  const settingsStart = broadcaster.indexOf("VideoCodecSettings(");
  const settingsEnd = broadcaster.indexOf(
    "stream.setVideoSettings",
    settingsStart
  );
  assert.ok(settingsStart >= 0, "VideoCodecSettings must be configured");
  assert.ok(settingsEnd > settingsStart, "video settings must be applied");

  const settings = broadcaster.slice(settingsStart, settingsEnd);
  assert.match(
    settings,
    /videoSize:\s*\.init\(\s*width:\s*1920,\s*height:\s*1080\s*\)/s
  );
  assert.match(settings, /bitRate:\s*6_000_000\b/);
  assert.match(
    settings,
    /profileLevel:\s*kVTProfileLevel_H264_High_4_1\s+as\s+String/
  );
  assert.match(settings, /maxKeyFrameIntervalDuration:\s*2\b/);
  assert.match(settings, /expectedFrameRate:\s*24\b/);

  assert.doesNotMatch(settings, /width:\s*720|height:\s*1280/);
  assert.doesNotMatch(
    settings,
    /videoSize:\s*\.init\(\s*width:\s*1080,\s*height:\s*1920\s*\)/s
  );
  assert.doesNotMatch(settings, /bitRate:\s*2_500_000\b/);
  assert.doesNotMatch(settings, /kVTProfileLevel_H264_High_3_1/);
});

test("Birdie HUD is natively composited into the outgoing frame and defaults on", () => {
  assert.match(
    birdiePOVSources,
    /(?:struct|class|actor)\s+BirdieHUDDescriptor\b/
  );
  assert.match(
    birdiePOVSources,
    /(?:struct|class|actor)\s+BirdieHUDCompositor\b/
  );
  assert.match(
    birdiePOVSources,
    /func\s+composite\(\s*_\s+\w+:\s*CMSampleBuffer,\s*descriptor:\s*BirdieHUDDescriptor,\s*elapsed:\s*TimeInterval\s*\)\s*async\s*->\s*CMSampleBuffer\?/s
  );
  assert.match(compositor, /outputWidth\s*=\s*1_920\b/);
  assert.match(compositor, /outputHeight\s*=\s*1_080\b/);
  assert.match(compositor, /portraitBounds\s*=\s*CGRect\(/);
  assert.match(compositor, /CIGaussianBlur/);
  assert.match(view, /aspectRatio\(16\.0\s*\/\s*9\.0/);
  assert.match(
    view,
    /Label\("1920 × 1080",\s*systemImage:\s*"rectangle"\)/
  );

  assert.match(
    controller,
    /@Published\s+var\s+isHUDEnabled\s*=\s*true\b/
  );
  assert.match(controller, /@Published\s+var\s+hudGame\b/);
  assert.match(controller, /@Published\s+var\s+hudMission\b/);
  assert.match(
    controller,
    /twitch\.appendVideo\(\s*frame\.sampleBuffer\s*\)/s
  );
  assert.match(
    broadcaster,
    /func\s+appendVideo\(\s*_\s+sampleBuffer:\s*CMSampleBuffer\s*\)/s
  );
  assert.match(controller, /twitch\.updateHUD\(hudDescriptor\)/);
  assert.match(broadcaster, /let\s+descriptor\s*=\s*self\.hudDescriptor/);
  assert.match(
    broadcaster,
    /composite\(\s*sampleBuffer,\s*descriptor:\s*\w+,\s*elapsed:/s
  );
  assert.doesNotMatch(
    broadcaster,
    /if\s+descriptor\.isEnabled\s*,\s*let\s+composited/s,
    "the Full HD canvas must still be composed when the optional HUD is off"
  );
  assert.match(broadcaster, /guard\s+let\s+self,\s+self\.isLive,\s*!self\.isProcessingVideoFrame/);
  assert.match(broadcaster, /defer\s*\{\s*self\.isProcessingVideoFrame\s*=\s*false\s*\}/s);

  const appendMatch = broadcaster.match(/stream\.append\(\s*(\w+)\s*\)/);
  assert.ok(appendMatch, "the composed/fallback frame must reach RTMP append");
  const appendedFrame = appendMatch[1];
  assert.notEqual(
    appendedFrame,
    "sampleBuffer",
    "the raw input must not bypass the HUD composition decision"
  );
  assert.match(
    broadcaster,
    new RegExp(`\\b${appendedFrame}\\s*=\\s*composited\\b`)
  );
  assert.match(
    broadcaster,
    new RegExp(`\\b${appendedFrame}\\s*=\\s*sampleBuffer\\b`)
  );

  assert.match(
    view,
    /Toggle\(\s*"Burn Birdie HUD into stream",\s*isOn:\s*\$controller\.isHUDEnabled\s*\)/s
  );
});

test("Twitch stream key remains process-memory only", () => {
  assert.match(view, /@State\s+private\s+var\s+streamKey\s*=\s*""/);
  assert.match(view, /controller\.startTwitch\(streamKey:\s*streamKey\)/);
  assert.doesNotMatch(
    birdiePOVSources,
    /@AppStorage|UserDefaults|Keychain|SecItem(?:Add|Update|CopyMatching)/
  );
  assert.doesNotMatch(
    broadcaster,
    /(?:private|fileprivate|internal|public)\s+(?:let|var)\s+(?:streamKey|twitchKey)\b/
  );
});

test("TestFlight requires an explicit manual dispatch", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
});
