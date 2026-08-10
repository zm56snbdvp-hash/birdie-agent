import {
  ACCOUNT_TYPES,
  ACTION_DEFINITIONS,
  BADGE_DEFINITIONS,
  CLAIM_DECISIONS,
  REDEMPTION_DECISIONS
} from "./catalog.mjs";

export class CoinValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "CoinValidationError";
    this.code = code;
    this.status = status;
  }
}

export function requireObject(value, label = "body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoinValidationError("INVALID_BODY", `${label} must be an object`);
  }

  return value;
}

export function requireString(value, field, maximum = 240) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new CoinValidationError("MISSING_FIELD", `${field} is required`);
  }

  if (normalized.length > maximum) {
    throw new CoinValidationError(
      "FIELD_TOO_LONG",
      `${field} must contain at most ${maximum} characters`
    );
  }

  return normalized;
}

export function optionalString(value, field, maximum = 500) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requireString(value, field, maximum);
}

export function requireAccountType(value) {
  const accountType = requireString(value, "accountType", 20).toUpperCase();

  if (!ACCOUNT_TYPES.includes(accountType)) {
    throw new CoinValidationError(
      "INVALID_ACCOUNT_TYPE",
      `accountType must be one of ${ACCOUNT_TYPES.join(", ")}`
    );
  }

  return accountType;
}

export function optionalAccountType(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requireAccountType(value);
}

export function requireActionCode(value) {
  const actionCode = requireString(value, "actionCode", 80).toUpperCase();

  if (!ACTION_DEFINITIONS[actionCode]) {
    throw new CoinValidationError("UNKNOWN_ACTION", `Unknown actionCode: ${actionCode}`);
  }

  return actionCode;
}

export function requireBadgeCode(value) {
  const badgeCode = requireString(value, "badgeCode", 80).toUpperCase();

  if (!BADGE_DEFINITIONS[badgeCode]) {
    throw new CoinValidationError("UNKNOWN_BADGE", `Unknown badgeCode: ${badgeCode}`);
  }

  return badgeCode;
}

export function requireClaimDecision(value) {
  const decision = requireString(value, "decision", 20).toUpperCase();

  if (!CLAIM_DECISIONS.includes(decision)) {
    throw new CoinValidationError(
      "INVALID_DECISION",
      `decision must be one of ${CLAIM_DECISIONS.join(", ")}`
    );
  }

  return decision;
}

export function requireRedemptionDecision(value) {
  const decision = requireString(value, "decision", 20).toUpperCase();

  if (!REDEMPTION_DECISIONS.includes(decision)) {
    throw new CoinValidationError(
      "INVALID_DECISION",
      `decision must be one of ${REDEMPTION_DECISIONS.join(", ")}`
    );
  }

  return decision;
}

export function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const amount = Number(value);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new CoinValidationError("INVALID_AMOUNT", `${field} must be a positive integer`);
  }

  return amount;
}

export function requirePositiveInteger(value, field) {
  const amount = optionalPositiveInteger(value, field);

  if (amount === undefined) {
    throw new CoinValidationError("MISSING_FIELD", `${field} is required`);
  }

  return amount;
}

export function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}
