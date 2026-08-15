import { createHash } from "node:crypto";

const ALLOWED_MODES = new Set(["PRIVATE", "SAFE_TO_FILM"]);
const ALLOWED_PROJECTIONS = new Set(["briefing", "osMap", "tasks", "health", "exceptions"]);

const DENIED_KEY_PATTERNS = [
  /email/i,
  /phone/i,
  /whatsapp/i,
  /mail/i,
  /inbox/i,
  /message/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /api[_ -]?key/i,
  /authorization/i,
  /^auth/i,
  /provider/i,
  /connection/i,
  /finance/i,
  /bank/i,
  /payment/i,
  /invoice/i,
  /price/i,
  /cost/i,
  /revenue/i,
  /margin/i,
  /supplier/i,
  /customer/i,
  /ledger/i,
  /claim/i,
  /redemption/i,
  /balance/i,
  /coin/i,
  /^(?:raw)?source(?:ref(?:erence)?|url|notes?|data)?$/i,
  /canonicalSource/i,
  /evidence/i,
  /notes?/i,
  /location/i,
  /coordinates?/i,
  /^lat(?:itude)?$/i,
  /^lng$/i,
  /^lon(?:gitude)?$/i,
  /address/i,
  /street/i,
  /postal/i
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\w)(?:\+|00)?\d[\d\s()./-]{7,}\d(?!\w)/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi;
const SECRET_QUERY_RE = /([?&](?:token|key|secret|password|api_key)=)[^&#\s]+/gi;
const INLINE_SECRET_RE = /\b(api[_ -]?key|token|secret|password|credential)\s*[:=]\s*[^\s,;]+/gi;
const LONG_HEX_RE = /\b[a-f0-9]{32,}\b/gi;

export const NEST_BRAIN_PROJECTION_POLICY = Object.freeze({
  id: "CAP-NEST-001",
  version: "1.0.0",
  readOnly: true,
  denyByDefault: true,
  modes: ["PRIVATE", "SAFE_TO_FILM"],
  projections: ["briefing", "osMap", "tasks", "health", "exceptions"],
  mutationMethods: [],
  rawSheetAccess: false,
  founderCredentialFallback: false
});

function requiredMode(mode) {
  const normalized = String(mode ?? "").trim().toUpperCase();
  if (!ALLOWED_MODES.has(normalized)) {
    const error = new Error("NEST mode is not allowlisted");
    error.code = "NEST_MODE_DENIED";
    error.status = 403;
    throw error;
  }
  return normalized;
}

function requiredProjections(projections) {
  if (!Array.isArray(projections) || projections.length === 0) {
    const error = new Error("At least one NEST projection is required");
    error.code = "NEST_PROJECTION_REQUIRED";
    error.status = 400;
    throw error;
  }

  const normalized = [...new Set(projections.map((value) => String(value ?? "").trim()))];
  for (const projection of normalized) {
    if (!ALLOWED_PROJECTIONS.has(projection)) {
      const error = new Error(`NEST projection is not allowlisted: ${projection}`);
      error.code = "NEST_PROJECTION_DENIED";
      error.status = 403;
      throw error;
    }
  }
  return normalized;
}

function sanitizeString(value) {
  return String(value)
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(PHONE_RE, "[redacted-phone]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SECRET_QUERY_RE, "[redacted-secret]")
    .replace(INLINE_SECRET_RE, "[redacted-secret]")
    .replace(LONG_HEX_RE, "[redacted-id]");
}

function isDeniedKey(key) {
  const normalized = String(key ?? "");
  return DENIED_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sanitizeNestBrainData(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return sanitizeString(value);
  if (seen.has(value)) return "[redacted-circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeNestBrainData(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isDeniedKey(key)) continue;
    output[key] = sanitizeNestBrainData(item, seen);
  }
  return output;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  return [];
}

function cleanText(value, max = 240) {
  if (value === null || value === undefined) return "";
  return sanitizeString(String(value)).slice(0, max);
}

function projectBriefing(data, mode) {
  const result = {
    title: cleanText(data?.title || data?.headline || "BirdieOS Briefing", 120),
    summary: cleanText(data?.summary || data?.status || data?.message || "", mode === "SAFE_TO_FILM" ? 180 : 320),
    launchState: cleanText(data?.launchState || data?.releaseState || data?.state || "", 80)
  };
  if (mode === "PRIVATE") {
    result.focus = cleanText(data?.focus || data?.nextFocus || data?.nextAction || "", 220);
  }
  return result;
}

function projectOsMap(data, mode) {
  const rows = asList(data).slice(0, 30).map((item) => ({
    id: cleanText(item?.id || item?.componentId || item?.programId || item?.domain || "", 80),
    name: cleanText(item?.name || item?.component || item?.program || item?.title || "", 120),
    state: cleanText(item?.state || item?.status || item?.stage || "", 80)
  }));
  return mode === "SAFE_TO_FILM" ? rows.slice(0, 12) : rows;
}

function projectTasks(data, mode) {
  const rows = asList(data).slice(0, 80).map((item) => ({
    taskId: cleanText(item?.taskId || item?.TaskID || item?.["Task ID"] || item?.id || "", 40),
    title: cleanText(item?.title || item?.task || item?.Task || "", mode === "SAFE_TO_FILM" ? 100 : 160),
    area: cleanText(item?.area || item?.Area || "", 80),
    priority: cleanText(item?.priority || item?.Priority || "", 24),
    status: cleanText(item?.status || item?.Status || "", 40),
    blocked: Boolean(item?.blocked || item?.blockedReason || item?.["Blocked Reason"] || String(item?.status || item?.Status || "").toUpperCase() === "WAITING")
  }));
  return mode === "SAFE_TO_FILM" ? rows.slice(0, 20) : rows;
}

function projectHealth(data, mode) {
  const rows = asList(data).slice(0, 100).map((item) => ({
    checkId: cleanText(item?.checkId || item?.id || "", 60),
    component: cleanText(item?.componentId || item?.component || item?.name || "", 100),
    criticality: cleanText(item?.criticality || "", 24),
    status: cleanText(item?.status || "", 60)
  }));
  return mode === "SAFE_TO_FILM"
    ? rows.filter((item) => item.criticality === "CRITICAL" || item.status.includes("BLOCK")).slice(0, 20)
    : rows;
}

function projectExceptions(data, mode) {
  const rows = asList(data).slice(0, 100).map((item) => ({
    exceptionId: cleanText(item?.exceptionId || item?.incidentId || item?.id || "", 60),
    component: cleanText(item?.componentId || item?.component || "", 100),
    severity: cleanText(item?.severity || item?.criticality || "", 24),
    status: cleanText(item?.status || item?.state || "", 60)
  }));
  return mode === "SAFE_TO_FILM"
    ? rows.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH").slice(0, 12)
    : rows;
}

const PROJECTORS = Object.freeze({
  briefing: projectBriefing,
  osMap: projectOsMap,
  tasks: projectTasks,
  health: projectHealth,
  exceptions: projectExceptions
});

function parseTimestamp(value, projection) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    const error = new Error(`NEST source timestamp missing or invalid: ${projection}`);
    error.code = "NEST_SOURCE_TIMESTAMP_INVALID";
    error.status = 503;
    throw error;
  }
  return timestamp;
}

