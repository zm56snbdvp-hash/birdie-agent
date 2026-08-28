import {
  POCKET_RELAY_ALLOWLIST,
  PocketRelayAction,
  PocketRelayProtocolError,
  stableStringify,
  validateActionPayload
} from "../../src/pocket-relay/contract.mjs";
import { PocketRelayBridge } from "../../src/pocket-relay/bridge.mjs";

const ENABLED_ACTIONS = Object.freeze([
  PocketRelayAction.OPEN_LINK,
  PocketRelayAction.LOCK_PC
]);

const DISABLED_ACTIONS = Object.freeze([
  PocketRelayAction.SEND_FILE_TO_PC,
  PocketRelayAction.FETCH_FILE_TO_IPHONE,
  PocketRelayAction.START_WORKFLOW,
  PocketRelayAction.PAUSE_WORKFLOW,
  PocketRelayAction.CANCEL_WORKFLOW,
  PocketRelayAction.GET_WORKFLOW_RESULT
]);

function fail(code, message, status = 409) {
  throw new PocketRelayProtocolError(code, message, status);
}

function requireLease(effectLease) {
  if (!effectLease || typeof effectLease.assertActive !== "function" || !effectLease.signal) {
    fail("COMMAND_EFFECT_LEASE_REQUIRED", "Windows adapter requires an active effect lease", 500);
  }
  effectLease.assertActive();
}

/**
 * Narrow host-side executor hooks. The adapter never accepts a command line,
 * executable path, URL scheme other than HTTPS, or caller-selected OS path.
 * Integrators must supply both hooks explicitly on a Windows host.
 */
export class WindowsPocketRelayAdapter extends PocketRelayBridge {
  constructor({
    targetDevice,
    openHttpsLink,
    lockInteractiveSession,
    enableProductionEffects = false,
    platform = process.platform
  } = {}) {
    super();
    if (!targetDevice || typeof targetDevice !== "object") {
      throw new TypeError("targetDevice is required");
    }
    if (targetDevice.platform !== "windows") {
      throw new TypeError("Windows adapter targetDevice.platform must be windows");
    }
    this.targetDevice = Object.freeze({ ...targetDevice });
    this.openHttpsLinkHook = typeof openHttpsLink === "function" ? openHttpsLink : null;
    this.lockInteractiveSessionHook = typeof lockInteractiveSession === "function"
      ? lockInteractiveSession
      : null;
    this.productionEffectsEnabled = enableProductionEffects === true
      && platform === "win32"
      && this.openHttpsLinkHook !== null
      && this.lockInteractiveSessionHook !== null;
  }

  describe() {
    return {
      kind: "windows-narrow-adapter",
      productionEffectsEnabled: this.productionEffectsEnabled,
      targetDevice: this.targetDevice,
      enabledActions: [...ENABLED_ACTIONS],
      disabledActions: [...DISABLED_ACTIONS],
      registeredWorkflows: [],
      approvedExports: []
    };
  }

  async execute(command, effectLease) {
    const validated = this.#validateCommand(command);
    requireLease(effectLease);
    if (!this.productionEffectsEnabled) {
      fail("PRODUCTION_BRIDGE_NOT_CONFIGURED", "Windows production effects are disabled", 503);
    }

    switch (validated.action) {
      case PocketRelayAction.OPEN_LINK:
        return this.#openHttpsLink(validated.payload.url, effectLease);
      case PocketRelayAction.LOCK_PC:
        return this.#lockInteractiveSession(effectLease);
      default:
        fail("BRIDGE_ACTION_NOT_SUPPORTED", "Windows adapter action is not enabled", 501);
    }
  }

  #validateCommand(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      fail("CONTRACT_INVALID", "validated command must be an object", 400);
    }
    const descriptor = POCKET_RELAY_ALLOWLIST[command.action];
    if (!descriptor) fail("ACTION_NOT_ALLOWED", "action is not in the Pocket Relay allowlist", 403);
    if (!ENABLED_ACTIONS.includes(command.action)) {
      fail("BRIDGE_ACTION_NOT_SUPPORTED", "Windows adapter action is not enabled", 501);
    }
    if (stableStringify(command.target) !== stableStringify(this.targetDevice)) {
      fail("TARGET_NOT_PAIRED", "command target does not match the Windows adapter", 403);
    }
    if (command.scope !== descriptor.scope) {
      fail("SCOPE_NOT_ALLOWED", "command scope does not match the allowlisted action", 403);
    }
    const payload = validateActionPayload(command.action, command.payload);
    return Object.freeze({ action: command.action, payload });
  }

  async #openHttpsLink(url, effectLease) {
    requireLease(effectLease);
    await this.openHttpsLinkHook(url, { signal: effectLease.signal });
    requireLease(effectLease);
    return { productionEffect: true, openedUrl: url };
  }

  async #lockInteractiveSession(effectLease) {
    requireLease(effectLease);
    await this.lockInteractiveSessionHook({ signal: effectLease.signal });
    requireLease(effectLease);
    return { productionEffect: true, locked: true };
  }
}

export function createWindowsPocketRelayAdapter(options) {
  return new WindowsPocketRelayAdapter(options);
}
