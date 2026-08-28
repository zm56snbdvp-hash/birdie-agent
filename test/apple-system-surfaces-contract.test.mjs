import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apple = path.join(root, "clients", "apple");

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [full];
  }));
  return nested.flat();
}

test("both XcodeGen projects wire the phone, iOS widget, shared contracts, and tests", async () => {
  for (const spec of ["clients/apple/project.yml", "clients/apple/project.personal.yml"]) {
    const source = await text(spec);
    assert.match(source, /BirdieWidgets:\s*\n\s+type: app-extension\s*\n\s+platform: iOS/);
    assert.match(source, /BirdiePhoneTests:\s*\n\s+type: bundle\.unit-test/);
    assert.match(source, /TEST_HOST: \$\(BUILT_PRODUCTS_DIR\)\/Birdie\.app\/Birdie/);
    assert.match(source, /BUNDLE_LOADER: \$\(TEST_HOST\)/);
    assert.match(source, /- path: BirdieShared/);
    assert.match(source, /- path: BirdieIntents/);
    assert.match(source, /- target: BirdieWidgets/);
    assert.match(source, /CODE_SIGN_ENTITLEMENTS: BirdiePhone\/BirdiePhone\.entitlements/);
    assert.match(source, /CODE_SIGN_ENTITLEMENTS: BirdieWidgets\/BirdieWidgets\.entitlements/);
    assert.match(source, /INFOPLIST_FILE: BirdieWidgets\/Info\.plist/);
    assert.match(source, /targets:\s*\n\s+- BirdiePhoneTests/);
  }
});

test("public action and deep-link contracts remain stable and fail closed", async () => {
  const actions = await text("clients/apple/BirdieShared/BirdieActionContracts.swift");
  const routing = await text("clients/apple/BirdieShared/BirdieRouting.swift");

  for (const id of ["ask", "capture-thought", "briefing", "next-step"]) {
    assert.ok(actions.includes(id), `missing stable action ${id}`);
  }
  assert.match(actions, /allowsDirectIntentExecution: Bool = false/);
  assert.match(routing, /object\(forInfoDictionaryKey: "BirdieURLScheme"\)/);
  assert.match(routing, /components\.percentEncodedPath/);
  assert.match(routing, /allowedQueryNames: Set<String> = \["source", "focus"\]/);
  assert.match(routing, /groupedQuery\.values\.allSatisfy/);
  assert.doesNotMatch(routing, /URLQueryItem\(name: "draft"/);
  assert.match(routing, /maximumDraftLength = 2_000/);
  assert.doesNotMatch(routing, /URLSession|EKEventStore|WatchTokenStore/);
});

test("intents stage navigation and cannot reach write, EventKit, or transport APIs", async () => {
  const siri = await text("clients/apple/BirdiePhone/SystemSurfaces/BirdieSystemIntents.swift");
  const control = await text("clients/apple/BirdieIntents/OpenBirdieActionIntent.swift");
  const coordinator = await text("clients/apple/BirdieShared/BirdieIntentCoordinator.swift");

  assert.equal((siri.match(/openAppWhenRun = true/g) ?? []).length, 4);
  assert.match(control, /OpenIntent/);
  assert.match(control, /BirdieIntentCoordinator\.shared\.stagePreview/);
  assert.match(coordinator, /guard !contract\.allowsDirectIntentExecution/);
  assert.match(coordinator, /unsupportedSource/);
  assert.doesNotMatch(coordinator, /URLSession|EKEventStore|WatchTokenStore|\.save\(/);
  assert.match(
    await text("clients/apple/BirdiePhone/SystemSurfaces/BirdieActionComposerView.swift"),
    /BirdieRoute\.sanitizedDraft\(text\)/,
  );

  for (const source of [siri, control]) {
    assert.doesNotMatch(
      source,
      /URLSession|EKEventStore|\.save\(|saveConfirmed|applyConfirmed|BIRDIE_AGENT_API_KEY/,
    );
  }
});

test("EventKit access is stepwise and all writes use the confirmed proposal boundary", async () => {
  const eventStore = await text("clients/apple/BirdiePhone/DayPilot/DayPilotEventStore.swift");
  const proposal = await text("clients/apple/BirdiePhone/DayPilot/DayPilotProposalView.swift");

  assert.match(eventStore, /requestCalendarAccess\(\)[\s\S]*requestFullAccessToEvents/);
  assert.match(eventStore, /requestReminderAccess\(\)[\s\S]*requestFullAccessToReminders/);
  assert.equal((eventStore.match(/store\.save\(/g) ?? []).length, 2);
  assert.match(eventStore, /func applyConfirmed\(_ proposal: DayPilotProposal\)/);
  assert.match(eventStore, /store\.calendar\(withIdentifier: proposal\.destinationCalendarIdentifier\)/);
  assert.match(eventStore, /event\.endDate = endDate/);
  assert.match(proposal, /Sichere Vorschau erstellen/);
  assert.match(proposal, /preview\.destinationCalendarTitle/);
  assert.match(proposal, /preview\.timeZoneIdentifier/);
  assert.match(proposal, /Vorschlag bestätigen/);
  assert.match(proposal, /model\.applyConfirmed\(preview\)/);
});

test("app-only drafts expire while the minimized widget snapshot has a TTL", async () => {
  const routing = await text("clients/apple/BirdieShared/BirdieRouting.swift");
  const snapshots = await text("clients/apple/BirdieShared/DayPilotSnapshotStore.swift");

  assert.match(routing, /defaults: UserDefaults = \.standard/);
  assert.match(routing, /maxAge: TimeInterval = 5 \* 60/);
  assert.match(routing, /defer \{ defaults\.removeObject\(forKey: key\) \}/);
  assert.match(snapshots, /maxAge: TimeInterval = 6 \* 60 \* 60/);
  assert.match(snapshots, /public init\(defaults: UserDefaults = \.standard\)/);
});

test("widget and Focus presentation protect content without granting authority", async () => {
  const widget = await text("clients/apple/BirdieWidgets/DayPilotWidget.swift");
  const models = await text("clients/apple/BirdieShared/DayPilotModels.swift");
  const actions = await text("clients/apple/BirdieShared/BirdieActionContracts.swift");
  const phoneEntitlements = await text("clients/apple/BirdiePhone/BirdiePhone.entitlements");
  const widgetEntitlements = await text("clients/apple/BirdieWidgets/BirdieWidgets.entitlements");

  assert.match(widget, /redactionReasons\.contains\(\.privacy\)/);
  assert.match(widget, /privacySensitive\(\)/);
  assert.match(widget, /Entsperren, um persönliche Details zu sehen/);
  assert.match(models, /case work[\s\S]*case personal[\s\S]*case rest/);
  assert.doesNotMatch(actions, /BirdieFocusContext/);
  for (const entitlements of [phoneEntitlements, widgetEntitlements]) {
    assert.match(entitlements, /com\.apple\.developer\.default-data-protection/);
    assert.match(entitlements, /NSFileProtectionComplete/);
  }
});

test("no Swift source embeds the canonical agent secret", async () => {
  const swiftFiles = (await filesBelow(apple)).filter((file) => file.endsWith(".swift"));
  const sources = await Promise.all(swiftFiles.map((file) => readFile(file, "utf8")));
  for (let index = 0; index < sources.length; index += 1) {
    assert.doesNotMatch(
      sources[index],
      /BIRDIE_AGENT_API_KEY/,
      `forbidden agent secret reference in ${path.relative(root, swiftFiles[index])}`,
    );
  }
});
