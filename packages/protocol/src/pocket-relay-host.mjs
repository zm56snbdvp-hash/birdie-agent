import { createHash, randomUUID } from 'node:crypto';

export const POCKET_RELAY_HOST_CONTRACT_VERSION = 'pocket-relay-host.v1';

export const PocketRelayHostAction = Object.freeze({
  OPEN_LINK: 'link.open.v1',
  LOCK_PC: 'pc.lock.v1',
});

export const PocketRelayHostState = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const POCKET_RELAY_HOST_ALLOWLIST = Object.freeze({
  [PocketRelayHostAction.OPEN_LINK]: Object.freeze({
    scope: 'https_link',
    risk: 'low',
    expectedEffect: 'The selected HTTPS link opens in the target Windows browser.',
  }),
  [PocketRelayHostAction.LOCK_PC]: Object.freeze({
    scope: 'host_session_lock',
    risk: 'high',
    expectedEffect: 'The interactive session on the target Windows PC is locked.',
  }),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('HOST_CONTRACT_INVALID', `${field} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('HOST_CONTRACT_SCHEMA_INVALID', `${field} has an unexpected shape`);
  }
}

function id(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('HOST_CONTRACT_INVALID', `${field} is invalid`);
  return value;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail('HOST_CONTRACT_INVALID', `${field} is invalid`);
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail('HOST_CONTRACT_INVALID', `${field} is invalid`);
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validatePayload(action, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('HOST_CONTRACT_INVALID', 'payload must be an object');
  if (action === PocketRelayHostAction.OPEN_LINK) {
    exactKeys(payload, ['url'], 'payload');
    let url;
    try { url = new URL(payload.url); } catch { fail('HOST_LINK_INVALID', 'payload.url must be a URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || typeof payload.url !== 'string') {
      fail('HOST_LINK_INVALID', 'only credential-free HTTPS URLs are allowed');
    }
    return { url: payload.url };
  }
  exactKeys(payload, ['confirmation'], 'payload');
  if (payload.confirmation !== 'LOCK_PC') fail('HOST_LOCK_CONFIRMATION_INVALID', 'payload.confirmation must equal LOCK_PC');
  return { confirmation: 'LOCK_PC' };
}

export function validatePocketRelayHostEffectRequest(request) {
  exactKeys(request, [
    'version', 'effectId', 'commandId', 'idempotencyKey', 'deviceId', 'targetDeviceId',
    'action', 'scope', 'effectDigest', 'leaseId', 'payload',
  ], 'request');
  if (request.version !== POCKET_RELAY_HOST_CONTRACT_VERSION) fail('HOST_CONTRACT_VERSION_UNSUPPORTED', 'unsupported host effect contract version');
  uuid(request.effectId, 'effectId');
  uuid(request.commandId, 'commandId');
  uuid(request.idempotencyKey, 'idempotencyKey');
  id(request.deviceId, 'deviceId');
  id(request.targetDeviceId, 'targetDeviceId');
  uuid(request.leaseId, 'leaseId');
  digest(request.effectDigest, 'effectDigest');
  const descriptor = POCKET_RELAY_HOST_ALLOWLIST[request.action];
  if (!descriptor) fail('HOST_ACTION_NOT_ALLOWED', 'action is not enabled by the Windows host contract');
  if (request.scope !== descriptor.scope) fail('HOST_SCOPE_NOT_ALLOWED', 'scope does not match action');
  const payload = validatePayload(request.action, request.payload);
  return Object.freeze({
    ...request,
    payload: Object.freeze(payload),
    descriptor,
  });
}

export function createPocketRelayHostEffectRequest({ command, leaseId, effectId = randomUUID() }) {
  if (!command || typeof command !== 'object') fail('HOST_CONTRACT_INVALID', 'verified command is required');
  const validated = validatePocketRelayHostEffectRequest({
    version: POCKET_RELAY_HOST_CONTRACT_VERSION,
    effectId,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    deviceId: command.deviceId,
    targetDeviceId: command.target?.deviceId,
    action: command.action,
    scope: command.scope,
    effectDigest: sha256Hex(stableStringify(command)),
    leaseId,
    payload: command.payload,
  });
  const { descriptor: _descriptor, ...request } = validated;
  return Object.freeze(request);
}

export class MockPocketRelayHostExecutor {
  constructor({ targetDeviceId = 'birdie-windows-mock', clock = () => new Date() } = {}) {
    this.targetDeviceId = id(targetDeviceId, 'targetDeviceId');
    this.clock = clock;
    this.effects = [];
  }

  describe() {
    return Object.freeze({
      version: POCKET_RELAY_HOST_CONTRACT_VERSION,
      targetDeviceId: this.targetDeviceId,
      productionEffectsEnabled: false,
      enabledActions: Object.freeze(Object.keys(POCKET_RELAY_HOST_ALLOWLIST)),
    });
  }

  async execute(request, effectLease) {
    const validated = validatePocketRelayHostEffectRequest(request);
    if (validated.targetDeviceId !== this.targetDeviceId) fail('HOST_TARGET_NOT_PAIRED', 'effect target does not match this host');
    if (!effectLease || typeof effectLease.assertActive !== 'function') fail('HOST_EFFECT_LEASE_REQUIRED', 'an active effect lease is required');
    effectLease.assertActive();
    this.effects.push({ effectId: validated.effectId, action: validated.action });
    const now = this.clock();
    return {
      version: POCKET_RELAY_HOST_CONTRACT_VERSION,
      effectId: validated.effectId,
      action: validated.action,
      state: PocketRelayHostState.COMPLETED,
      committedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      resultDigest: sha256Hex(stableStringify({ simulated: true, action: validated.action })),
      productionEffect: false,
    };
  }
}
