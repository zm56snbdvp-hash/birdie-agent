import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  POCKET_RELAY_ALLOWLIST,
  POCKET_RELAY_COMMAND_VERSION,
  PocketRelayAction,
  PocketRelayProtocolError,
  describePocketRelayCommand,
  validatePocketRelayCommand
} from "../src/pocket-relay/contract.mjs";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const TARGET = {
  deviceId: "birdie-windows-mock",
  deviceName: "Birdie Windows Mock",
  platform: "windows"
};
const WORKFLOW_RUN_ID = "323e4567-e89b-42d3-a456-426614174002";

function workflowPayload(expectedRevision = 0) {
  return {
    workflowId: "daily-briefing",
    runId: WORKFLOW_RUN_ID,
    expectedRevision
  };
}

function workflowResultPayload(knownRevision = undefined) {
  return {
    workflowId: "daily-briefing",
    runId: WORKFLOW_RUN_ID,
    ...(knownRevision === undefined ? {} : { knownRevision })
  };
}

function command(action, payload, { approveHighRisk = false } = {}) {
  const value = {
    version: POCKET_RELAY_COMMAND_VERSION,
    commandId: "123e4567-e89b-42d3-a456-426614174000",
    idempotencyKey: "223e4567-e89b-42d3-a456-426614174001",
    deviceId: "iphone-123",
    nonce: "a234567890123456789012",
    issuedAt: "2026-08-28T12:00:00.000Z",
    expiresAt: "2026-08-28T12:01:00.000Z",
    action,
    target: { ...TARGET },
    scope: POCKET_RELAY_ALLOWLIST[action]?.scope,
    payload
  };
  value.disclosure = describePocketRelayCommand(value);
  if (approveHighRisk) {
    value.approval = {
      method: "explicit_iphone_confirmation",
      commandId: value.commandId,
      approvedAt: value.issuedAt
    };
  }
  return value;
}

function expectCode(code) {
  return (error) => error instanceof PocketRelayProtocolError && error.code === code;
}

test("v1 allowlist is exact, high-level and contains no generic command", () => {
  assert.deepEqual(Object.values(PocketRelayAction), [
    "link.open.v1",
    "file.send_to_pc.v1",
    "file.fetch_to_iphone.v1",
    "workflow.start.v1",
    "workflow.pause.v1",
    "workflow.cancel.v1",
    "workflow.result.get.v1",
    "pc.lock.v1"
  ]);
  assert.equal(Object.values(PocketRelayAction).some((action) => /shell|exec|command/u.test(action)), false);
});

test("every accepted action binds target, scope, disclosed data and expected effect", () => {
  const value = command(PocketRelayAction.OPEN_LINK, { url: "https://example.com/report" });
  const validated = validatePocketRelayCommand(value, {
    now: () => NOW,
    expectedTargetDeviceId: TARGET.deviceId
  });
  assert.deepEqual(validated.disclosure, {
    targetDevice: TARGET.deviceName,
    scope: "https_link",
    data: { url: "https://example.com/report" },
    expectedEffect: POCKET_RELAY_ALLOWLIST[PocketRelayAction.OPEN_LINK].expectedEffect
  });

  value.disclosure.expectedEffect = "Tut etwas anderes";
  assert.throws(() => validatePocketRelayCommand(value, { now: () => NOW }), expectCode("DISCLOSURE_MISMATCH"));
});

test("arbitrary shell actions, clipboard fields and free paths fail closed", () => {
  assert.throws(
    () => describePocketRelayCommand({ action: "shell.execute.v1", target: TARGET, payload: { argv: ["whoami"] } }),
    expectCode("ACTION_NOT_ALLOWED")
  );

  const workflow = command(PocketRelayAction.START_WORKFLOW, workflowPayload());
  workflow.payload.clipboard = "secret";
  assert.throws(() => validatePocketRelayCommand(workflow, { now: () => NOW }), expectCode("CONTRACT_DANGEROUS_FIELD"));

  const content = Buffer.from("selected file", "utf8");
  assert.throws(
    () => command(PocketRelayAction.SEND_FILE_TO_PC, {
      fileName: "C:\\Users\\someone\\secret.txt",
      contentType: "text/plain",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      contentBase64: content.toString("base64")
    }, { approveHighRisk: true }),
    expectCode("FILE_NAME_INVALID")
  );

  for (const fileName of ["..\\secret.txt", "report.txt:payload.exe", "CON.txt", "trailing."]) {
    assert.throws(
      () => command(PocketRelayAction.SEND_FILE_TO_PC, {
        fileName,
        contentType: "text/plain",
        sizeBytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64")
      }, { approveHighRisk: true }),
      expectCode("FILE_NAME_INVALID")
    );
  }

  for (const contentType of ["text/plain\r\nX-Evil: yes", "../../evil", "text/plain; charset=utf-8"]) {
    assert.throws(
      () => command(PocketRelayAction.SEND_FILE_TO_PC, {
        fileName: "selected.txt",
        contentType,
        sizeBytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64")
      }, { approveHighRisk: true }),
      expectCode("CONTRACT_INVALID")
    );
  }
});

