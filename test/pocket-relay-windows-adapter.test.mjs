import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createWindowsPocketRelayAdapter,
  WindowsPocketRelayAdapter
} from "../services/pocket-relay-host/windows-adapter.mjs";
import { PocketRelayAction } from "../src/pocket-relay/contract.mjs";

const targetDevice = Object.freeze({
  deviceId: "birdie-windows-adapter-test",
  deviceName: "Birdie Windows Adapter Test",
  platform: "windows"
});

function command(action, payload, target = targetDevice) {
  return {
    action,
    target,
    scope: action === PocketRelayAction.OPEN_LINK ? "https_link" : "host_session_lock",
    payload
  };
}

function leaseFor(controller = new AbortController()) {
  return {
    signal: controller.signal,
    assertActive() {
      if (controller.signal.aborted) {
        const error = new Error("lease aborted");
        error.code = "COMMAND_EFFECT_LEASE_REVOKED";
        throw error;
      }
    }
  };
}

test("Windows adapter is disabled unless explicit Windows executor hooks are supplied", async () => {
  const adapter = createWindowsPocketRelayAdapter({ targetDevice, platform: "linux" });
  assert.equal(adapter instanceof WindowsPocketRelayAdapter, true);
  assert.deepEqual(adapter.describe().enabledActions, ["link.open.v1", "pc.lock.v1"]);
  assert.equal(adapter.describe().productionEffectsEnabled, false);
  await assert.rejects(
    () => adapter.execute(command(PocketRelayAction.OPEN_LINK, { url: "https://example.com" }), leaseFor()),
    (error) => error.code === "PRODUCTION_BRIDGE_NOT_CONFIGURED"
  );
});

test("Windows adapter runs only HTTPS-open and interactive-lock hooks with lease checks", async () => {
  const calls = [];
  const adapter = createWindowsPocketRelayAdapter({
    targetDevice,
    platform: "win32",
    enableProductionEffects: true,
    openHttpsLink: async (url, context) => calls.push(["open", url, context.signal.aborted]),
    lockInteractiveSession: async (context) => calls.push(["lock", context.signal.aborted])
  });
  const openResult = await adapter.execute(
    command(PocketRelayAction.OPEN_LINK, { url: "https://example.com/path" }),
    leaseFor()
  );
  const lockResult = await adapter.execute(
    command(PocketRelayAction.LOCK_PC, { confirmation: "LOCK_PC" }),
    leaseFor()
  );
  assert.deepEqual(openResult, { productionEffect: true, openedUrl: "https://example.com/path" });
  assert.deepEqual(lockResult, { productionEffect: true, locked: true });
  assert.equal(calls[0][0], "open");
  assert.equal(calls[1][0], "lock");
  assert.equal(calls[0][2], false);
  assert.equal(calls[1][1], false);
});

test("Windows adapter fails closed on disabled actions, wrong targets and revoked leases", async () => {
  const controller = new AbortController();
  const adapter = createWindowsPocketRelayAdapter({
    targetDevice,
    platform: "win32",
    enableProductionEffects: true,
    openHttpsLink: async () => controller.abort(),
    lockInteractiveSession: async () => {}
  });
  await assert.rejects(
    () => adapter.execute(command(PocketRelayAction.SEND_FILE_TO_PC, {
      fileName: "x.txt",
      contentType: "text/plain",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      contentBase64: "eA=="
    }), leaseFor()),
    (error) => error.code === "BRIDGE_ACTION_NOT_SUPPORTED"
  );
  await assert.rejects(
    () => adapter.execute(
      command(PocketRelayAction.OPEN_LINK, { url: "https://example.com" }, { ...targetDevice, deviceId: "other" }),
      leaseFor()
    ),
    (error) => error.code === "TARGET_NOT_PAIRED"
  );
  await assert.rejects(
    () => adapter.execute(command(PocketRelayAction.OPEN_LINK, { url: "https://example.com" }), leaseFor(controller)),
    (error) => error.code === "COMMAND_EFFECT_LEASE_REVOKED"
  );
});

test("Windows adapter stays independent from the internal desktop pipe and shell", async () => {
  const source = await readFile(
    new URL("../services/pocket-relay-host/windows-adapter.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /(?:child_process|node:net|ShellExecute|PowerShell|cmd\.exe|\\\\\.\\pipe)/iu);
});
