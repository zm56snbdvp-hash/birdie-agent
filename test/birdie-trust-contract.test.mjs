import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const contractPath = fileURLToPath(
  new URL("../clients/apple/Contracts/v1/birdie-trust.openapi.json", import.meta.url)
);
const approvalPushPath = fileURLToPath(
  new URL("../clients/apple/Contracts/v1/examples/apns-approval-redacted.json", import.meta.url)
);
const missionPushPath = fileURLToPath(
  new URL("../clients/apple/Contracts/v1/examples/apns-mission-redacted.json", import.meta.url)
);
const activityPushPath = fileURLToPath(
  new URL("../clients/apple/Contracts/v1/examples/apns-live-activity-redacted.json", import.meta.url)
);
const notificationSourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieNotifications.swift", import.meta.url)
);
const trustModelSourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieTrustModels.swift", import.meta.url)
);
const trustStoreSourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieApprovalStore.swift", import.meta.url)
);
const trustSecuritySourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieTrustSecurity.swift", import.meta.url)
);
const deviceBindingSourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieDeviceBinding.swift", import.meta.url)
);
const approveViewSourcePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdieApproveView.swift", import.meta.url)
);
const projectSpecPath = fileURLToPath(new URL("../clients/apple/project.yml", import.meta.url));
const personalProjectSpecPath = fileURLToPath(
  new URL("../clients/apple/project.personal.yml", import.meta.url)
);
const phoneInfoPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/Info.plist", import.meta.url)
);
const phoneEntitlementsPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdiePhone.entitlements", import.meta.url)
);
const watchRelayPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/WatchRelay.swift", import.meta.url)
);
const watchAPIPath = fileURLToPath(
  new URL("../clients/apple/BirdieWatch/BirdieWatchAPI.swift", import.meta.url)
);
const watchViewPath = fileURLToPath(
  new URL("../clients/apple/BirdieWatch/BirdieWatchView.swift", import.meta.url)
);
const liveActivityInfoPath = fileURLToPath(
  new URL("../clients/apple/BirdieLiveActivity/Info.plist", import.meta.url)
);
const liveMissionWidgetPath = fileURLToPath(
  new URL("../clients/apple/BirdieLiveActivity/BirdieLiveMissionWidget.swift", import.meta.url)
);
const liveMissionActivityCoordinatorPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/LiveMissionActivityCoordinator.swift", import.meta.url)
);
const liveMissionCommandCoordinatorPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/LiveMissionCommandCoordinator.swift", import.meta.url)
);
const liveMissionStorePath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/LiveMissionStore.swift", import.meta.url)
);
const liveMissionViewPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/LiveMissionView.swift", import.meta.url)
);
const phoneRootViewPath = fileURLToPath(
  new URL("../clients/apple/BirdiePhone/BirdiePhoneRootView.swift", import.meta.url)
);
const watchWidgetInfoPath = fileURLToPath(
  new URL("../clients/apple/BirdieWatchWidget/Info.plist", import.meta.url)
);

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const approvalPush = JSON.parse(readFileSync(approvalPushPath, "utf8"));
const missionPush = JSON.parse(readFileSync(missionPushPath, "utf8"));
const activityPush = JSON.parse(readFileSync(activityPushPath, "utf8"));
const notificationSource = readFileSync(notificationSourcePath, "utf8");
const trustModelSource = readFileSync(trustModelSourcePath, "utf8");
const trustStoreSource = readFileSync(trustStoreSourcePath, "utf8");
const trustSecuritySource = readFileSync(trustSecuritySourcePath, "utf8");
const deviceBindingSource = readFileSync(deviceBindingSourcePath, "utf8");
const approveViewSource = readFileSync(approveViewSourcePath, "utf8");
const projectSpec = readFileSync(projectSpecPath, "utf8");
const personalProjectSpec = readFileSync(personalProjectSpecPath, "utf8");
const phoneInfo = readFileSync(phoneInfoPath, "utf8");
const phoneEntitlements = readFileSync(phoneEntitlementsPath, "utf8");
const watchRelaySource = readFileSync(watchRelayPath, "utf8");
const watchAPISource = readFileSync(watchAPIPath, "utf8");
const watchViewSource = readFileSync(watchViewPath, "utf8");
const liveActivityInfo = readFileSync(liveActivityInfoPath, "utf8");
const liveMissionWidgetSource = readFileSync(liveMissionWidgetPath, "utf8");
const liveMissionActivityCoordinatorSource = readFileSync(
  liveMissionActivityCoordinatorPath,
  "utf8"
);
const liveMissionCommandCoordinatorSource = readFileSync(
  liveMissionCommandCoordinatorPath,
  "utf8"
);
const liveMissionStoreSource = readFileSync(liveMissionStorePath, "utf8");
const liveMissionViewSource = readFileSync(liveMissionViewPath, "utf8");
const phoneRootViewSource = readFileSync(phoneRootViewPath, "utf8");
const watchWidgetInfo = readFileSync(watchWidgetInfoPath, "utf8");

