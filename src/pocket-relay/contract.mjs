import { createHash } from "node:crypto";

export const POCKET_RELAY_COMMAND_VERSION = "pocket-relay.command.v1";
export const POCKET_RELAY_API_PREFIX = "/pocket-relay/v1";
export const MAX_COMMAND_TTL_MS = 120_000;
export const MAX_CLOCK_SKEW_MS = 30_000;
export const MAX_INLINE_FILE_BYTES = 5 * 1024 * 1024;

export const PocketRelayAction = Object.freeze({
  OPEN_LINK: "link.open.v1",
  SEND_FILE_TO_PC: "file.send_to_pc.v1",
  FETCH_FILE_TO_IPHONE: "file.fetch_to_iphone.v1",
  START_WORKFLOW: "workflow.start.v1",
  PAUSE_WORKFLOW: "workflow.pause.v1",
  CANCEL_WORKFLOW: "workflow.cancel.v1",
  GET_WORKFLOW_RESULT: "workflow.result.get.v1",
  LOCK_PC: "pc.lock.v1"
});

export const PocketRelayCommandState = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

export const POCKET_RELAY_ALLOWLIST = Object.freeze({
  [PocketRelayAction.OPEN_LINK]: Object.freeze({
    scope: "https_link",
    risk: "low",
    expectedEffect: "Der ausgewählte HTTPS-Link wird im Standardbrowser des Ziel-PCs geöffnet."
  }),
  [PocketRelayAction.SEND_FILE_TO_PC]: Object.freeze({
    scope: "selected_file_upload",
    risk: "high",
    expectedEffect: "Die ausdrücklich ausgewählte iPhone-Datei wird an den freigegebenen PC-Eingang übertragen."
  }),
  [PocketRelayAction.FETCH_FILE_TO_IPHONE]: Object.freeze({
    scope: "approved_host_export",
    risk: "high",
    expectedEffect: "Die zuvor am PC freigegebene Datei wird auf das iPhone übertragen."
  }),
  [PocketRelayAction.START_WORKFLOW]: Object.freeze({
    scope: "registered_workflow",
    risk: "high",
    expectedEffect: "Der bereits registrierte Birdie-Workflow wird gestartet oder fortgesetzt."
  }),
  [PocketRelayAction.PAUSE_WORKFLOW]: Object.freeze({
    scope: "registered_workflow",
    risk: "medium",
    expectedEffect: "Der laufende Birdie-Workflow wird an einem sicheren Übergabepunkt pausiert."
  }),
  [PocketRelayAction.CANCEL_WORKFLOW]: Object.freeze({
    scope: "registered_workflow",
    risk: "high",
    expectedEffect: "Der ausgewählte Birdie-Workflow wird abgebrochen; bereits bestätigte externe Effekte werden nicht zurückgerollt."
  }),
  [PocketRelayAction.GET_WORKFLOW_RESULT]: Object.freeze({
    scope: "registered_workflow",
    risk: "low",
    expectedEffect: "Status und freigegebenes Ergebnis des ausgewählten Birdie-Workflows werden abgerufen."
  }),
  [PocketRelayAction.LOCK_PC]: Object.freeze({
    scope: "host_session_lock",
    risk: "high",
    expectedEffect: "Die interaktive Sitzung des Ziel-PCs wird gesperrt."
  })
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELD_PATTERN = /(?:^|_)(?:shell|script|commandline|argv|clipboard|filesystempath|directorypath|absolutepath)(?:$|_)/i;

export class PocketRelayProtocolError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "PocketRelayProtocolError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details) {
  throw new PocketRelayProtocolError(code, message, status, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, field) {
  if (!isPlainObject(value)) fail("CONTRACT_INVALID", `${field} must be an object`);
  return value;
}

function requireString(value, field, { min = 1, max = 512, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail("CONTRACT_INVALID", `${field} must be a string between ${min} and ${max} characters`);
  }
  if (value !== value.trim()) fail("CONTRACT_INVALID", `${field} must not contain outer whitespace`);
  if (pattern && !pattern.test(value)) fail("CONTRACT_INVALID", `${field} has an invalid format`);
  return value;
}

function requireExactKeys(value, allowed, field) {
  const keys = Object.keys(requireObject(value, field));
  for (const key of keys) {
    if (!allowed.includes(key)) fail("CONTRACT_FIELD_NOT_ALLOWED", `${field}.${key} is not allowed`);
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      fail("CONTRACT_DANGEROUS_FIELD", `${field}.${key} is forbidden`);
    }
  }
}

function requireIsoDate(value, field) {
  requireString(value, field, { min: 20, max: 32 });
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z")) {
    fail("CONTRACT_INVALID", `${field} must be an RFC3339 UTC timestamp`);
  }
  return parsed;
}

