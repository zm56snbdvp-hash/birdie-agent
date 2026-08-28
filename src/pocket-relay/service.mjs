import { randomUUID } from "node:crypto";
import {
  PocketRelayCommandState,
  PocketRelayProtocolError,
  commandEffectDigest,
  sha256Hex,
  stableStringify
} from "./contract.mjs";
import { PocketRelayStateMachine } from "./state-machine.mjs";

const MAX_BRIDGE_RESULT_BYTES = 8 * 1024 * 1024;
const SAFE_BRIDGE_MESSAGES = Object.freeze({
  PRODUCTION_BRIDGE_NOT_CONFIGURED: "A production Pocket Relay executor is not configured.",
  HOST_EXPORT_NOT_APPROVED: "The requested host export is not approved.",
  WORKFLOW_NOT_REGISTERED: "The requested workflow is not registered.",
  WORKFLOW_NOT_RUNNING: "The requested workflow run is not available.",
  WORKFLOW_STATE_CONFLICT: "The workflow state does not allow this action.",
  WORKFLOW_RUN_CONFLICT: "The workflow command targets a stale run.",
  WORKFLOW_REVISION_CONFLICT: "The workflow command targets a stale revision.",
  WORKFLOW_INPUT_CONFLICT: "The workflow input cannot change while resuming a run.",
  WORKFLOW_RUN_TERMINAL: "A terminal workflow run cannot be reused.",
  WORKFLOW_TERMINAL_RESULT_CONFLICT: "A terminal workflow result is immutable.",
  BRIDGE_ACTION_NOT_SUPPORTED: "The host adapter does not support this allowlisted action.",
  DEVICE_REVOKED: "The iPhone authorization was revoked before the host effect committed.",
  RELAY_KILL_SWITCH_ACTIVE: "Pocket Relay was disabled before the host effect committed.",
  COMMAND_EFFECT_LEASE_EXPIRED: "The command expired before the host effect committed.",
  COMMAND_EFFECT_LEASE_REVOKED: "The command authorization was revoked before the host effect committed.",
  IPHONE_APPROVAL_EXPIRED: "The iPhone approval expired before the host effect committed."
});

function iso(clock) {
  const value = clock();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function safeError(error) {
  const candidateCode = String(error?.code || "BRIDGE_EXECUTION_FAILED");
  const code = Object.hasOwn(SAFE_BRIDGE_MESSAGES, candidateCode)
    ? candidateCode
    : "BRIDGE_EXECUTION_FAILED";
  const candidateStatus = Number.isInteger(error?.status) ? error.status : 500;
  const status = code === "BRIDGE_EXECUTION_FAILED"
    ? 500
    : (candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500);
  return {
    code,
    message: SAFE_BRIDGE_MESSAGES[code] ?? "Pocket Relay host execution failed without exposing host details.",
    status
  };
}

function jsonSafeBridgeResult(value) {
  function inspect(item, path) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(`${path} contains a non-finite number`);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
      return;
    }
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) {
      throw new TypeError(`${path} must contain only plain JSON values`);
    }
    for (const [key, entry] of Object.entries(item)) inspect(entry, `${path}.${key}`);
  }

  inspect(value, "bridgeResult");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("bridgeResult must be a JSON value");
  if (Buffer.byteLength(serialized, "utf8") > MAX_BRIDGE_RESULT_BYTES) {
    throw new TypeError("bridgeResult exceeds the Pocket Relay result limit");
  }
  return JSON.parse(serialized);
}

export class PocketRelayService {
  constructor({ security, bridge, clock = () => new Date() }) {
    if (!security) throw new TypeError("security is required");
    if (typeof security.createEffectLease !== "function") {
      throw new TypeError("security.createEffectLease is required");
    }
    if (!bridge || typeof bridge.execute !== "function") throw new TypeError("bridge.execute is required");
    this.security = security;
    this.bridge = bridge;
    this.clock = clock;
    this.idempotency = new Map();
    this.receipts = new Map();
  }