test("links are credential-free HTTPS only", () => {
  for (const url of [
    "http://example.com",
    "file:///C:/Windows/System32/cmd.exe",
    "https://user:password@example.com"
  ]) {
    assert.throws(
      () => command(PocketRelayAction.OPEN_LINK, { url }),
      (error) => error.code === "LINK_SCOPE_DENIED"
    );
  }
});

test("inline selected-file metadata, byte length and digest are integrity checked", () => {
  const content = Buffer.from("explicitly selected", "utf8");
  const value = command(PocketRelayAction.SEND_FILE_TO_PC, {
    fileName: "selected.txt",
    contentType: "text/plain",
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    contentBase64: content.toString("base64")
  }, { approveHighRisk: true });
  assert.equal(validatePocketRelayCommand(value, { now: () => NOW }).publicPayload.fileName, "selected.txt");

  value.payload.sha256 = "0".repeat(64);
  value.disclosure = describePocketRelayCommand({ ...value, payload: { ...value.payload, sha256: createHash("sha256").update(content).digest("hex") } });
  assert.throws(() => validatePocketRelayCommand(value, { now: () => NOW }), expectCode("FILE_DIGEST_MISMATCH"));
});

test("high-risk file, cancel and lock actions require fresh explicit iPhone approval", () => {
  const lock = command(PocketRelayAction.LOCK_PC, { confirmation: "LOCK_PC" });
  assert.throws(() => validatePocketRelayCommand(lock, { now: () => NOW }), expectCode("IPHONE_APPROVAL_REQUIRED"));

  lock.approval = {
    method: "explicit_iphone_confirmation",
    commandId: lock.commandId,
    approvedAt: "2026-08-28T11:55:00.000Z"
  };
  assert.throws(() => validatePocketRelayCommand(lock, { now: () => NOW }), expectCode("IPHONE_APPROVAL_EXPIRED"));

  lock.approval.approvedAt = lock.issuedAt;
  assert.equal(validatePocketRelayCommand(lock, { now: () => NOW }).descriptor.risk, "high");
});

test("expired, overlong and wrong-target commands are rejected", () => {
  const expired = command(PocketRelayAction.GET_WORKFLOW_RESULT, workflowResultPayload(4));
  assert.throws(
    () => validatePocketRelayCommand(expired, { now: () => NOW + 5 * 60_000 }),
    expectCode("COMMAND_EXPIRED")
  );

  const overlong = command(PocketRelayAction.GET_WORKFLOW_RESULT, workflowResultPayload(4));
  overlong.expiresAt = "2026-08-28T12:03:00.000Z";
  assert.throws(() => validatePocketRelayCommand(overlong, { now: () => NOW }), expectCode("COMMAND_TTL_INVALID"));

  const wrongTarget = command(PocketRelayAction.GET_WORKFLOW_RESULT, workflowResultPayload(4));
  assert.throws(
    () => validatePocketRelayCommand(wrongTarget, { now: () => NOW, expectedTargetDeviceId: "other-pc" }),
    expectCode("TARGET_NOT_PAIRED")
  );

  const spoofedName = command(PocketRelayAction.GET_WORKFLOW_RESULT, workflowResultPayload(4));
  spoofedName.target.deviceName = "Lookalike PC";
  spoofedName.disclosure.targetDevice = "Lookalike PC";
  assert.throws(
    () => validatePocketRelayCommand(spoofedName, { now: () => NOW, expectedTargetDevice: TARGET }),
    expectCode("TARGET_NOT_PAIRED")
  );
});