function assertFreshSource({ projection, source, nowMs, maxAgeMs }) {
  if (!source || typeof source !== "object" || !("data" in source)) {
    const error = new Error(`NEST source missing: ${projection}`);
    error.code = "NEST_SOURCE_MISSING";
    error.status = 503;
    throw error;
  }
  const timestampMs = parseTimestamp(source.sourceTimestamp, projection);
  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs > maxAgeMs) {
    const error = new Error(`NEST source stale: ${projection}`);
    error.code = "NEST_SOURCE_STALE";
    error.status = 503;
    throw error;
  }
  return { timestampMs, ageMs };
}

function regexHas(regex, value) {
  regex.lastIndex = 0;
  const matched = regex.test(value);
  regex.lastIndex = 0;
  return matched;
}

function assertNoDeniedOutput(value, path = "root") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (
      regexHas(EMAIL_RE, value) ||
      regexHas(PHONE_RE, value) ||
      regexHas(BEARER_RE, value) ||
      regexHas(SECRET_QUERY_RE, value) ||
      regexHas(INLINE_SECRET_RE, value) ||
      regexHas(LONG_HEX_RE, value)
    ) {
      const error = new Error(`Denied sentinel survived NEST sanitization at ${path}`);
      error.code = "NEST_SANITIZATION_FAILED";
      error.status = 500;
      throw error;
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDeniedOutput(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (isDeniedKey(key)) {
      const error = new Error(`Denied key survived NEST allowlist at ${path}.${key}`);
      error.code = "NEST_SANITIZATION_FAILED";
      error.status = 500;
      throw error;
    }
    assertNoDeniedOutput(item, `${path}.${key}`);
  }
}

function fingerprint(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function createNestBrainProjection({
  requestedMode,
  requestedProjections,
  sources,
  now = new Date(),
  maxAgeMs = 15 * 60 * 1000
}) {
  const mode = requiredMode(requestedMode);
  const projections = requiredProjections(requestedProjections);
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    const error = new Error("NEST sources object is required");
    error.code = "NEST_SOURCE_MISSING";
    error.status = 503;
    throw error;
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    const error = new Error("NEST maxAgeMs must be positive");
    error.code = "NEST_FRESHNESS_INVALID";
    error.status = 400;
    throw error;
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("NEST now is invalid");

  const freshness = {};
  const data = {};
  const fingerprintParts = [mode, ...projections];

  for (const projection of projections) {
    const source = sources[projection];
    const sourceFreshness = assertFreshSource({ projection, source, nowMs, maxAgeMs });
    const projected = PROJECTORS[projection](source.data, mode);
    const sanitized = sanitizeNestBrainData(projected);
    assertNoDeniedOutput(sanitized);
    data[projection] = sanitized;
    freshness[projection] = {
      sourceTimestamp: new Date(sourceFreshness.timestampMs).toISOString(),
      ageSeconds: Math.floor(sourceFreshness.ageMs / 1000)
    };
    fingerprintParts.push(projection, freshness[projection].sourceTimestamp, JSON.stringify(sanitized));
  }

  const output = {
    generatedAt: new Date(nowMs).toISOString(),
    mode,
    readOnly: true,
    projections,
    freshness,
    sourceFingerprint: fingerprint(fingerprintParts),
    data
  };

  assertNoDeniedOutput(output);
  return output;
}