function schema(name) {
  const value = contract.components?.schemas?.[name];
  assert.ok(value, `missing schema ${name}`);
  return value;
}

function required(schemaName, fields) {
  const requiredFields = new Set(schema(schemaName).required ?? []);
  for (const field of fields) {
    assert.ok(requiredFields.has(field), `${schemaName} must require ${field}`);
  }
}

function resolveLocalRef(ref) {
  assert.match(ref, /^#\//, `only local refs are allowed: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, part) => value?.[part], contract);
}

function visit(value, callback, path = "$") {
  callback(value, path);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, callback, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, item]) => visit(item, callback, `${path}.${key}`));
}

function keys(value) {
  return Object.keys(value).sort();
}

test("Birdie Trust is a self-contained OpenAPI 3.1 contract without invented production endpoints", () => {
  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.info.version, "1.0.0");
  assert.equal(contract.jsonSchemaDialect, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.servers, undefined);
  assert.deepEqual(contract.security, [{ userBearer: [] }]);

  visit(contract, (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if ("$ref" in value) {
      assert.ok(resolveLocalRef(value.$ref), `unresolved ref at ${path}: ${value.$ref}`);
    }
  });
});

test("approval cards carry exact target, change, risk, expiry, source, status, and edit capabilities", () => {
  required("ApprovalRecord", [
    "approvalId",
    "recordVersion",
    "actionKind",
    "target",
    "changes",
    "payloadDigest",
    "risk",
    "riskReasons",
    "irreversible",
    "requiresInteractiveAuthorization",
    "expiresAt",
    "source",
    "status",
    "capabilities"
  ]);
  required("ActionTarget", ["kind", "canonicalIdentifier", "displayName"]);
  required("ApprovalChange", ["field", "proposed", "classification"]);
  required("ActionSource", ["system", "workflowId", "requestedBy", "correlationId"]);
  assert.equal(schema("ApprovalRecord").properties.changes.minItems, 1);
  assert.equal(
    schema("ApprovalRecord").properties.payloadDigest.allOf[0].$ref,
    "#/components/schemas/Sha256Digest"
  );
  assert.deepEqual(schema("ApprovalRecord").properties.risk.enum, ["green", "amber", "red"]);
  assert.equal(
    schema("ApprovalRecord").allOf[0].then.properties.requiresInteractiveAuthorization.const,
    true
  );
  assert.equal(
    schema("ApprovalRecord").allOf[1].then.properties.requiresInteractiveAuthorization.const,
    true
  );
  assert.deepEqual(schema("ApprovalIntent").properties.decision.enum, ["approve", "reject", "edit"]);
});

