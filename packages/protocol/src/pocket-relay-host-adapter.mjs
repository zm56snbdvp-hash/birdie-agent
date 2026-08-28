import {
  POCKET_RELAY_HOST_CONTRACT_VERSION,
  PocketRelayHostAction,
  PocketRelayHostState,
  validatePocketRelayHostEffectRequest,
} from './pocket-relay-host.mjs';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireLease(effectLease) {
  if (!effectLease || typeof effectLease.assertActive !== 'function' || !effectLease.signal) {
    fail('HOST_EFFECT_LEASE_REQUIRED', 'an active effect lease is required');
  }
  effectLease.assertActive();
}

/**
 * Narrow Windows host adapter. Production effects are opt-in and require both
 * explicit hooks plus a win32 runtime. No command line, executable, path, or
 * named-pipe input is accepted by this adapter.
 */
export class PocketRelayHostAdapter {
  constructor({
    targetDeviceId,
    openHttpsLink,
    lockInteractiveSession,
    enableProductionEffects = false,
    platform = typeof process === 'object' ? process.platform : undefined,
  } = {}) {
    if (typeof targetDeviceId !== 'string' || targetDeviceId.length === 0) {
      fail('HOST_TARGET_INVALID', 'targetDeviceId is required');
    }
    this.targetDeviceId = targetDeviceId;
    this.openHttpsLinkHook = typeof openHttpsLink === 'function' ? openHttpsLink : null;
    this.lockInteractiveSessionHook = typeof lockInteractiveSession === 'function'
      ? lockInteractiveSession
      : null;
    this.productionEffectsEnabled = enableProductionEffects === true
      && platform === 'win32'
      && this.openHttpsLinkHook !== null
      && this.lockInteractiveSessionHook !== null;
    this.committed = new Map();
  }

  describe() {
    return Object.freeze({
      version: POCKET_RELAY_HOST_CONTRACT_VERSION,
      targetDeviceId: this.targetDeviceId,
      productionEffectsEnabled: this.productionEffectsEnabled,
      enabledActions: Object.freeze([
        PocketRelayHostAction.OPEN_LINK,
        PocketRelayHostAction.LOCK_PC,
      ]),
    });
  }

  async execute(request, effectLease) {
    const validated = validatePocketRelayHostEffectRequest(request);
    if (validated.targetDeviceId !== this.targetDeviceId) {
      fail('HOST_TARGET_NOT_PAIRED', 'effect target does not match this host');
    }
    requireLease(effectLease);

    const previous = this.committed.get(validated.effectId);
    if (previous) {
      if (previous.effectDigest !== validated.effectDigest) {
        fail('HOST_EFFECT_ID_REUSED', 'effectId was already committed with another digest');
      }
      return previous.receipt;
    }
    if (!this.productionEffectsEnabled) {
      fail('HOST_PRODUCTION_DISABLED', 'Windows production effects are disabled');
    }

    let result;
    if (validated.action === PocketRelayHostAction.OPEN_LINK) {
      await this.openHttpsLinkHook(validated.payload.url, { signal: effectLease.signal });
      requireLease(effectLease);
      result = { openedUrl: validated.payload.url };
    } else if (validated.action === PocketRelayHostAction.LOCK_PC) {
      await this.lockInteractiveSessionHook({ signal: effectLease.signal });
      requireLease(effectLease);
      result = { locked: true };
    } else {
      fail('HOST_ACTION_NOT_ALLOWED', 'action is not enabled by the Windows host contract');
    }

    const receipt = Object.freeze({
      version: POCKET_RELAY_HOST_CONTRACT_VERSION,
      effectId: validated.effectId,
      action: validated.action,
      state: PocketRelayHostState.COMPLETED,
      productionEffect: true,
      ...result,
    });
    this.committed.set(validated.effectId, { effectDigest: validated.effectDigest, receipt });
    return receipt;
  }
}

export function createPocketRelayHostAdapter(options) {
  return new PocketRelayHostAdapter(options);
}
