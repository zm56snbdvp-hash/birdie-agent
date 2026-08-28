import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { DisabledPocketRelayBridge } from "../src/pocket-relay/bridge.mjs";
import { PocketRelayReferenceClient } from "../src/pocket-relay/client.mjs";
import { PocketRelayAction } from "../src/pocket-relay/contract.mjs";
import { base64UrlEncode } from "../src/pocket-relay/crypto.mjs";
import { createPocketRelayMockHost } from "../src/pocket-relay/mock-host.mjs";
import { PocketRelayService } from "../src/pocket-relay/service.mjs";

function serviceVerifiedCommand() {
  return {
    command: {
      version: "pocket-relay.command.v1",
      commandId: "423e4567-e89b-42d3-a456-426614174003",
      idempotencyKey: "523e4567-e89b-42d3-a456-426614174004",
      deviceId: "iphone-service-test",
      nonce: "a234567890123456789012",
      issuedAt: "2026-08-28T12:00:00.000Z",
      expiresAt: "2026-08-28T12:01:00.000Z",
      action: "link.open.v1",
      target: {
        deviceId: "windows-service-test",
        deviceName: "Windows Service Test",
        platform: "windows"
      },
      scope: "https_link",
      payload: { url: "https://example.com/service" },
      disclosure: {
        targetDevice: "Windows Service Test",
        scope: "https_link",
        data: { url: "https://example.com/service" },
        expectedEffect: "Der ausgewählte HTTPS-Link wird im Standardbrowser des Ziel-PCs geöffnet."
      }
    },
    descriptor: {
      risk: "low",
      expectedEffect: "Der ausgewählte HTTPS-Link wird im Standardbrowser des Ziel-PCs geöffnet."
    },
    commandBytesDigest: "1".repeat(64),
    exactReplay: false
  };
}

function serviceSecurity({ throwOnSign = false } = {}) {
  return {
    createEffectLease() {
      return {
        signal: new AbortController().signal,
        assertActive() {},
        close() {}
      };
    },
    signReceipt(receipt) {
      if (throwOnSign) throw new Error("C:\\private\\receipt-key.txt");
      return {
        receipt: Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url"),
        signature: "test-signature",
        algorithm: "Ed25519"
      };
    }
  };
}

test("an unavailable production bridge fails closed with a signed failed receipt", async (t) => {
  const pairingCode = `disabled-${base64UrlEncode(randomBytes(18))}`;
  const targetDevice = {
    deviceId: "disabled-windows-host",
    deviceName: "Disabled Windows Host",
    platform: "windows"
  };
  const host = createPocketRelayMockHost({
    pairingCode,
    bridge: new DisabledPocketRelayBridge({ targetDevice })
  });
  const { baseURL } = await host.listen();
  t.after(() => host.close());
  const client = new PocketRelayReferenceClient({ baseURL, pairingCode });
  await client.pair();
  const signed = client.createSignedCommand({
    action: PocketRelayAction.OPEN_LINK,
    payload: { url: "https://example.com/fail-closed" }
  });

  let first;
  await assert.rejects(
    async () => {
      try {
        await client.sendSignedRequest(signed.request);
      } catch (error) {
        first = error;
        throw error;
      }
    },
    (error) => error.code === "PRODUCTION_BRIDGE_NOT_CONFIGURED" && error.status === 503
  );
  assert.equal(first.response.state, "failed");
  assert.equal(client.verifyReceipt({
    ...first.response,
    command: signed.command,
    request: signed.request
  }), true);

  let replay;
  await assert.rejects(
    async () => {
      try {
        await client.sendSignedRequest(signed.request);
      } catch (error) {
        replay = error;
        throw error;
      }
    },
    (error) => error.code === "PRODUCTION_BRIDGE_NOT_CONFIGURED"
  );
  assert.equal(replay.response.idempotentReplay, true);
  assert.deepEqual(replay.response.signedReceipt, first.response.signedReceipt);
});

