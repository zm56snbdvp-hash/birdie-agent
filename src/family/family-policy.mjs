const BLOCKED_KEY_PATTERNS = [
  /finance/i, /bank/i, /tax/i, /payment/i, /invoice/i, /cash/i, /margin/i,
  /profit/i, /revenue/i, /cost/i, /expense/i, /credential/i, /secret/i,
  /password/i, /token/i, /api[_ -]?key/i, /authorization/i, /auth/i,
  /connection[_ -]?registry/i, /action[_ -]?log/i, /audit/i, /mail/i,
  /email/i, /inbox/i, /message[_ -]?id/i, /phone/i, /whatsapp/i
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\w)(?:\+|00)?\d[\d\s()./-]{7,}\d(?!\w)/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi;
const SENSITIVE_QUERY_RE = /([?&](?:token|key|secret|password|api_key)=)[^&#\s]+/gi;

export const FAMILY_ACCESS_POLICY = Object.freeze({
  role: "FAMILY_READ_ONLY",
  version: "1.0",
  readOnly: true,
  allowedResources: ["health", "briefing", "nextTask"],
  deniedCapabilities: [
    "OS mutations", "task updates", "idea creation", "mail access",
    "mail send/move/delete", "finance and banking data",
    "credentials and connection secrets", "action/audit logs",
    "Coin or reward writes", "Framer publish/deploy",
    "social publishing or messaging", "external account mutations"
  ],
  privacy: {
    redactEmails: true,
    redactPhoneNumbers: true,
    redactSecrets: true,
    blockSensitiveKeys: true
  }
});

export function isFamilyBlockedKey(key) {
  const normalized = String(key ?? "");
  return BLOCKED_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sanitizeFamilyString(value) {
  return String(value)
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(PHONE_RE, "[redacted-phone]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SENSITIVE_QUERY_RE, "$1[redacted]");
}

export function sanitizeFamilyData(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeFamilyString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return sanitizeFamilyString(value);
  if (seen.has(value)) return "[redacted-circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeFamilyData(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isFamilyBlockedKey(key)) continue;
    output[key] = sanitizeFamilyData(item, seen);
  }
  return output;
}
