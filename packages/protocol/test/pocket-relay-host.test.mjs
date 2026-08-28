import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  MockPocketRelayHostExecutor,
  POCKET_RELAY_HOST_CONTRACT_VERSION,
  PocketRelayHostAction,
  createPocketRelayHostEffectRequest,
  validatePocketRelayHostEffectRequest,
} from '../src/pocket-relay-host.mjs';

const target = { deviceId: 'birdie-windows-mock', deviceName: 'Birdie Windows Mock', platform: 'windows' };

function command(action, payload) {
  return {
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    deviceId: 'iphone-device-1',
    target,
    action,
    scope: action === PocketRelayHostAction.OPEN_LINK ? 'https_link' : 'host_session_lock',
    payload,
  };
}

function lease() {
  return { signal: new AbortController().signal, assertActive() {} };
}

test('Pocket Relay host effect contract is exact, versioned and allowlisted', () => {
  const request = createPocketRelayHostEffectRequest({
    command: command(PocketRelayHostAction.OPEN_LINK, { url: 'https://example.com' }),
    leaseId: randomUUID(),
  });
  assert.equal(request.version, POCKET_RELAY_HOST_CONTRACT_VERSION);
  assert.equal(validatePocketRelayHostEffectRequest(request).action, PocketRelayHostAction.OPEN_LINK);
  assert.throws(
    () => validatePocketRelayHostEffectRequest({ ...request, shell: 'never' }),
    (error) => error.code === 'HOST_CONTRACT_SCHEMA_INVALID'
  );
  assert.throws(
    () => validatePocketRelayHostEffectRequest({ ...request, payload: { url: 'http://localhost' } }),
    (error) => error.code === 'HOST_LINK_INVALID'
  );
});

test('mock host executor performs only simulated link-open and lock effects behind a lease', async () => {
  const host = new MockPocketRelayHostExecutor();
  assert.deepEqual(host.describe().enabledActions, ['link.open.v1', 'pc.lock.v1']);
  const link = await host.execute(
    createPocketRelayHostEffectRequest({
      command: command(PocketRelayHostAction.OPEN_LINK, { url: 'https://example.com/path' }),
      leaseId: randomUUID(),
    }),
    lease()
  );
  const lock = await host.execute(
    createPocketRelayHostEffectRequest({
      command: command(PocketRelayHostAction.LOCK_PC, { confirmation: 'LOCK_PC' }),
      leaseId: randomUUID(),
    }),
    lease()
  );
  assert.equal(link.state, 'completed');
  assert.equal(link.productionEffect, false);
  assert.equal(lock.state, 'completed');
  assert.equal(lock.productionEffect, false);
  assert.equal(host.effects.length, 2);
});

test('mock host rejects file/workflow actions instead of silently widening the adapter', () => {
  assert.throws(
    () => createPocketRelayHostEffectRequest({
      command: command('file.send_to_pc.v1', { fileName: 'x.txt' }),
      leaseId: randomUUID(),
    }),
    (error) => error.code === 'HOST_ACTION_NOT_ALLOWED'
  );
});

test('host contract has no shell, pipe, or arbitrary process execution surface', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/pocket-relay-host.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /child_process|node:net|PowerShell|cmd\.exe|\\\\\.\\pipe/i);
});
