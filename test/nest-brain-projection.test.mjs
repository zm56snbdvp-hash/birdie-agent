import test from "node:test";
import assert from "node:assert/strict";
import {
  NEST_BRAIN_PROJECTION_POLICY,
  createNestBrainProjection,
  sanitizeNestBrainData
} from "../src/nest/nest-brain-projection.mjs";

const NOW = new Date("2026-08-15T06:00:00.000Z");
const FRESH = "2026-08-15T05:58:00.000Z";

function sources() {
  return {
    briefing: {
      sourceTimestamp: FRESH,
      data: {
        title: "BirdieOS Morning",
        summary: "Launch guarded. Contact kevin@example.com and token=abc123 must not survive.",
        launchState: "CONTROLLED_BLOCK",
        nextAction: "Continue internal verification",
        finance: { revenue: 999 },
        notes: "private"
      }
    },
    osMap: {
      sourceTimestamp: FRESH,
      data: [
        { componentId: "COIN", name: "Coin System", status: "HEALTHY", providerConfig: "secret" },
        { componentId: "FRAMER", name: "Website", status: "CONTROLLED_BLOCK" }
      ]
    },
    tasks: {
      sourceTimestamp: FRESH,
      data: [
        {
          "Task ID": "TASK-123",
          Task: "Provider gate — api_key=supersecret",
          Area: "SYSTEMS",
          Priority: "HIGH",
          Status: "WAITING",
          "Blocked Reason": "Signed out",
          email: "ops@example.com",
          cost: 123
        },
        {
          "Task ID": "TASK-096",
          Task: "Build bounded read projection",
          Area: "NEST",
          Priority: "MEDIUM",
          Status: "IN PROGRESS"
        }
      ]
    },
    health: {
      sourceTimestamp: FRESH,
      data: [
        { checkId: "HC-1", componentId: "CORE", criticality: "CRITICAL", status: "HEALTHY", evidenceReference: "secret" },
        { checkId: "HC-2", componentId: "AUX", criticality: "LOW", status: "HEALTHY" }
      ]
    },
    exceptions: {
      sourceTimestamp: FRESH,
      data: [
        { exceptionId: "EX-1", componentId: "IMPORT", severity: "HIGH", status: "OPEN", customerEmail: "guest@example.com" },
        { exceptionId: "EX-2", componentId: "MINOR", severity: "LOW", status: "OPEN" }
      ]
    }
  };
}

test("policy is read-only and deny-by-default", () => {
  assert.equal(NEST_BRAIN_PROJECTION_POLICY.readOnly, true);
  assert.equal(NEST_BRAIN_PROJECTION_POLICY.denyByDefault, true);
  assert.deepEqual(NEST_BRAIN_PROJECTION_POLICY.mutationMethods, []);
  assert.equal(NEST_BRAIN_PROJECTION_POLICY.rawSheetAccess, false);
  assert.equal(NEST_BRAIN_PROJECTION_POLICY.founderCredentialFallback, false);
});

test("PRIVATE projection exposes only bounded fields and sanitizes sentinels", () => {
  const output = createNestBrainProjection({
    requestedMode: "PRIVATE",
    requestedProjections: ["briefing", "osMap", "tasks", "health", "exceptions"],
    sources: sources(),
    now: NOW
  });

  assert.equal(output.mode, "PRIVATE");
  assert.equal(output.readOnly, true);
  assert.equal(output.sourceFingerprint.length, 24);
  assert.equal(output.data.tasks[0].taskId, "TASK-123");
  assert.equal(output.data.tasks[0].blocked, true);
  assert.match(output.data.tasks[0].title, /\[redacted-secret\]/);
  assert.doesNotMatch(JSON.stringify(output), /kevin@example\.com|ops@example\.com|guest@example\.com|supersecret|abc123/);
  assert.equal("finance" in output.data.briefing, false);
  assert.equal("notes" in output.data.briefing, false);
  assert.equal("providerConfig" in output.data.osMap[0], false);
  assert.equal("evidenceReference" in output.data.health[0], false);
  assert.equal("customerEmail" in output.data.exceptions[0], false);
  assert.equal(output.data.briefing.focus, "Continue internal verification");
});

test("SAFE_TO_FILM is no more permissive than PRIVATE", () => {
  const privateOutput = createNestBrainProjection({
    requestedMode: "PRIVATE",
    requestedProjections: ["briefing", "osMap", "tasks", "health", "exceptions"],
    sources: sources(),
    now: NOW
  });
  const filmOutput = createNestBrainProjection({
    requestedMode: "SAFE_TO_FILM",
    requestedProjections: ["briefing", "osMap", "tasks", "health", "exceptions"],
    sources: sources(),
    now: NOW
  });

  assert.equal("focus" in filmOutput.data.briefing, false);
  assert.ok(filmOutput.data.osMap.length <= privateOutput.data.osMap.length);
  assert.ok(filmOutput.data.tasks.length <= privateOutput.data.tasks.length);
  assert.ok(filmOutput.data.health.length <= privateOutput.data.health.length);
  assert.ok(filmOutput.data.exceptions.length <= privateOutput.data.exceptions.length);
  assert.deepEqual(filmOutput.data.health.map((item) => item.checkId), ["HC-1"]);
  assert.deepEqual(filmOutput.data.exceptions.map((item) => item.exceptionId), ["EX-1"]);
});

test("arbitrary projection and arbitrary source naming are denied", () => {
  assert.throws(
    () => createNestBrainProjection({
      requestedMode: "PRIVATE",
      requestedProjections: ["rawSheet:A1:Z999"],
      sources: sources(),
      now: NOW
    }),
    (error) => error?.code === "NEST_PROJECTION_DENIED"
  );

  assert.throws(
    () => createNestBrainProjection({
      requestedMode: "PRIVATE",
      requestedProjections: ["tasks"],
      sources: { spreadsheetRange: { sourceTimestamp: FRESH, data: [] } },
      now: NOW
    }),
    (error) => error?.code === "NEST_SOURCE_MISSING"
  );
});

test("stale, missing, or invalid source metadata fails closed", () => {
  const stale = sources();
  stale.tasks.sourceTimestamp = "2026-08-15T04:00:00.000Z";
  assert.throws(
    () => createNestBrainProjection({
      requestedMode: "PRIVATE",
      requestedProjections: ["tasks"],
      sources: stale,
      now: NOW,
      maxAgeMs: 15 * 60 * 1000
    }),
    (error) => error?.code === "NEST_SOURCE_STALE"
  );

  const invalid = sources();
  delete invalid.tasks.sourceTimestamp;
  assert.throws(
    () => createNestBrainProjection({
      requestedMode: "PRIVATE",
      requestedProjections: ["tasks"],
      sources: invalid,
      now: NOW
    }),
    (error) => error?.code === "NEST_SOURCE_TIMESTAMP_INVALID"
  );
});

test("recursive sanitizer removes denied keys and inline secrets", () => {
  const value = sanitizeNestBrainData({
    ok: "keep",
    nested: {
      email: "private@example.com",
      safe: "Call +49 170 12345678; password=hunter2; Bearer abc.def.ghi"
    },
    ledgerBalance: 18,
    exactLocation: { lat: 1, lng: 2 }
  });

  assert.equal(value.ok, "keep");
  assert.equal("email" in value.nested, false);
  assert.equal("ledgerBalance" in value, false);
  assert.equal("exactLocation" in value, false);
  assert.doesNotMatch(value.nested.safe, /12345678|hunter2|abc\.def\.ghi/);
});
