export class DnaValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DnaValidationError";
    this.code = code;
    this.status = status;
  }
}

export function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DnaValidationError("INVALID_BODY", "Request body must be an object");
  }
  return value;
}

export function requireString(value, field, max = 500) {
  const text = String(value ?? "").trim();
  if (!text) throw new DnaValidationError("REQUIRED_FIELD", `${field} is required`);
  if (text.length > max) {
    throw new DnaValidationError("FIELD_TOO_LONG", `${field} exceeds ${max} characters`);
  }
  return text;
}

export function optionalString(value, field, max = 500) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  if (text.length > max) {
    throw new DnaValidationError("FIELD_TOO_LONG", `${field} exceeds ${max} characters`);
  }
  return text || undefined;
}

export function requireEnum(value, field, allowed) {
  const normalized = requireString(value, field, 80).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new DnaValidationError(
      "INVALID_ENUM",
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }
  return normalized;
}

export function optionalObject(value, field) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DnaValidationError("INVALID_FIELD", `${field} must be an object`);
  }
  return value;
}

export function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}