test("concurrent identical deliveries reserve idempotency before one bridge effect", async () => {
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = new PocketRelayService({
    security: serviceSecurity(),
    bridge: {
      async execute() {
        executions += 1;
        await gate;
        return { simulated: true };
      }
    }
  });
  const verified = serviceVerifiedCommand();
  const first = service.submit(verified);
  const concurrent = service.submit({ ...verified, exactReplay: true });
  release();
  const [a, b] = await Promise.all([first, concurrent]);
  assert.equal(executions, 1);
  assert.equal(a.idempotentReplay, false);
  assert.equal(b.idempotentReplay, true);
  assert.deepEqual(b.signedReceipt, a.signedReceipt);
});

test("unsafe adapter results and post-effect signing errors never authorize re-execution", async () => {
  let invalidResultExecutions = 0;
  const invalidResultService = new PocketRelayService({
    security: serviceSecurity(),
    bridge: {
      async execute() {
        invalidResultExecutions += 1;
        return { value: 1n };
      }
    }
  });
  const verified = serviceVerifiedCommand();
  const failed = await invalidResultService.submit(verified);
  const failedReplay = await invalidResultService.submit({ ...verified, exactReplay: true });
  assert.equal(invalidResultExecutions, 1);
  assert.equal(failed.state, "failed");
  assert.equal(failed.error.message.includes("private"), false);
  assert.deepEqual(failedReplay.signedReceipt, failed.signedReceipt);

  let signingExecutions = 0;
  const signingFailureService = new PocketRelayService({
    security: serviceSecurity({ throwOnSign: true }),
    bridge: {
      async execute() {
        signingExecutions += 1;
        return { simulated: true };
      }
    }
  });
  const [first, concurrent] = await Promise.allSettled([
    signingFailureService.submit(verified),
    signingFailureService.submit({ ...verified, exactReplay: true })
  ]);
  assert.equal(signingExecutions, 1);
  for (const outcome of [first, concurrent]) {
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason.code, "IDEMPOTENCY_EFFECT_STATUS_UNKNOWN");
    assert.equal(outcome.reason.message.includes("private"), false);
  }
  await assert.rejects(
    () => signingFailureService.submit(verified),
    (error) => error.code === "IDEMPOTENCY_EFFECT_STATUS_UNKNOWN"
  );
  assert.equal(signingExecutions, 1);
});

test("untrusted adapter codes, statuses and messages are not exposed", async () => {
  const service = new PocketRelayService({
    security: serviceSecurity(),
    bridge: {
      async execute() {
        throw Object.assign(new Error("C:\\private\\host-path.txt"), {
          code: "C:\\private\\adapter-code",
          status: 418
        });
      }
    }
  });
  const failed = await service.submit(serviceVerifiedCommand());
  assert.equal(failed.state, "failed");
  assert.deepEqual(failed.error, {
    code: "BRIDGE_EXECUTION_FAILED",
    message: "Pocket Relay host execution failed without exposing host details.",
    status: 500
  });
});

test("a revoked effect lease stops a queued adapter before commit", async () => {
  let enterAdapter;
  let releaseAdapter;
  const entered = new Promise((resolve) => { enterAdapter = resolve; });
  const release = new Promise((resolve) => { releaseAdapter = resolve; });
  const controller = new AbortController();
  let committedEffects = 0;
  const security = {
    ...serviceSecurity(),
    createEffectLease() {
      return {
        signal: controller.signal,
        assertActive() {
          if (controller.signal.aborted) throw controller.signal.reason;
        },
        close() {}
      };
    }
  };
  const service = new PocketRelayService({
    security,
    bridge: {
      async execute(_command, effectLease) {
        enterAdapter();
        await release;
        effectLease.assertActive();
        committedEffects += 1;
        return { simulated: true };
      }
    }
  });

  const pending = service.submit(serviceVerifiedCommand());
  await entered;
  controller.abort(Object.assign(new Error("revoked before commit"), {
    code: "DEVICE_REVOKED",
    status: 403
  }));
  releaseAdapter();
  const response = await pending;
  assert.equal(committedEffects, 0);
  assert.equal(response.state, "failed");
  assert.equal(response.error.code, "DEVICE_REVOKED");
});
