import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("both XcodeGen specs contain isolated CaptureCore, Share and unit-test targets", async () => {
  for (const spec of ["clients/apple/project.yml", "clients/apple/project.personal.yml"]) {
    const source = await read(spec);
    assert.match(source, /^  CaptureCore:\r?$/m);
    assert.match(source, /^  BirdieShare:\r?$/m);
    assert.match(source, /^  BirdieCaptureTests:\r?$/m);
    assert.match(source, /APPLICATION_EXTENSION_API_ONLY: YES/);
    assert.match(source, /CODE_SIGN_ENTITLEMENTS: Config\/BirdieCapture\.entitlements/);
    assert.match(source, /INFOPLIST_FILE: Config\/Birdie(?:Phone|Share)-Info\.plist/);
    assert.match(source, /GENERATE_INFOPLIST_FILE: NO/);
    assert.doesNotMatch(source, /^    (?:info|entitlements):\r?$/m);
    assert.match(source, /targets:\r?\n        - BirdieCaptureTests/);
  }
});

test("Share activation is explicit for URLs, text, images, PDFs/files", async () => {
  const info = await read("clients/apple/Config/BirdieShare-Info.plist");
  assert.doesNotMatch(info, /TRUEPREDICATE/i);
  assert.match(info, /NSExtensionActivationSupportsText/);
  assert.match(info, /NSExtensionActivationSupportsWebURLWithMaxCount/);
  assert.match(info, /NSExtensionActivationSupportsImageWithMaxCount/);
  assert.match(info, /NSExtensionActivationSupportsFileWithMaxCount/);
  assert.match(info, /com\.apple\.share-services/);
});

test("host and extension share only the configured App Group and opaque deep link", async () => {
  const [entitlements, phoneInfo, models] = await Promise.all([
    read("clients/apple/Config/BirdieCapture.entitlements"),
    read("clients/apple/Config/BirdiePhone-Info.plist"),
    read("clients/apple/CaptureCore/CaptureModels.swift"),
  ]);
  assert.match(entitlements, /com\.apple\.security\.application-groups/);
  assert.match(entitlements, /\$\(BIRDIE_APP_GROUP_IDENTIFIER\)/);
  assert.match(phoneInfo, /<string>birdie<\/string>/);
  assert.match(phoneInfo, /NSCameraUsageDescription/);
  assert.match(models, /birdie:\/\/capture\/\\\(id\.uuidString\.lowercased\(\)\)/);
});

test("Share Extension and local adapter cannot publish or reuse Watch credentials", async () => {
  const [shareModel, shareController, transport] = await Promise.all([
    read("clients/apple/BirdieShare/ShareCaptureModel.swift"),
    read("clients/apple/BirdieShare/ShareViewController.swift"),
    read("clients/apple/CaptureCore/CaptureTransport.swift"),
  ]);
  const extensionSource = `${shareModel}\n${shareController}`;
  assert.doesNotMatch(extensionSource, /URLSession|https?:\/\//);
  assert.doesNotMatch(extensionSource, /UIApplication\.shared/);
  assert.doesNotMatch(extensionSource, /WatchRelay|WatchTokenStore/);
  assert.doesNotMatch(transport, /URLSession|WatchRelay|WatchTokenStore/);
  assert.match(transport, /birdie\.capture\.v1/);
  assert.match(transport, /localPreviewOnly/);
  assert.match(transport, /requiresUserReview/);
});

test("Lens uses on-device Vision and defaults to discarding originals", async () => {
  const [recognizer, model, view] = await Promise.all([
    read("clients/apple/BirdiePhone/Lens/OnDeviceTextRecognizer.swift"),
    read("clients/apple/BirdiePhone/Lens/LensCaptureModel.swift"),
    read("clients/apple/BirdiePhone/Lens/BirdieLensView.swift"),
  ]);
  assert.match(recognizer, /VNRecognizeTextRequest/);
  assert.doesNotMatch(`${recognizer}\n${model}`, /URLSession|https?:\/\//);
  assert.match(model, /includeOriginals = false/);
  assert.match(model, /originals = \[\]/);
  assert.match(view, /Originalseiten werden erst mit dem nächsten Tap/);
  assert.match(view, /keine Kontakte, Aufgaben oder Nachrichten angelegt/);
});

test("Watch, mail and complication sources remain outside Capture modules", async () => {
  const root = await read("clients/apple/BirdiePhone/BirdiePhoneRootView.swift");
  assert.match(root, /BirdiePhoneSetupView\(\)/);
  assert.doesNotMatch(root, /WatchRelay|WatchTokenStore|mail|complication/i);
});

test("local queue is protected, integrity checked and recoverable", async () => {
  const [store, transport, writer] = await Promise.all([
    read("clients/apple/CaptureCore/CaptureQueueStore.swift"),
    read("clients/apple/CaptureCore/CaptureTransport.swift"),
    read("clients/apple/CaptureCore/ProtectedFileWriter.swift"),
  ]);
  assert.match(store, /validateIntegrity\(of item:/);
  assert.match(store, /corrupt_manifest/);
  assert.match(store, /tombstoneFileURL/);
  assert.match(transport, /try store\.validateIntegrity\(of: processing\)/);
  assert.match(writer, /completeFileProtection/);
  assert.match(writer, /isExcludedFromBackup = true/);
});

test("macOS verification script proves XcodeGen, tests, unsigned build and embedding", async () => {
  const script = await read("clients/apple/scripts/verify-capture.sh");
  assert.match(script, /node --test test\/apple-capture-contract\.test\.mjs/);
  assert.match(script, /xcodegen generate\r?\n/);
  assert.match(script, /xcodegen generate --spec project\.personal\.yml/);
  assert.match(script, /git diff --exit-code -- Config/);
  assert.match(script, /git ls-files --others --exclude-standard -- Config/);
  assert.match(script, /-scheme BirdieCaptureTests/);
  assert.match(script, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(script, /CODE_SIGNING_REQUIRED=NO/);
  assert.match(script, /BirdieDrop\.appex/);
  assert.match(script, /CaptureCore\.framework/);
  assert.match(script, /test ! -d .*BirdieDrop\.appex\/Frameworks/);
  assert.match(script, /-showdestinations/);
  assert.match(script, /simctl launch .*de\.birdieandbreakfast\.birdie/);
  assert.match(script, /sleep 3/);
  assert.doesNotMatch(script, /simctl terminate .*\|\| true/);
});