function requireOpaqueId(value, field) {
  return requireString(value, field, { min: 1, max: 128, pattern: OPAQUE_ID_PATTERN });
}

function requireFileName(value) {
  requireString(value, "payload.fileName", { min: 1, max: 255 });
  const reservedBaseName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
  if (
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    reservedBaseName.test(value)
  ) {
    fail("FILE_NAME_INVALID", "fileName must be a portable leaf name without a path, stream or reserved device name");
  }
  return value;
}

function requireSha256(value, field = "payload.sha256") {
  return requireString(value, field, { min: 64, max: 64, pattern: SHA256_PATTERN });
}

function requireInteger(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("CONTRACT_INVALID", `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function validateNoDangerousFields(value, field = "command") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoDangerousFields(item, `${field}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      fail("CONTRACT_DANGEROUS_FIELD", `${field}.${key} is forbidden`);
    }
    validateNoDangerousFields(nested, `${field}.${key}`);
  }
}

function validateOpenLink(payload) {
  requireExactKeys(payload, ["url"], "payload");
  const urlText = requireString(payload.url, "payload.url", { min: 9, max: 2048 });
  let url;
  try {
    url = new URL(urlText);
  } catch {
    fail("LINK_URL_INVALID", "payload.url must be a valid URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("LINK_SCOPE_DENIED", "only credential-free HTTPS URLs are allowed");
  }
  return { url: urlText };
}

function validateFileUpload(payload) {
  requireExactKeys(
    payload,
    ["fileName", "contentType", "sizeBytes", "sha256", "contentBase64"],
    "payload"
  );
  const fileName = requireFileName(payload.fileName);
  const contentType = requireString(payload.contentType, "payload.contentType", {
    min: 3,
    max: 128,
    pattern: /^[A-Za-z0-9!#$&^_.+-]{1,64}\/[A-Za-z0-9!#$&^_.+-]{1,64}$/u
  });
  const sizeBytes = requireInteger(payload.sizeBytes, "payload.sizeBytes", 1, MAX_INLINE_FILE_BYTES);
  const sha256 = requireSha256(payload.sha256);
  const contentBase64 = requireString(payload.contentBase64, "payload.contentBase64", {
    min: 4,
    max: Math.ceil(MAX_INLINE_FILE_BYTES / 3) * 4 + 4
  });
  let content;
  try {
    content = Buffer.from(contentBase64, "base64");
  } catch {
    fail("FILE_CONTENT_INVALID", "payload.contentBase64 is not valid base64");
  }
  if (content.length !== sizeBytes) fail("FILE_SIZE_MISMATCH", "payload.sizeBytes does not match file content");
  if (content.toString("base64").replace(/=+$/u, "") !== contentBase64.replace(/=+$/u, "")) {
    fail("FILE_CONTENT_INVALID", "payload.contentBase64 is not canonical base64");
  }
  const actualDigest = createHash("sha256").update(content).digest("hex");
  if (actualDigest !== sha256) fail("FILE_DIGEST_MISMATCH", "payload.sha256 does not match file content");
  return { fileName, contentType, sizeBytes, sha256 };
}

function validateFileFetch(payload) {
  requireExactKeys(payload, ["exportId"], "payload");
  return { exportId: requireOpaqueId(payload.exportId, "payload.exportId") };
}

function validateWorkflowMutationPayload(payload, allowInputRef = false) {
  const keys = allowInputRef
    ? ["workflowId", "runId", "expectedRevision", "inputRef"]
    : ["workflowId", "runId", "expectedRevision"];
  requireExactKeys(payload, keys, "payload");
  const publicData = {
    workflowId: requireOpaqueId(payload.workflowId, "payload.workflowId"),
    runId: requireString(payload.runId, "payload.runId", { min: 36, max: 36, pattern: UUID_PATTERN }),
    expectedRevision: requireInteger(payload.expectedRevision, "payload.expectedRevision", 0, 2_147_483_647)
  };
  if (allowInputRef && payload.inputRef !== undefined) {
    publicData.inputRef = requireOpaqueId(payload.inputRef, "payload.inputRef");
  }
  return publicData;
}

function validateWorkflowResultPayload(payload) {
  requireExactKeys(payload, ["workflowId", "runId", "knownRevision"], "payload");
  const publicData = {
    workflowId: requireOpaqueId(payload.workflowId, "payload.workflowId"),
    runId: requireString(payload.runId, "payload.runId", { min: 36, max: 36, pattern: UUID_PATTERN })
  };
  if (payload.knownRevision !== undefined) {
    publicData.knownRevision = requireInteger(payload.knownRevision, "payload.knownRevision", 0, 2_147_483_647);
  }
  return publicData;
}

function validatePcLock(payload) {
  requireExactKeys(payload, ["confirmation"], "payload");
  if (payload.confirmation !== "LOCK_PC") {
    fail("LOCK_CONFIRMATION_INVALID", "payload.confirmation must equal LOCK_PC");
  }
  return { confirmation: "LOCK_PC" };
}

export function validateActionPayload(action, payload) {
  requireObject(payload, "payload");
  switch (action) {
    case PocketRelayAction.OPEN_LINK:
      return validateOpenLink(payload);
    case PocketRelayAction.SEND_FILE_TO_PC:
      return validateFileUpload(payload);
    case PocketRelayAction.FETCH_FILE_TO_IPHONE:
      return validateFileFetch(payload);
    case PocketRelayAction.START_WORKFLOW:
      return validateWorkflowMutationPayload(payload, true);
    case PocketRelayAction.PAUSE_WORKFLOW:
    case PocketRelayAction.CANCEL_WORKFLOW:
      return validateWorkflowMutationPayload(payload, false);
    case PocketRelayAction.GET_WORKFLOW_RESULT:
      return validateWorkflowResultPayload(payload);
    case PocketRelayAction.LOCK_PC:
      return validatePcLock(payload);
    default:
      fail("ACTION_NOT_ALLOWED", `action ${String(action)} is not in the Pocket Relay v1 allowlist`, 403);
  }
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function describePocketRelayCommand({ action, target, payload }) {
  const descriptor = POCKET_RELAY_ALLOWLIST[action];
  if (!descriptor) fail("ACTION_NOT_ALLOWED", `action ${String(action)} is not allowed`, 403);
  const publicData = validateActionPayload(action, payload);
  return {
    targetDevice: requireString(target?.deviceName, "target.deviceName", { min: 1, max: 80 }),
    scope: descriptor.scope,
    data: publicData,
    expectedEffect: descriptor.expectedEffect
  };
}

function validateDisclosure(command, expectedDisclosure) {
  const disclosure = requireObject(command.disclosure, "disclosure");
  requireExactKeys(disclosure, ["targetDevice", "scope", "data", "expectedEffect"], "disclosure");
  if (stableStringify(disclosure) !== stableStringify(expectedDisclosure)) {
    fail("DISCLOSURE_MISMATCH", "target, scope, data and expected effect must match the signed command");
  }
}

function validateApproval(command, descriptor, nowMs) {
  if (descriptor.risk !== "high") {
    if (command.approval !== undefined && command.approval !== null) {
      fail("APPROVAL_NOT_APPLICABLE", "approval is accepted only for high-risk actions");
    }
    return;
  }

  if (!isPlainObject(command.approval)) {
    fail("IPHONE_APPROVAL_REQUIRED", "high-risk action requires explicit iPhone confirmation", 403);
  }
  const approval = command.approval;
  requireExactKeys(approval, ["method", "commandId", "approvedAt"], "approval");
  if (approval.method !== "explicit_iphone_confirmation") {
    fail("IPHONE_APPROVAL_REQUIRED", "high-risk action requires explicit iPhone confirmation", 403);
  }
  if (approval.commandId !== command.commandId) {
    fail("IPHONE_APPROVAL_INVALID", "approval must be bound to commandId", 403);
  }
  const approvedAt = requireIsoDate(approval.approvedAt, "approval.approvedAt");
  const issuedAt = Date.parse(command.issuedAt);
  if (approvedAt > issuedAt + 5_000 || nowMs - approvedAt > MAX_COMMAND_TTL_MS + MAX_CLOCK_SKEW_MS) {
    fail("IPHONE_APPROVAL_EXPIRED", "iPhone approval is stale or issued after the command", 403);
  }
}

export function validatePocketRelayCommand(command, {
  now = () => Date.now(),
  expectedTargetDeviceId,
  expectedTargetDevice
} = {}) {
  requireExactKeys(
    command,
    [
      "version",
      "commandId",
      "idempotencyKey",
      "deviceId",
      "nonce",
      "issuedAt",
      "expiresAt",
      "action",
      "target",
      "scope",
      "payload",
      "disclosure",
      "approval"
    ],
    "command"
  );
  validateNoDangerousFields(command);

  if (command.version !== POCKET_RELAY_COMMAND_VERSION) {
    fail("CONTRACT_VERSION_UNSUPPORTED", `expected ${POCKET_RELAY_COMMAND_VERSION}`, 409);
  }
  requireString(command.commandId, "command.commandId", { min: 36, max: 36, pattern: UUID_PATTERN });
  requireString(command.idempotencyKey, "command.idempotencyKey", { min: 36, max: 36, pattern: UUID_PATTERN });
  requireOpaqueId(command.deviceId, "command.deviceId");
  requireString(command.nonce, "command.nonce", { min: 22, max: 128, pattern: NONCE_PATTERN });
  const issuedAt = requireIsoDate(command.issuedAt, "command.issuedAt");
  const expiresAt = requireIsoDate(command.expiresAt, "command.expiresAt");
  const nowMs = now();
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_COMMAND_TTL_MS) {
    fail("COMMAND_TTL_INVALID", `command TTL must be at most ${MAX_COMMAND_TTL_MS}ms`);
  }
  if (issuedAt > nowMs + MAX_CLOCK_SKEW_MS) fail("COMMAND_NOT_YET_VALID", "command issuedAt is in the future", 401);
  if (expiresAt < nowMs - MAX_CLOCK_SKEW_MS) fail("COMMAND_EXPIRED", "command has expired", 401);

  const descriptor = POCKET_RELAY_ALLOWLIST[command.action];
  if (!descriptor) fail("ACTION_NOT_ALLOWED", `action ${String(command.action)} is not allowed`, 403);

  const target = requireObject(command.target, "command.target");
  requireExactKeys(target, ["deviceId", "deviceName", "platform"], "command.target");
  requireOpaqueId(target.deviceId, "command.target.deviceId");
  requireString(target.deviceName, "command.target.deviceName", { min: 1, max: 80 });
  if (target.platform !== "windows") fail("TARGET_NOT_ALLOWED", "Pocket Relay v1 targets only an approved Windows host", 403);
  if (expectedTargetDeviceId && target.deviceId !== expectedTargetDeviceId) {
    fail("TARGET_NOT_PAIRED", "command target is not the paired host", 403);
  }
  if (expectedTargetDevice && stableStringify(target) !== stableStringify(expectedTargetDevice)) {
    fail("TARGET_NOT_PAIRED", "command target metadata does not match the paired host", 403);
  }
  if (command.scope !== descriptor.scope) {
    fail("SCOPE_NOT_ALLOWED", `action ${command.action} requires scope ${descriptor.scope}`, 403);
  }

  const expectedDisclosure = describePocketRelayCommand(command);
  validateDisclosure(command, expectedDisclosure);
  validateApproval(command, descriptor, nowMs);
  return {
    command,
    descriptor,
    publicPayload: expectedDisclosure.data,
    disclosure: expectedDisclosure
  };
}

export function commandEffectDigest(command) {
  return sha256Hex(stableStringify({
    version: command.version,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    deviceId: command.deviceId,
    action: command.action,
    target: command.target,
    scope: command.scope,
    payload: command.payload,
    disclosure: command.disclosure
  }));
}