test("every controlled mutation is versioned, idempotent, device-bound, challenged, and asserted", () => {
  const mutationPaths = [
    "/v1/approvals/{approvalId}/challenges",
    "/v1/approvals/{approvalId}/decisions",
    "/v1/missions/{missionId}/challenges",
    "/v1/missions/{missionId}/commands"
  ];

  for (const path of mutationPaths) {
    const operation = contract.paths[path].post;
    assert.ok(operation, `${path} must be POST`);
    assert.ok(
      operation.parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"),
      `${path} must require Idempotency-Key`
    );
  }

  for (const schemaName of ["ApprovalChallengeRequest", "MissionChallengeRequest"]) {
    required(schemaName, [
      "contractVersion",
      "recordVersion",
      "idempotencyKey",
      "deviceBindingId",
      "actionDigest"
    ]);
    const digestBinding = schema(schemaName)["x-birdie-action-digest"];
    assert.equal(digestBinding.canonicalization, "RFC8785");
    assert.equal(digestBinding.digest, "SHA-256");
    assert.ok(schema(digestBinding.payloadSchema));
  }

  required("ApprovalActionDigestPayload", [
    "approvalId",
    "recordVersion",
    "actionKind",
    "payloadDigest",
    "target",
    "changes",
    "decision"
  ]);
  required("MissionActionDigestPayload", [
    "contractVersion",
    "missionId",
    "recordVersion",
    "command"
  ]);

  for (const schemaName of ["ApprovalDecisionRequest", "MissionCommandRequest"]) {
    required(schemaName, [
      "contractVersion",
      "recordVersion",
      "idempotencyKey",
      "challengeId",
      "nonce",
      "actionDigest",
      "deviceBindingId",
      "deviceAssertion",
      "localAuthorization"
    ]);
  }

  const challenge = schema("ActionChallenge");
  required("ActionChallenge", [
    "challengeId",
    "resourceId",
    "recordVersion",
    "idempotencyKey",
    "deviceBindingId",
    "nonce",
    "actionDigest",
    "expiresAt",
    "maxAttempts",
    "consumed"
  ]);
  assert.equal(challenge.properties.nonce.minLength, 43);
  assert.equal(challenge.properties.maxAttempts.const, 1);
  assert.equal(challenge.properties.consumed.const, false);

  const invariants = contract["x-birdie-security-invariants"];
  assert.equal(invariants.nonceSingleUse, true);
  assert.equal(invariants.challengeTtlSeconds.maximum, 120);
  assert.equal(invariants.challengeBoundToDeviceResourceVersionActionAndIdempotencyKey, true);
  assert.equal(invariants.idempotencyRequired, true);
  assert.equal(invariants.committedIdempotencyCheckedBeforeChallengeExpiry, true);
  assert.equal(invariants.decisionReceiptRecoveryByDecisionIdRequired, true);
  assert.equal(invariants.deviceAssertionRequired, true);
  assert.equal(invariants.assertionKeyIsRegisteredForDeviceBinding, true);
  assert.equal(invariants.clientDataHashCoversEveryUnsignedRequestField, true);
  assert.equal(invariants.productionAcceptsLocalMockAssertions, false);

  assert.deepEqual(contract["x-birdie-local-mock-policy"], {
    allowedBuildConfigurations: ["DEBUG", "TEST"],
    transport: "in_memory_only",
    persistence: "ephemeral_only",
    usesProductionCredentials: false,
    usesProductionBaseUrl: false,
    productionAdapterDefault: "fail_closed",
    receiptSigningKey: "ephemeral_test_key_only"
  });

  const recovery = contract.paths["/v1/approvals/{approvalId}/decisions/{decisionId}"].get;
  assert.equal(recovery.operationId, "getApprovalDecisionReceipt");
  assert.ok(recovery.responses["200"]);
  assert.ok(recovery.responses["404"]);
});

test("App Attest and local authorization have separate, explicit security roles", () => {
  const assertion = schema("DeviceAssertion");
  required("DeviceAssertion", ["provider", "keyId", "assertion", "clientDataHash"]);
  assert.equal(assertion.properties.provider.const, "app_attest");
  assert.match(assertion.description, /clientDataHash/);
  assert.match(assertion.description, /deviceBindingId/);

  for (const schemaName of ["ApprovalDecisionRequest", "MissionCommandRequest"]) {
    const request = schema(schemaName);
    const binding = request["x-birdie-device-assertion-binding"];
    assert.equal(binding.canonicalization, "RFC8785");
    assert.equal(binding.digest, "SHA-256");
    assert.deepEqual(binding.excludedFields, ["deviceAssertion"]);
    assert.deepEqual(
      new Set(binding.includedFields),
      new Set(Object.keys(request.properties).filter((field) => field !== "deviceAssertion")),
      `${schemaName} must bind every unsigned field, including optional fields when present`
    );
  }

  const localAuthorization = schema("LocalAuthorization");
  required("LocalAuthorization", ["method", "policy", "success", "evaluatedAt", "contextDigest"]);
  assert.deepEqual(localAuthorization.properties.method.enum, [
    "face_id",
    "touch_id",
    "device_passcode",
    "not_required"
  ]);
  assert.equal(localAuthorization.properties.success.const, true);
  assert.match(localAuthorization.description, /Nicht allein serverseitig beweiskraeftig/);
  assert.deepEqual(localAuthorization["x-birdie-evaluation-rules"], {
    contextDigestEqualsActionDigest: true,
    maximumAgeSeconds: 120,
    maximumFutureClockSkewSeconds: 5,
    mustNotPredateChallengeBeyondClockSkew: true,
    biometricsOnlyMethods: ["face_id", "touch_id"],
    notRequiredPolicy: "low_risk_only",
    notRequiredMethod: "not_required",
    serverMustStillApplyRiskPolicy: true
  });
});