  async submit(verified) {
    const { command } = verified;
    const idempotencyKey = `${command.deviceId}:${command.idempotencyKey}`;
    const effectDigest = commandEffectDigest(command);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.effectDigest !== effectDigest) {
        throw new PocketRelayProtocolError(
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey was already used for a different effect",
          409
        );
      }
      if (existing.terminalError) {
        throw new PocketRelayProtocolError(
          "IDEMPOTENCY_EFFECT_STATUS_UNKNOWN",
          "the original effect could not be finalized; automatic re-execution is blocked",
          500,
          existing.terminalError
        );
      }
      let priorResponse;
      try {
        priorResponse = existing.response ?? await existing.promise;
      } catch {
        throw new PocketRelayProtocolError(
          "IDEMPOTENCY_EFFECT_STATUS_UNKNOWN",
          "the original effect could not be finalized; automatic re-execution is blocked",
          500,
          existing.terminalError ?? { code: "FINALIZATION_FAILED", status: 500 }
        );
      }
      return {
        ...structuredClone(priorResponse),
        idempotentReplay: true,
        nonceReplay: verified.exactReplay === true
      };
    }

    // A production host must persist the equivalent reservation atomically
    // before any Windows or BirdieOS effect begins.
    const reservation = {
      effectDigest,
      response: null,
      promise: null,
      terminalError: null
    };
    this.idempotency.set(idempotencyKey, reservation);
    // Defer adapter entry until after the reservation is visible, which also
    // closes re-entrant duplicate delivery from synchronous adapter callbacks.
    reservation.promise = Promise.resolve()
      .then(() => this.#executeFirst(verified))
      .then((response) => {
        reservation.response = structuredClone(response);
        reservation.promise = null;
        return response;
      })
      .catch((error) => {
        // Never delete a reservation after execution started. Unknown effect
        // status blocks automatic retry instead of risking a duplicate effect.
        reservation.terminalError = safeError(error);
        reservation.promise = null;
        throw new PocketRelayProtocolError(
          "IDEMPOTENCY_EFFECT_STATUS_UNKNOWN",
          "effect finalization failed; automatic retry is blocked",
          500,
          reservation.terminalError
        );
      });
    return reservation.promise;
  }

  receiptForCommand(deviceId, commandId) {
    const entry = this.receipts.get(`${deviceId}:${commandId}`);
    return entry ? structuredClone(entry) : null;
  }

  async #executeFirst(verified) {
    const { command, descriptor } = verified;
    const machine = new PocketRelayStateMachine({ clock: this.clock });
    const acceptedAt = iso(this.clock);
    machine.transition(PocketRelayCommandState.RUNNING, "host_accepted");
    let result = null;
    let executionError = null;
    let effectLease = null;
    try {
      effectLease = this.security.createEffectLease(verified);
      effectLease.assertActive();
      result = jsonSafeBridgeResult(await this.bridge.execute(command, effectLease));
      machine.transition(PocketRelayCommandState.COMPLETED, "bridge_completed");
    } catch (error) {
      executionError = safeError(error);
      machine.transition(PocketRelayCommandState.FAILED, executionError.code);
      result = null;
    } finally {
      effectLease?.close();
    }

    const lifecycle = machine.snapshot();
    const completedAt = iso(this.clock);
    const receipt = {
      version: "pocket-relay.audit-receipt.v1",
      receiptId: randomUUID(),
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      deviceId: command.deviceId,
      targetDeviceId: command.target.deviceId,
      action: command.action,
      scope: command.scope,
      risk: descriptor.risk,
      commandBytesDigest: verified.commandBytesDigest ?? sha256Hex(stableStringify(command)),
      commandEffectDigest: commandEffectDigest(command),
      approvalDigest: command.approval ? sha256Hex(stableStringify(command.approval)) : null,
      payloadDigest: sha256Hex(stableStringify(command.payload)),
      resultDigest: result === null ? null : sha256Hex(stableStringify(result)),
      state: lifecycle.state,
      transitions: lifecycle.history,
      expectedEffect: descriptor.expectedEffect,
      acceptedAt,
      completedAt,
      errorCode: executionError?.code ?? null
    };
    const signedReceipt = this.security.signReceipt(receipt);
    const response = {
      success: executionError === null,
      idempotentReplay: false,
      nonceReplay: false,
      state: lifecycle.state,
      result,
      error: executionError,
      signedReceipt
    };
    this.receipts.set(`${command.deviceId}:${command.commandId}`, { receipt, signedReceipt });
    return response;
  }
}
