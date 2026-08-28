import { randomBytes, randomUUID } from "node:crypto";
import {
  POCKET_RELAY_ALLOWLIST,
  POCKET_RELAY_API_PREFIX,
  POCKET_RELAY_COMMAND_VERSION,
  describePocketRelayCommand,
  stableStringify
} from "./contract.mjs";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateEd25519Identity,
  signEd25519
} from "./crypto.mjs";
import {
  createTokenProofSigningInput,
  validateSignedReceipt
} from "./security.mjs";

export class PocketRelayClientError extends Error {
  constructor(response, status) {
    super(response?.error?.message || `Pocket Relay request failed with HTTP ${status}`);
    this.name = "PocketRelayClientError";
    this.code = response?.error?.code || "POCKET_RELAY_REQUEST_FAILED";
    this.status = status;
    this.response = response;
  }
}

async function jsonRequest(url, { method = "POST", token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { success: false, error: { code: "RESPONSE_JSON_INVALID", message: "host returned invalid JSON" } };
  }
  if (!response.ok) throw new PocketRelayClientError(payload, response.status);
  return payload;
}

export class PocketRelayReferenceClient {
  constructor({
    baseURL,
    pairingCode,
    deviceName = "Pocket Relay Reference iPhone",
    identity = generateEd25519Identity(),
    clock = () => Date.now()
  }) {
    this.baseURL = String(baseURL).replace(/\/$/u, "");
    this.pairingCode = pairingCode;
    this.deviceName = deviceName;
    this.identity = identity;
    this.clock = clock;
    this.session = null;
  }

  async pair() {
    const response = await jsonRequest(`${this.baseURL}${POCKET_RELAY_API_PREFIX}/pair`, {
      body: {
        pairingCode: this.pairingCode,
        deviceName: this.deviceName,
        platform: "ios",
        publicKey: base64UrlEncode(this.identity.publicKeyRaw)
      }
    });
    this.session = {
      deviceId: response.deviceId,
      targetDevice: response.targetDevice,
      accessToken: response.accessToken,
      accessTokenExpiresAt: response.accessTokenExpiresAt,
      receiptPublicKey: base64UrlDecode(response.receiptPublicKey, "receiptPublicKey")
    };
    return { ...this.session, receiptPublicKey: Buffer.from(this.session.receiptPublicKey) };
  }

  async refreshToken(overrides = {}) {
    this.#requireSession();
    const issuedAtMs = overrides.issuedAtMs ?? this.clock();
    const proof = {
      deviceId: this.session.deviceId,
      nonce: overrides.nonce ?? base64UrlEncode(randomBytes(24)),
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(overrides.expiresAtMs ?? issuedAtMs + 60_000).toISOString()
    };
    proof.signature = base64UrlEncode(signEd25519(createTokenProofSigningInput(proof), this.identity.privateKey));
    const response = await jsonRequest(`${this.baseURL}${POCKET_RELAY_API_PREFIX}/token`, { body: proof });
    this.session.accessToken = response.accessToken;
    this.session.accessTokenExpiresAt = response.accessTokenExpiresAt;
    return { ...response, proof };
  }

  createSignedCommand({
    action,
    payload,
    approveHighRisk = false,
    commandId = randomUUID(),
    idempotencyKey = randomUUID(),
    nonce = base64UrlEncode(randomBytes(24)),
    issuedAtMs = this.clock(),
    expiresAtMs = issuedAtMs + 60_000,
    target = this.session?.targetDevice,
    deviceId = this.session?.deviceId,
    mutateCommand
  }) {
    this.#requireSession();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const command = {
      version: POCKET_RELAY_COMMAND_VERSION,
      commandId,
      idempotencyKey,
      deviceId,
      nonce,
      issuedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      action,
      target,
      scope: POCKET_RELAY_ALLOWLIST[action]?.scope,
      payload
    };
    command.disclosure = describePocketRelayCommand(command);
    if (approveHighRisk) {
      command.approval = {
        method: "explicit_iphone_confirmation",
        commandId,
        approvedAt: issuedAt
      };
    }
    if (mutateCommand) mutateCommand(command);
    const commandBytes = Buffer.from(stableStringify(command), "utf8");
    return {
      command,
      request: {
        signedCommand: base64UrlEncode(commandBytes),
        signature: base64UrlEncode(signEd25519(commandBytes, this.identity.privateKey))
      }
    };
  }

  async submit(input) {
    const signed = input?.request ? input : this.createSignedCommand(input);
    const response = await this.sendSignedRequest(signed.request);
    return { ...response, command: signed.command, request: signed.request };
  }

  async sendSignedRequest(request, { token = this.session?.accessToken } = {}) {
    this.#requireSession();
    return jsonRequest(`${this.baseURL}${POCKET_RELAY_API_PREFIX}/commands`, {
      token,
      body: request
    });
  }

  verifyReceipt(submission) {
    this.#requireSession();
    try {
      validateSignedReceipt(submission.signedReceipt, this.session.receiptPublicKey, {
        command: submission.command,
        request: submission.request,
        response: submission
      });
      return true;
    } catch {
      return false;
    }
  }

  #requireSession() {
    if (!this.session) throw new Error("Pocket Relay reference client is not paired");
  }
}
