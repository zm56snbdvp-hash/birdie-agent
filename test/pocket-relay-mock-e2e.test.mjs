import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { runPocketRelayMockSmoke } from "../scripts/pocket-relay-mock-smoke.mjs";
import { PocketRelayReferenceClient } from "../src/pocket-relay/client.mjs";
import { PocketRelayAction } from "../src/pocket-relay/contract.mjs";
import { base64UrlEncode } from "../src/pocket-relay/crypto.mjs";
import { createPocketRelayMockHost } from "../src/pocket-relay/mock-host.mjs";

test("reproducible mock-host smoke covers reconnect, files, workflow, receipt, revoke and kill switch", async () => {
  const summary = await runPocketRelayMockSmoke();
  assert.deepEqual(summary.workflowStates, ["running", "paused", "running", "completed", "cancelled"]);
  assert.equal(summary.exactReplayDeduplicated, true);
  assert.equal(summary.receiptVerified, true);
  assert.equal(summary.remoteRevokeCode, "DEVICE_REVOKED");
  assert.equal(summary.killSwitchCode, "RELAY_KILL_SWITCH_ACTIVE");
});

test("mock host rejects missing high-risk approval and idempotency collisions", async (t) => {
  const pairingCode = `test-${base64UrlEncode(randomBytes(18))}`;
  const host = createPocketRelayMockHost({ pairingCode });
  const { baseURL } = await host.listen();
  t.after(() => host.close());
  const client = new PocketRelayReferenceClient({ baseURL, pairingCode });
  await client.pair();

  await assert.rejects(
    () => client.submit({
      action: PocketRelayAction.LOCK_PC,
      payload: { confirmation: "LOCK_PC" }
    }),
    (error) => error.code === "IPHONE_APPROVAL_REQUIRED" && error.status === 403
  );

  const idempotencyKey = randomUUID();
  const first = await client.submit({
    action: PocketRelayAction.OPEN_LINK,
    idempotencyKey,
    payload: { url: "https://example.com/first" }
  });
  const independent = await client.submit({
    action: PocketRelayAction.OPEN_LINK,
    payload: { url: "https://example.com/independent" }
  });
  assert.equal(client.verifyReceipt({ ...independent, signedReceipt: first.signedReceipt }), false);
  assert.equal(client.verifyReceipt({
    ...independent,
    result: { ...independent.result, openedUrl: "https://attacker.invalid" }
  }), false);
  await assert.rejects(
    () => client.submit({
      action: PocketRelayAction.OPEN_LINK,
      idempotencyKey,
      payload: { url: "https://example.com/second" }
    }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409
  );
});

test("mock host refuses non-loopback binding", async () => {
  const host = createPocketRelayMockHost({ pairingCode: "loopback-only-test" });
  await assert.rejects(
    () => host.listen({ host: "0.0.0.0" }),
    (error) => error.code === "MOCK_HOST_LOOPBACK_ONLY"
  );
});

test("HTTP reconnect result read accepts a stale known revision and returns the authoritative cursor", async (t) => {
  const pairingCode = `reconnect-${base64UrlEncode(randomBytes(18))}`;
  const host = createPocketRelayMockHost({ pairingCode });
  const { baseURL } = await host.listen();
  t.after(() => host.close());
  const client = new PocketRelayReferenceClient({ baseURL, pairingCode });
  await client.pair();

  const runId = randomUUID();
  const started = await client.submit({
    action: PocketRelayAction.START_WORKFLOW,
    approveHighRisk: true,
    payload: { workflowId: "daily-briefing", runId, expectedRevision: 0 }
  });
  host.bridge.completeWorkflow(
    "daily-briefing",
    runId,
    started.result.revision,
    { summary: "completed while phone was offline" }
  );

  const reconnected = await client.submit({
    action: PocketRelayAction.GET_WORKFLOW_RESULT,
    payload: { workflowId: "daily-briefing", runId, knownRevision: started.result.revision }
  });
  assert.equal(reconnected.result.state, "completed");
  assert.equal(reconnected.result.revision, started.result.revision + 1);
  assert.equal(reconnected.result.result.summary, "completed while phone was offline");
  assert.equal(client.verifyReceipt(reconnected), true);
});
