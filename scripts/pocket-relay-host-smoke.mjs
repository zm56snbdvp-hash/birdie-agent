import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PocketRelayHostAction,
  createPocketRelayHostEffectRequest,
} from '../packages/protocol/src/pocket-relay-host.mjs';
import { PocketRelayHostAdapter } from '../packages/protocol/src/pocket-relay-host-adapter.mjs';

const targetDeviceId = 'birdie-windows-smoke';
const calls = [];
const adapter = new PocketRelayHostAdapter({
  targetDeviceId,
  platform: 'win32',
  enableProductionEffects: true,
  openHttpsLink: async (url, { signal }) => calls.push({ action: 'open', url, aborted: signal.aborted }),
  lockInteractiveSession: async ({ signal }) => calls.push({ action: 'lock', aborted: signal.aborted }),
});
const lease = { signal: new AbortController().signal, assertActive() {} };
const command = {
  commandId: randomUUID(),
  idempotencyKey: randomUUID(),
  deviceId: 'iphone-smoke',
  target: { deviceId: targetDeviceId },
  action: PocketRelayHostAction.OPEN_LINK,
  scope: 'https_link',
  payload: { url: 'https://example.com/pocket-relay-smoke' },
};
const request = createPocketRelayHostEffectRequest({ command, leaseId: randomUUID() });
const first = await adapter.execute(request, lease);
const replay = await adapter.execute(request, lease);

assert.equal(first.state, 'completed');
assert.equal(first.productionEffect, true);
assert.strictEqual(replay, first);
assert.deepEqual(calls, [{ action: 'open', url: command.payload.url, aborted: false }]);

console.log(JSON.stringify({
  ok: true,
  contract: request.version,
  action: first.action,
  idempotentReplay: calls.length === 1,
  productionHookCalls: calls.length,
}));
