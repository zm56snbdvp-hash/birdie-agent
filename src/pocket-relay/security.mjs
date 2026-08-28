import { randomBytes, randomUUID } from "node:crypto";
import {
  MAX_CLOCK_SKEW_MS,
  MAX_COMMAND_TTL_MS,
  POCKET_RELAY_ALLOWLIST,
  PocketRelayProtocolError,
  commandEffectDigest,
  sha256Hex,
  stableStringify,
  validatePocketRelayCommand
} from "./contract.mjs";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateEd25519Identity,
  hmacSha256,
  publicKeyFromRawEd25519,
  safeEqual,
  sha256Fingerprint,
  signEd25519,
  verifyEd25519
} from "./crypto.mjs";

export const POCKET_RELAY_TOKEN_PROOF_VERSION = "pocket-relay.token-proof.v1";
export const DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60_000;
export const MAX_SIGNED_COMMAND_BYTES = 8 * 1024 * 1024;

function fail(code, message, status = 400, details) {
  throw new PocketRelayProtocolError(code, message, status, details);
}

function exactKeys(value, allowed, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("REQUEST_INVALID", `${field} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("REQUEST_FIELD_NOT_ALLOWED", `${field}.${key} is not allowed`);
  }
}

function cleanString(value, field, min, max, pattern) {
  if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) {
    fail("REQUEST_INVALID", `${field} has an invalid length or whitespace`);
  }
  if (pattern && !pattern.test(value)) fail("REQUEST_INVALID", `${field} has an invalid format`);
  return value;
}

function parseUtc(value, field) {
  cleanString(value, field, 20, 32);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z")) fail("REQUEST_INVALID", `${field} must be RFC3339 UTC`);
  return parsed;
}

function bearerToken(authorization) {
  const header = String(authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function createTokenProofSigningInput({ deviceId, nonce, issuedAt, expiresAt }) {
  return Buffer.from([
    POCKET_RELAY_TOKEN_PROOF_VERSION,
    deviceId,
    nonce,
    issuedAt,
    expiresAt
  ].join("\n"), "utf8");
}

export class PocketRelaySecurity {
  constructor({
    pairingCode,
    targetDevice = {
      deviceId: "birdie-windows-mock",
      deviceName: "Birdie Windows Mock",
      platform: "windows"
    },
    accessTokenTtlMs = DEFAULT_ACCESS_TOKEN_TTL_MS,
    clock = () => Date.now(),
    killSwitch = false,
    tokenSecret = randomBytes(32),
    receiptIdentity = generateEd25519Identity()
  } = {}) {
    this.pairingCode = cleanString(pairingCode, "pairingCode", 8, 128);
    exactKeys(targetDevice, ["deviceId", "deviceName", "platform"], "targetDevice");
    this.targetDevice = Object.freeze({ ...targetDevice });
    if (this.targetDevice.platform !== "windows") fail("TARGET_INVALID", "Pocket Relay host target must be windows");
    if (!Number.isInteger(accessTokenTtlMs) || accessTokenTtlMs < 30_000 || accessTokenTtlMs > 15 * 60_000) {
      fail("TOKEN_TTL_INVALID", "access token TTL must be between 30 seconds and 15 minutes");
    }
    this.accessTokenTtlMs = accessTokenTtlMs;
    this.clock = clock;
    this.killSwitch = killSwitch === true;
    this.tokenSecret = Buffer.from(tokenSecret);
    this.receiptIdentity = receiptIdentity;
    this.devices = new Map();
    this.commandNonces = new Map();
    this.commandIds = new Map();
    this.tokenNonces = new Map();
    this.effectLeases = new Map();
  }

  setKillSwitch(enabled) {
    this.killSwitch = enabled === true;
    if (this.killSwitch) {
      this.#abortEffectLeases(
        () => true,
        new PocketRelayProtocolError(
          "RELAY_KILL_SWITCH_ACTIVE",
          "Pocket Relay is disabled by the host kill switch",
          503
        )
      );
    }
  }

  pair(request) {
    this.#requireEnabled();
    exactKeys(request, ["pairingCode", "deviceName", "platform", "publicKey"], "pairRequest");
    if (!safeEqual(request.pairingCode, this.pairingCode)) {
      fail("PAIRING_DENIED", "pairing code was rejected", 401);
    }
    const deviceName = cleanString(request.deviceName, "deviceName", 1, 80);
    if (request.platform !== "ios") fail("DEVICE_PLATFORM_DENIED", "Pocket Relay v1 pairs only iOS remotes", 403);
    const publicKeyRaw = base64UrlDecode(request.publicKey, "publicKey");
    const publicKey = publicKeyFromRawEd25519(publicKeyRaw);
    const fingerprint = sha256Fingerprint(publicKeyRaw);
    const revoked = [...this.devices.values()].find((device) => device.fingerprint === fingerprint && device.revokedAt);
    if (revoked) fail("DEVICE_REVOKED", "this device key was remotely revoked and cannot be paired again", 403);
    const existing = [...this.devices.values()].find((device) => device.fingerprint === fingerprint && !device.revokedAt);
    const device = existing ?? {
      deviceId: `iphone-${randomUUID()}`,
      deviceName,
      platform: "ios",
      publicKey,
      publicKeyRaw,
      fingerprint,
      pairedAt: new Date(this.clock()).toISOString(),
      revokedAt: null
    };
    device.deviceName = deviceName;
    this.devices.set(device.deviceId, device);
    const token = this.#issueAccessToken(device);
    return {
      version: "pocket-relay.pairing.v1",
      deviceId: device.deviceId,
      targetDevice: this.targetDevice,
      accessToken: token.value,
      accessTokenExpiresAt: token.expiresAt,
      receiptPublicKey: base64UrlEncode(this.receiptIdentity.publicKeyRaw),
      serverTime: new Date(this.clock()).toISOString()
    };
  }

  refreshToken(request) {
    this.#requireEnabled();
    exactKeys(request, ["deviceId", "nonce", "issuedAt", "expiresAt", "signature"], "tokenProof");
    const device = this.#activeDevice(request.deviceId);
    cleanString(request.nonce, "nonce", 22, 128, /^[A-Za-z0-9_-]+$/u);
    const issuedAt = parseUtc(request.issuedAt, "issuedAt");
    const expiresAt = parseUtc(request.expiresAt, "expiresAt");
    const nowMs = this.clock();
    if (issuedAt > nowMs + MAX_CLOCK_SKEW_MS || expiresAt < nowMs - MAX_CLOCK_SKEW_MS) {
      fail("TOKEN_PROOF_EXPIRED", "token proof is outside its validity window", 401);
    }
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_COMMAND_TTL_MS) {
      fail("TOKEN_PROOF_TTL_INVALID", "token proof TTL is invalid", 401);
    }
    const signature = base64UrlDecode(request.signature, "signature");
    const input = createTokenProofSigningInput(request);
    if (!verifyEd25519(input, signature, device.publicKey)) {
      fail("TOKEN_PROOF_SIGNATURE_INVALID", "token proof signature is invalid", 401);
    }
    const nonceKey = `${device.deviceId}:${request.nonce}`;
    this.#pruneNonces(this.tokenNonces, nowMs);
    if (this.tokenNonces.has(nonceKey)) fail("TOKEN_PROOF_REPLAY", "token proof nonce was already used", 409);
    this.tokenNonces.set(nonceKey, expiresAt + MAX_CLOCK_SKEW_MS);
    const token = this.#issueAccessToken(device);
    return {
      accessToken: token.value,
      accessTokenExpiresAt: token.expiresAt,
      serverTime: new Date(nowMs).toISOString()
    };
  }

  authenticate(authorization) {
    this.#requireEnabled();
    const token = bearerToken(authorization);
    if (!token) fail("ACCESS_TOKEN_REQUIRED", "short-lived bearer token is required", 401);
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "pr1") fail("ACCESS_TOKEN_INVALID", "access token format is invalid", 401);
    const payloadEncoded = parts[1];
    const expectedSignature = base64UrlEncode(hmacSha256(`pr1.${payloadEncoded}`, this.tokenSecret));
    if (!safeEqual(parts[2], expectedSignature)) fail("ACCESS_TOKEN_INVALID", "access token signature is invalid", 401);
    let claims;
    try {
      claims = JSON.parse(base64UrlDecode(payloadEncoded, "tokenPayload").toString("utf8"));
    } catch (error) {
      if (error instanceof PocketRelayProtocolError) throw error;
      fail("ACCESS_TOKEN_INVALID", "access token payload is invalid", 401);
    }
    exactKeys(claims, ["iss", "aud", "sub", "cnf", "iat", "exp", "jti"], "accessToken");
    if (claims.iss !== "birdie-pocket-relay-host" || claims.aud !== "birdie-pocket-relay-v1") {
      fail("ACCESS_TOKEN_INVALID", "access token issuer or audience is invalid", 401);
    }
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= this.clock()) {
      fail("ACCESS_TOKEN_EXPIRED", "access token has expired", 401);
    }
    if (claims.iat > this.clock() + MAX_CLOCK_SKEW_MS) fail("ACCESS_TOKEN_INVALID", "access token is not yet valid", 401);
    const device = this.#activeDevice(claims.sub);
    if (claims.cnf !== device.fingerprint) fail("ACCESS_TOKEN_DEVICE_MISMATCH", "access token is not bound to this device", 401);
    return { claims, device };
  }

  verifySignedCommand({ authorization, body }) {
    const { device, claims } = this.authenticate(authorization);
    exactKeys(body, ["signedCommand", "signature"], "signedRequest");
    const commandBytes = base64UrlDecode(body.signedCommand, "signedCommand");
    if (commandBytes.length > MAX_SIGNED_COMMAND_BYTES) fail("COMMAND_TOO_LARGE", "signed command exceeds the mock-host limit", 413);
    const signature = base64UrlDecode(body.signature, "signature");
    if (!verifyEd25519(commandBytes, signature, device.publicKey)) {
      fail("COMMAND_SIGNATURE_INVALID", "command signature is invalid", 401);
    }
    let command;
    try {
      command = JSON.parse(commandBytes.toString("utf8"));
    } catch {
      fail("COMMAND_JSON_INVALID", "signed command is not valid JSON");
    }
    const validated = validatePocketRelayCommand(command, {
      now: this.clock,
      expectedTargetDeviceId: this.targetDevice.deviceId,
      expectedTargetDevice: this.targetDevice
    });
    if (command.deviceId !== device.deviceId || claims.sub !== command.deviceId) {
      fail("COMMAND_DEVICE_MISMATCH", "signed command is not bound to the authenticated iPhone", 403);
    }

    const commandBytesDigest = sha256Hex(commandBytes);
    const nonceKey = `${device.deviceId}:${command.nonce}`;
    this.#pruneNonces(this.commandNonces, this.clock());
    const previousDigest = this.commandNonces.get(nonceKey)?.digest;
    if (previousDigest && previousDigest !== commandBytesDigest) {
      fail("COMMAND_NONCE_REPLAY", "nonce was already used for another command", 409);
    }
    const exactReplay = previousDigest === commandBytesDigest;
    if (!exactReplay) {
      this.commandNonces.set(nonceKey, {
        digest: commandBytesDigest,
        expiresAt: Date.parse(command.expiresAt) + MAX_CLOCK_SKEW_MS
      });
    }
    const commandIdKey = `${device.deviceId}:${command.commandId}`;
    const effectDigest = commandEffectDigest(command);
    const previousEffectDigest = this.commandIds.get(commandIdKey);
    if (previousEffectDigest && previousEffectDigest !== effectDigest) {
      fail("COMMAND_ID_CONFLICT", "commandId was already bound to a different effect", 409);
    }
    if (!previousEffectDigest) this.commandIds.set(commandIdKey, effectDigest);
    return { ...validated, device, commandBytesDigest, exactReplay };
  }

  signReceipt(receipt) {
    const receiptBytes = Buffer.from(stableStringify(receipt), "utf8");
    return {
      receipt: base64UrlEncode(receiptBytes),
      signature: base64UrlEncode(signEd25519(receiptBytes, this.receiptIdentity.privateKey)),
      algorithm: "Ed25519"
    };
  }

  createEffectLease(verified) {
    const command = verified?.command;
    const device = verified?.device;
    if (!command || !device || command.deviceId !== device.deviceId) {
      fail("COMMAND_DEVICE_MISMATCH", "effect lease requires the verified command device", 403);
    }
    const expiresAt = Date.parse(command.expiresAt);
    if (!Number.isFinite(expiresAt)) fail("COMMAND_EFFECT_LEASE_INVALID", "effect lease expiry is invalid", 401);
    const approvalExpiresAt = verified?.descriptor?.risk === "high"
      ? Date.parse(command.approval.approvedAt) + MAX_COMMAND_TTL_MS + MAX_CLOCK_SKEW_MS
      : Number.POSITIVE_INFINITY;

    const controller = new AbortController();
    const leaseId = randomUUID();
    const entry = { controller, deviceId: command.deviceId, expiresAt, timer: null };
    const assertActive = () => {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new PocketRelayProtocolError("COMMAND_EFFECT_LEASE_REVOKED", "effect lease was revoked", 403);
      }
      this.#requireEnabled();
      this.#activeDevice(command.deviceId);
      if (this.clock() >= approvalExpiresAt) {
        throw new PocketRelayProtocolError(
          "IPHONE_APPROVAL_EXPIRED",
          "iPhone approval expired before the host effect committed",
          403
        );
      }
      if (this.clock() >= expiresAt) {
        throw new PocketRelayProtocolError(
          "COMMAND_EFFECT_LEASE_EXPIRED",
          "command expired before the host effect committed",
          409
        );
      }
    };
    assertActive();
    const leaseExpiresAt = Math.min(expiresAt, approvalExpiresAt);
    const delay = Math.max(0, Math.min(leaseExpiresAt - this.clock(), 2_147_483_647));
    entry.timer = setTimeout(() => {
      const approvalExpiredFirst = approvalExpiresAt <= expiresAt;
      controller.abort(approvalExpiredFirst
        ? new PocketRelayProtocolError(
          "IPHONE_APPROVAL_EXPIRED",
          "iPhone approval expired before the host effect committed",
          403
        )
        : new PocketRelayProtocolError(
          "COMMAND_EFFECT_LEASE_EXPIRED",
          "command expired before the host effect committed",
          409
        ));
    }, delay);
    entry.timer.unref?.();
    this.effectLeases.set(leaseId, entry);

    let closed = false;
    return Object.freeze({
      signal: controller.signal,
      assertActive,
      close: () => {
        if (closed) return;
        closed = true;
        clearTimeout(entry.timer);
        if (this.effectLeases.get(leaseId) === entry) this.effectLeases.delete(leaseId);
      }
    });
  }

  revokeDevice(deviceId, reason = "remote_revoke") {
    const device = this.devices.get(deviceId);
    if (!device || device.revokedAt) return false;
    device.revokedAt = new Date(this.clock()).toISOString();
    device.revocationReason = String(reason).slice(0, 80);
    this.#abortEffectLeases(
      (entry) => entry.deviceId === device.deviceId,
      new PocketRelayProtocolError("DEVICE_REVOKED", "device access was remotely revoked", 403)
    );
    return true;
  }

  deviceSnapshot(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      pairedAt: device.pairedAt,
      revokedAt: device.revokedAt
    };
  }

  #activeDevice(deviceId) {
    const device = this.devices.get(String(deviceId || ""));
    if (!device) fail("DEVICE_NOT_PAIRED", "device is not paired", 401);
    if (device.revokedAt) fail("DEVICE_REVOKED", "device access was remotely revoked", 403);
    return device;
  }

  #issueAccessToken(device) {
    const nowMs = this.clock();
    const expiresAtMs = nowMs + this.accessTokenTtlMs;
    const claims = {
      iss: "birdie-pocket-relay-host",
      aud: "birdie-pocket-relay-v1",
      sub: device.deviceId,
      cnf: device.fingerprint,
      iat: nowMs,
      exp: expiresAtMs,
      jti: randomUUID()
    };
    const payload = base64UrlEncode(Buffer.from(stableStringify(claims), "utf8"));
    const unsigned = `pr1.${payload}`;
    return {
      value: `${unsigned}.${base64UrlEncode(hmacSha256(unsigned, this.tokenSecret))}`,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  #pruneNonces(store, nowMs) {
    for (const [key, value] of store) {
      const expiresAt = typeof value === "number" ? value : value.expiresAt;
      if (expiresAt < nowMs) store.delete(key);
    }
  }

  #abortEffectLeases(predicate, reason) {
    for (const entry of this.effectLeases.values()) {
      if (predicate(entry) && !entry.controller.signal.aborted) entry.controller.abort(reason);
    }
  }

  #requireEnabled() {
    if (this.killSwitch) fail("RELAY_KILL_SWITCH_ACTIVE", "Pocket Relay is disabled by the host kill switch", 503);
  }
}

export function decodeSignedReceipt(signedReceipt, publicKeyRaw) {
  exactKeys(signedReceipt, ["receipt", "signature", "algorithm"], "signedReceipt");
  if (signedReceipt.algorithm !== "Ed25519") fail("RECEIPT_ALGORITHM_INVALID", "receipt algorithm must be Ed25519", 401);
  const receiptBytes = base64UrlDecode(signedReceipt.receipt, "receipt");
  const signature = base64UrlDecode(signedReceipt.signature, "signature");
  if (!verifyEd25519(receiptBytes, signature, publicKeyFromRawEd25519(publicKeyRaw))) {
    fail("RECEIPT_SIGNATURE_INVALID", "receipt signature is invalid", 401);
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    fail("RECEIPT_JSON_INVALID", "signed receipt is not valid JSON", 401);
  }
  return receipt;
}

export function validateSignedReceipt(signedReceipt, publicKeyRaw, { command, request, response }) {
  if (!command || !request || !response) {
    fail("RECEIPT_EXPECTATION_REQUIRED", "receipt verification requires the exact command, request and response");
  }
  const receipt = decodeSignedReceipt(signedReceipt, publicKeyRaw);
  const fields = [
    "version",
    "receiptId",
    "commandId",
    "idempotencyKey",
    "deviceId",
    "targetDeviceId",
    "action",
    "scope",
    "risk",
    "commandBytesDigest",
    "commandEffectDigest",
    "approvalDigest",
    "payloadDigest",
    "resultDigest",
    "state",
    "transitions",
    "expectedEffect",
    "acceptedAt",
    "completedAt",
    "errorCode"
  ];
  exactKeys(receipt, fields, "auditReceipt");
  const descriptor = POCKET_RELAY_ALLOWLIST[command.action];
  const commandBytes = base64UrlDecode(request.signedCommand, "signedCommand");
  const expected = {
    version: "pocket-relay.audit-receipt.v1",
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    deviceId: command.deviceId,
    targetDeviceId: command.target.deviceId,
    action: command.action,
    scope: command.scope,
    risk: descriptor?.risk,
    commandEffectDigest: commandEffectDigest(command),
    payloadDigest: sha256Hex(stableStringify(command.payload)),
    resultDigest: response.result === null ? null : sha256Hex(stableStringify(response.result)),
    state: response.state,
    expectedEffect: descriptor?.expectedEffect,
    errorCode: response.error?.code ?? null
  };
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      fail("RECEIPT_BINDING_INVALID", `receipt ${field} is not bound to the command response`, 409);
    }
  }
  if (response.idempotentReplay === true) {
    if (!/^[a-f0-9]{64}$/u.test(receipt.commandBytesDigest)) {
      fail("RECEIPT_SCHEMA_INVALID", "replayed receipt commandBytesDigest is invalid", 409);
    }
    if (descriptor?.risk === "high" && !/^[a-f0-9]{64}$/u.test(receipt.approvalDigest || "")) {
      fail("RECEIPT_BINDING_INVALID", "high-risk replay lacks its original approval digest", 409);
    }
    if (descriptor?.risk !== "high" && receipt.approvalDigest !== null) {
      fail("RECEIPT_BINDING_INVALID", "low-risk replay unexpectedly contains approval", 409);
    }
  } else {
    if (receipt.commandBytesDigest !== sha256Hex(commandBytes)) {
      fail("RECEIPT_BINDING_INVALID", "receipt commandBytesDigest is not bound to the request", 409);
    }
    const approvalDigest = command.approval ? sha256Hex(stableStringify(command.approval)) : null;
    if (receipt.approvalDigest !== approvalDigest) {
      fail("RECEIPT_BINDING_INVALID", "receipt approvalDigest is not bound to the request", 409);
    }
  }
  if (typeof receipt.receiptId !== "string" || receipt.receiptId.length !== 36) {
    fail("RECEIPT_SCHEMA_INVALID", "receiptId is invalid", 409);
  }
  if (!Array.isArray(receipt.transitions) || receipt.transitions.length < 2) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt transitions are incomplete", 409);
  }
  if (receipt.transitions[0]?.state !== "queued" || receipt.transitions.at(-1)?.state !== receipt.state) {
    fail("RECEIPT_BINDING_INVALID", "receipt transition history does not reach its signed state", 409);
  }
  const acceptedAt = Date.parse(receipt.acceptedAt);
  const completedAt = Date.parse(receipt.completedAt);
  if (!Number.isFinite(acceptedAt) || !Number.isFinite(completedAt) || completedAt < acceptedAt) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt timestamps are invalid", 409);
  }
  const successExpected = receipt.state === "completed" && receipt.errorCode === null;
  if (response.success !== successExpected) {
    fail("RECEIPT_BINDING_INVALID", "receipt state does not match response success", 409);
  }
  return receipt;
}

export function verifySignedReceipt(signedReceipt, publicKeyRaw, expected) {
  try {
    validateSignedReceipt(signedReceipt, publicKeyRaw, expected);
    return true;
  } catch {
    return false;
  }
}
