import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  PocketRelayAction
} from "../src/pocket-relay/contract.mjs";
import { base64UrlDecode, base64UrlEncode } from "../src/pocket-relay/crypto.mjs";
import { PocketRelayReferenceClient } from "../src/pocket-relay/client.mjs";
import { createPocketRelayMockHost } from "../src/pocket-relay/mock-host.mjs";

export async function runPocketRelayMockSmoke() {
  const pairingCode = `smoke-${base64UrlEncode(randomBytes(18))}`;
  const host = createPocketRelayMockHost({ pairingCode });
  const { baseURL } = await host.listen();
  const client = new PocketRelayReferenceClient({ baseURL, pairingCode });

  try {
    const pairing = await client.pair();
    assert.equal(pairing.targetDevice.platform, "windows");

    const link = await client.submit({
      action: PocketRelayAction.OPEN_LINK,
      payload: { url: "https://example.com/birdie-relay-smoke" }
    });
    assert.equal(link.state, "completed");
    assert.equal(link.result.simulated, true);
    assert.equal(client.verifyReceipt(link), true);

    const replay = await client.sendSignedRequest(link.request);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(replay.signedReceipt, link.signedReceipt);
    assert.equal(host.bridge.effects.filter((effect) => effect.commandId === link.command.commandId).length, 1);

    const selected = Buffer.from("selected on iPhone for Pocket Relay smoke\n", "utf8");
    const upload = await client.submit({
      action: PocketRelayAction.SEND_FILE_TO_PC,
      approveHighRisk: true,
      payload: {
        fileName: "iphone-selected.txt",
        contentType: "text/plain",
        sizeBytes: selected.length,
        sha256: createHash("sha256").update(selected).digest("hex"),
        contentBase64: selected.toString("base64")
      }
    });
    assert.equal(upload.result.sizeBytes, selected.length);
    const uploadReceipt = JSON.parse(base64UrlDecode(upload.signedReceipt.receipt).toString("utf8"));
    assert.equal(JSON.stringify(uploadReceipt).includes("contentBase64"), false);
    assert.equal(JSON.stringify(uploadReceipt).includes(selected.toString("base64")), false);

    const download = await client.submit({
      action: PocketRelayAction.FETCH_FILE_TO_IPHONE,
      approveHighRisk: true,
      payload: { exportId: "approved-demo-export" }
    });
    assert.equal(Buffer.from(download.result.file.contentBase64, "base64").length, download.result.file.sizeBytes);
    const downloadReceipt = JSON.parse(base64UrlDecode(download.signedReceipt.receipt).toString("utf8"));
    assert.equal(JSON.stringify(downloadReceipt).includes("contentBase64"), false);

    const workflowRunId = randomUUID();
    const started = await client.submit({
      action: PocketRelayAction.START_WORKFLOW,
      approveHighRisk: true,
      payload: { workflowId: "daily-briefing", runId: workflowRunId, expectedRevision: 0 }
    });
    assert.equal(started.result.state, "running");

    const paused = await client.submit({
      action: PocketRelayAction.PAUSE_WORKFLOW,
      payload: {
        workflowId: "daily-briefing",
        runId: workflowRunId,
        expectedRevision: started.result.revision
      }
    });
    assert.equal(paused.result.state, "paused");
    await assert.rejects(
      () => client.submit({
        action: PocketRelayAction.CANCEL_WORKFLOW,
        approveHighRisk: true,
        payload: {
          workflowId: "daily-briefing",
          runId: workflowRunId,
          expectedRevision: started.result.revision
        }
      }),
      (error) => error.code === "WORKFLOW_REVISION_CONFLICT"
    );

    const resumed = await client.submit({
      action: PocketRelayAction.START_WORKFLOW,
      approveHighRisk: true,
      payload: {
        workflowId: "daily-briefing",
        runId: workflowRunId,
        expectedRevision: paused.result.revision
      }
    });
    assert.equal(resumed.result.state, "running");
    host.bridge.completeWorkflow(
      "daily-briefing",
      workflowRunId,
      resumed.result.revision,
      { summary: "Smoke result" }
    );

    const workflowResult = await client.submit({
      action: PocketRelayAction.GET_WORKFLOW_RESULT,
      payload: {
        workflowId: "daily-briefing",
        runId: workflowRunId,
        knownRevision: resumed.result.revision
      }
    });
    assert.equal(workflowResult.result.state, "completed");
    assert.equal(workflowResult.result.result.summary, "Smoke result");

    const restartedRunId = randomUUID();
    const restarted = await client.submit({
      action: PocketRelayAction.START_WORKFLOW,
      approveHighRisk: true,
      payload: { workflowId: "daily-briefing", runId: restartedRunId, expectedRevision: 0 }
    });
    assert.equal(restarted.result.state, "running");
    const cancelled = await client.submit({
      action: PocketRelayAction.CANCEL_WORKFLOW,
      approveHighRisk: true,
      payload: {
        workflowId: "daily-briefing",
        runId: restartedRunId,
        expectedRevision: restarted.result.revision
      }
    });
    assert.equal(cancelled.result.state, "cancelled");

    const lock = await client.submit({
      action: PocketRelayAction.LOCK_PC,
      approveHighRisk: true,
      payload: { confirmation: "LOCK_PC" }
    });
    assert.equal(lock.result.locked, true);
    assert.match(lock.result.note, /Mock only/u);

    assert.equal(host.revokeDevice(pairing.deviceId, "smoke_remote_revoke"), true);
    let revokeCode = null;
    try {
      await client.submit({
        action: PocketRelayAction.GET_WORKFLOW_RESULT,
        payload: {
          workflowId: "daily-briefing",
          runId: restartedRunId,
          knownRevision: cancelled.result.revision
        }
      });
    } catch (error) {
      revokeCode = error.code;
    }
    assert.equal(revokeCode, "DEVICE_REVOKED");

    host.setKillSwitch(true);
    let killSwitchCode = null;
    try {
      await client.refreshToken();
    } catch (error) {
      killSwitchCode = error.code;
    }
    assert.equal(killSwitchCode, "RELAY_KILL_SWITCH_ACTIVE");

    return {
      version: "pocket-relay.mock-smoke.v1",
      transport: "loopback-http",
      productionEffectsEnabled: false,
      commandState: link.state,
      workflowStates: [
        started.result.state,
        paused.result.state,
        resumed.result.state,
        workflowResult.result.state,
        cancelled.result.state
      ],
      fileRoundTrips: 2,
      receiptVerified: true,
      exactReplayDeduplicated: true,
      remoteRevokeCode: revokeCode,
      killSwitchCode
    };
  } finally {
    await host.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const summary = await runPocketRelayMockSmoke();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