test("App Attest enrollment is challenged and activates only after server acknowledgement", () => {
  for (const path of [
    "/v1/device-bindings/app-attest/challenges",
    "/v1/device-bindings/app-attest/registrations"
  ]) {
    const operation = contract.paths[path].post;
    assert.ok(operation);
    assert.ok(
      operation.parameters.some(
        (parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"
      )
    );
  }
  required("AppAttestRegistrationChallenge", [
    "registrationId",
    "challengeId",
    "keyId",
    "nonce",
    "expiresAt",
    "maxAttempts",
    "consumed"
  ]);
  required("AppAttestRegistrationRequest", [
    "registrationId",
    "challengeId",
    "idempotencyKey",
    "keyId",
    "nonce",
    "clientDataHash",
    "attestation"
  ]);
  required("AppAttestRegistrationAcknowledgement", [
    "acknowledgementId",
    "registrationId",
    "deviceBindingId",
    "keyId",
    "serverSignature"
  ]);
  assert.equal(
    contract["x-birdie-security-invariants"].appAttestKeyActivatedOnlyAfterServerAcknowledgement,
    true
  );
  assert.equal(
    contract["x-birdie-security-invariants"].appAttestRegistrationExactRetryAfterResponseLoss,
    true
  );
  assert.match(trustSecuritySource, /func beginRegistration\(\)/);
  assert.match(trustSecuritySource, /activateRegistration\(\s*afterBackendAcknowledgedKeyID/);
  assert.doesNotMatch(trustStoreSource, /deviceAssertion\.keyID\s*==\s*deviceBindingID/);
  assert.match(trustSecuritySource, /debug-local-app-attest-key/);
  assert.match(deviceBindingSource, /actor BirdieDeviceBindingCoordinator/);
  assert.match(deviceBindingSource, /serverSignatureVerifier\.verify/);
  assert.ok(
    deviceBindingSource.indexOf("serverSignatureVerifier.verify") <
      deviceBindingSource.indexOf("registrar.activateRegistration"),
    "verified acknowledgement must precede local key activation"
  );
  assert.match(deviceBindingSource, /MockDeviceBindingClient/);
  assert.match(deviceBindingSource, /BirdiePendingRegistrationCache/);
  assert.match(trustSecuritySource, /AppAttestPendingKeyStore/);
});

test("signed timestamps and integers use one cross-language canonical profile", () => {
  const timestamp = schema("UTCSecondTimestamp");
  assert.equal(timestamp.format, "date-time");
  assert.equal(
    timestamp.pattern,
    "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$"
  );
  assert.equal(contract["x-birdie-security-invariants"].maximumCanonicalInteger, 9007199254740991);
  assert.match(trustSecuritySource, /9_007_199_254_740_991/);
});

test("receipts and audit are signed, complete-to-sequence, and hash chained", () => {
  for (const schemaName of ["DecisionReceipt", "MissionCommandReceipt"]) {
    required(schemaName, [
      "receiptId",
      "recordVersion",
      "idempotencyKey",
      "requestDigest",
      "auditEventId",
      "auditSequence",
      "auditHeadHash",
      "serverSignature"
    ]);
  }
  required("AuditEvent", [
    "eventId",
    "sequence",
    "resourceId",
    "recordVersion",
    "requestDigest",
    "previousEventHash",
    "eventHash",
    "serverSignature"
  ]);
  required("AuditLogResponse", [
    "fromSequence",
    "completeThroughSequence",
    "events",
    "headHash",
    "serverSignature"
  ]);
  assert.equal(schema("AuditLogResponse").properties.events.minItems, 1);

  const signature = schema("ServerSignature");
  assert.equal(signature.properties.format.const, "raw-ed25519-jcs");
  assert.equal(signature.properties.algorithm.const, "EdDSA");
  assert.equal(signature.properties.canonicalization.const, "RFC8785");
  assert.equal(contract["x-birdie-security-invariants"].auditIsAppendOnlyAndHashChained, true);
});

test("Live Mission is bounded state, not a permanent chat status", () => {
  required("MissionRecord", [
    "missionId",
    "recordVersion",
    "scope",
    "status",
    "progress",
    "currentStep",
    "allowsPause",
    "allowsCancel",
    "startedAt",
    "updatedAt",
    "expiresAt"
  ]);
  assert.equal(schema("MissionRecord").properties.progress.minimum, 0);
  assert.equal(schema("MissionRecord").properties.progress.maximum, 1);
  assert.equal(schema("MissionScope").properties.maximumDurationSeconds.maximum, 8 * 60 * 60);
  assert.deepEqual(schema("MissionCommandRequest").properties.command.enum, ["pause", "resume", "cancel"]);

  const states = schema("MissionRecord").properties.status.enum;
  assert.ok(states.includes("running"));
  assert.ok(states.includes("blocked"));
  assert.ok(states.includes("cancelled"));
  assert.ok(states.includes("expired"));
  assert.ok(!states.includes("chatting"));
  assert.ok(!states.includes("idle"));
});

test("native Live Mission routing, authorization, and stale Activity UI fail closed", () => {
  assert.equal((phoneRootViewSource.match(/\.onOpenURL\s*\{/g) ?? []).length, 1);
  assert.doesNotMatch(liveMissionViewSource, /\.onOpenURL\s*\{/);

  assert.match(liveMissionActivityCoordinatorSource, /title:\s*Self\.lockScreenTitle/);
  assert.doesNotMatch(liveMissionActivityCoordinatorSource, /title:\s*mission\.title/);
  assert.match(liveMissionStoreSource, /candidate\.recordVersion\s*</);
  assert.match(liveMissionActivityCoordinatorSource, /activity\.content\.state\.recordVersion/);

  assert.match(liveMissionWidgetSource, /if context\.isStale/);
  assert.match(liveMissionWidgetSource, /Status nicht mehr aktuell/);
  assert.match(liveMissionWidgetSource, /Auftrag darf nicht weiterlaufen/);

  assert.match(
    liveMissionCommandCoordinatorSource,
    /localAuthorization\.contextDigest == actionDigest/
  );
  assert.doesNotMatch(liveMissionCommandCoordinatorSource, /LiveMissionAuthorizationContext/);
});

test("red Approval APNs example is exact, generic, and cannot execute approval", () => {
  assert.deepEqual(keys(approvalPush), [
    "approvalId",
    "aps",
    "deepLink",
    "expiresAt",
    "notificationId",
    "notificationKind",
    "risk",
    "schemaVersion"
  ]);
  assert.deepEqual(keys(approvalPush.aps), ["alert", "category", "interruption-level", "thread-id"]);
  assert.deepEqual(keys(approvalPush.aps.alert), ["body", "title"]);
  assert.equal(approvalPush.aps.alert.title, schema("ApprovalPushAlert").properties.title.const);
  assert.equal(approvalPush.aps.alert.body, schema("ApprovalPushAlert").properties.body.const);
  assert.equal(approvalPush.aps.category, "BIRDIE_APPROVAL_RED_V1");
  assert.equal(approvalPush.risk, "red");
  assert.equal(approvalPush.schemaVersion, "birdie.trust.notification/v1");

  const redActions = contract["x-birdie-apns-categories"].BIRDIE_APPROVAL_RED_V1.actions;
  assert.ok(redActions.some((action) => action.id === "BIRDIE_OPEN_V1"));
  assert.ok(redActions.some((action) => action.id === "BIRDIE_REMIND_LATER_V1"));
  assert.ok(redActions.some((action) => action.id === "BIRDIE_REVIEW_REJECTION_V1"));
  assert.ok(!redActions.some((action) => /APPROVE/.test(action.id)));
  assert.ok(redActions.every((action) => action.executesControlledAction === false));
  assert.ok(
    redActions
      .filter((action) => action.id !== "BIRDIE_REMIND_LATER_V1")
      .every((action) => action.foreground && action.authenticationRequired)
  );
  assert.equal(contract["x-birdie-security-invariants"].redApprovalFromLockScreen, false);
});

test("Mission APNs example exposes only an opaque state hint", () => {
  assert.deepEqual(keys(missionPush), [
    "aps",
    "deepLink",
    "missionId",
    "notificationId",
    "notificationKind",
    "recordVersion",
    "schemaVersion",
    "status"
  ]);
  assert.deepEqual(keys(missionPush.aps), ["alert", "category", "interruption-level", "thread-id"]);
  assert.deepEqual(keys(missionPush.aps.alert), ["body", "title"]);
  assert.equal(missionPush.aps.alert.title, schema("MissionPushAlert").properties.title.const);
  assert.equal(missionPush.aps.alert.body, schema("MissionPushAlert").properties.body.const);
  assert.equal(missionPush.aps.category, "BIRDIE_MISSION_CONTROLS_V1");
  assert.equal(missionPush.schemaVersion, "birdie.trust.notification/v1");
  const missionActions = contract["x-birdie-apns-categories"].BIRDIE_MISSION_CONTROLS_V1.actions;
  assert.deepEqual(
    missionActions.map((action) => action.id),
    ["BIRDIE_OPEN_V1", "BIRDIE_REVIEW_PAUSE_V1"]
  );
  assert.ok(missionActions.every((action) => action.foreground));
  assert.ok(missionActions.every((action) => action.authenticationRequired));
  assert.ok(missionActions.every((action) => action.executesControlledAction === false));
  assert.ok(!missionActions.some((action) => /CANCEL/.test(action.id)));
  assert.equal(contract["x-birdie-security-invariants"].pushContainsSensitiveContent, false);
});

test("ActivityKit APNs state matches the token-free Swift projection and stays redacted", () => {
  assert.deepEqual(keys(activityPush), ["aps", "notificationKind", "schemaVersion"]);
  assert.deepEqual(keys(activityPush.aps), ["content-state", "event", "stale-date", "timestamp"]);
  assert.equal(activityPush.notificationKind, "mission_activity");
  assert.equal(activityPush.schemaVersion, "birdie.trust.notification/v1");
  assert.ok(activityPush.aps["stale-date"] > activityPush.aps.timestamp);

  const content = activityPush.aps["content-state"];
  assert.deepEqual(keys(content), [
    "allowsCancel",
    "allowsPause",
    "blockerCategory",
    "containsSensitiveDetails",
    "currentStepIndex",
    "currentStepTitle",
    "currentStepTotal",
    "progress",
    "recordVersion",
    "status"
  ]);
  required("MissionActivityContentState", [
    "recordVersion",
    "status",
    "progress",
    "currentStepIndex",
    "currentStepTotal",
    "currentStepTitle",
    "allowsPause",
    "allowsCancel",
    "containsSensitiveDetails"
  ]);
  const contentSchema = schema("MissionActivityContentState");
  assert.ok(contentSchema.properties.currentStepTitle.enum.includes(content.currentStepTitle));
  assert.ok(contentSchema.properties.blockerCategory.enum.includes(content.blockerCategory));
  assert.equal(contentSchema.properties.containsSensitiveDetails.const, true);
  assert.equal(content.containsSensitiveDetails, true);
  assert.equal(content.progress >= 0 && content.progress <= 1, true);
});

test("APNs examples contain no target, content, proof, credential, or Watch token material", () => {
  const forbiddenKeys = new Set([
    "target",
    "change",
    "canonicalPayload",
    "source",
    "currentStep",
    "blocker",
    "detail",
    "nonce",
    "actionDigest",
    "deviceAssertion",
    "authorization",
    "accessToken",
    "refreshToken",
    "apiKey",
    "apnsToken",
    "activityPushToken"
  ]);

  for (const [name, payload] of [
    ["approval", approvalPush],
    ["mission", missionPush],
    ["activity", activityPush]
  ]) {
    visit(payload, (value, path) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(value)) {
        assert.ok(!forbiddenKeys.has(key), `${name} APNs leaks ${key} at ${path}`);
      }
    });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    assert.doesNotMatch(serialized, /https?:\/\//i);
  }

  assert.equal(contract["x-birdie-security-invariants"].watchReceivesTokens, false);
});

test("native notification categories match the contract and never expose approval execution", () => {
  const categoryNames = Object.keys(contract["x-birdie-apns-categories"]);
  for (const category of categoryNames) assert.match(notificationSource, new RegExp(category));

  const actionIds = new Set(
    categoryNames.flatMap((category) =>
      contract["x-birdie-apns-categories"][category].actions.map((action) => action.id)
    )
  );
  for (const actionId of actionIds) assert.match(notificationSource, new RegExp(actionId));

  assert.doesNotMatch(notificationSource, /identifier:\s*"(?:BIRDIE_)?APPROVE/i);
  assert.match(notificationSource, /hiddenPreviewsBodyPlaceholder:/);
  assert.doesNotMatch(notificationSource, /hiddenPreviewsShowTitle|hiddenPreviewsShowSubtitle/);
});

test("Watch cannot assert approval or bypass Birdie Trust for mail", () => {
  assert.doesNotMatch(watchAPISource, /founderApproved|SEND_EMAIL|"action": "mailReply"/);
  assert.doesNotMatch(watchRelaySource, /request\(path: "\/watch\/mail\/reply"/);
  assert.match(watchRelaySource, /controlledActionRequiresPhoneReview/);
  assert.doesNotMatch(watchViewSource, /Jetzt senden|Antwort prüfen & senden|sendReply/);
  assert.match(watchViewSource, /Birdie Approve auf dem iPhone/);
  assert.equal(contract["x-birdie-security-invariants"].watchReceivesTokens, false);
});

test("every Approval inbox card exposes its exact target and intended change summary", () => {
  assert.match(approveViewSource, /approval\.target\.canonicalIdentifier/);
  assert.match(approveViewSource, /approval\.changes\.prefix\(3\)/);
  assert.match(approveViewSource, /change\.before/);
  assert.match(approveViewSource, /change\.proposed/);
});

test("native approval mutations carry Trust-v1 binding and release fails closed", () => {
  assert.match(trustModelSource, /static let contract = "birdie-trust-v1"/);
  for (const field of [
    "recordVersion",
    "idempotencyKey",
    "challengeID",
    "oneTimeNonce",
    "actionDigest",
    "deviceBindingID",
    "deviceAssertion",
    "localAuthorization"
  ]) {
    assert.match(trustModelSource, new RegExp(`let ${field}:`));
  }
  assert.match(trustStoreSource, /challenge\.maxAttempts == 1/);
  assert.match(trustStoreSource, /challenge\.consumed == false/);
  assert.match(trustStoreSource, /minimumDecodedBytes: 32/);
  assert.match(trustStoreSource, /BirdieApprovalCanonicalizer\.actionDigest/);
  assert.match(trustStoreSource, /recoverPendingReceipts/);
  assert.match(trustStoreSource, /AppAttestDeviceAssertionProvider\(\)/);
  assert.match(trustStoreSource, /UnavailableApprovalClient\(\)/);
  assert.match(trustSecuritySource, /lhs\.utf16\.lexicographicallyPrecedes\(rhs\.utf16\)/);
  assert.match(trustSecuritySource, /policy: "biometrics_only"/);
  assert.doesNotMatch(trustSecuritySource, /device_owner_biometrics|birdie_risk_policy_v1/);
  assert.match(trustSecuritySource, /activateRegistration\(\s*afterBackendAcknowledgedKeyID/);
});

test("XcodeGen wires the Live Activity, tests, Face ID, URL routing, and Live Activities flag", () => {
  assert.match(projectSpec, /^\s{2}BirdieLiveActivity:/m);
  assert.match(projectSpec, /^\s{2}BirdiePhoneTests:/m);
  assert.match(projectSpec, /- target: BirdieLiveActivity/);
  assert.match(projectSpec, /- BirdiePhoneTests/);
  assert.match(projectSpec, /CODE_SIGN_ENTITLEMENTS: BirdiePhone\/BirdiePhone\.entitlements/);
  assert.match(projectSpec, /BIRDIE_APP_ATTEST_ENVIRONMENT: development/);
  assert.match(projectSpec, /BIRDIE_APP_ATTEST_ENVIRONMENT: production/);
  assert.match(phoneEntitlements, /com\.apple\.developer\.devicecheck\.appattest-environment/);
  assert.doesNotMatch(personalProjectSpec, /CODE_SIGN_ENTITLEMENTS|BIRDIE_APP_ATTEST_ENVIRONMENT/);
  assert.match(phoneInfo, /<key>NSFaceIDUsageDescription<\/key>/);
  assert.match(phoneInfo, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
  assert.match(phoneInfo, /<string>birdie<\/string>/);
  for (const extensionInfo of [liveActivityInfo, watchWidgetInfo]) {
    assert.match(extensionInfo, /<key>NSExtension<\/key>\s*<dict>/);
    assert.match(extensionInfo, /<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.widgetkit-extension<\/string>/);
  }
  assert.match(projectSpec, /INFOPLIST_FILE: BirdieLiveActivity\/Info\.plist/);
  assert.match(projectSpec, /INFOPLIST_FILE: BirdieWatchWidget\/Info\.plist/);
});
