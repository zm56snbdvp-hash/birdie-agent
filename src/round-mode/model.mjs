export const ROUND_MODE_RULE_VERSION = "round-mode-v0.1.0";

export const ROUND_STATUSES = Object.freeze(["ACTIVE", "COMPLETED", "CANCELLED"]);
export const HOLE_STATUSES = Object.freeze(["PENDING", "ACTIVE", "COMPLETED"]);
export const PLAY_SESSION_STATUSES = Object.freeze(["ACTIVE", "SWITCHED_OUT", "LOST", "ENDED"]);
export const OBJECT_STATES = Object.freeze(["RESTING", "IN_PLAY", "LOST", "FOUND"]);
export const LOCATION_EVENT_TYPES = Object.freeze(["LAST_SEEN", "LOST", "FOUND", "NOTE"]);
export const LOCATION_VISIBILITIES = Object.freeze(["PRIVATE", "APPROXIMATE", "PUBLIC"]);

export class RoundModeValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RoundModeValidationError";
    this.code = code;
  }
}

export function requireString(value, field, maxLength = 180) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoundModeValidationError("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new RoundModeValidationError("INVALID_INPUT", `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export function requirePositiveInteger(value, field, max = 36) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RoundModeValidationError("INVALID_INPUT", `${field} must be an integer from 1 to ${max}`);
  }
  return value;
}

export function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new RoundModeValidationError(
      "INVALID_INPUT",
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }
  return value;
}

export function assertRuleVersion(value) {
  const version = value || ROUND_MODE_RULE_VERSION;
  if (version !== ROUND_MODE_RULE_VERSION) {
    throw new RoundModeValidationError(
      "RULE_VERSION_UNSUPPORTED",
      `Unsupported ruleVersion ${version}; expected ${ROUND_MODE_RULE_VERSION}`
    );
  }
  return version;
}

export function nextObjectState(currentState, event) {
  const current = currentState || "RESTING";
  const transitions = {
    RESTING: { SELECT_FOR_PLAY: "IN_PLAY" },
    IN_PLAY: { SWITCH_OUT: "RESTING", END_ROUND: "RESTING", MARK_LOST: "LOST" },
    LOST: { MARK_FOUND: "FOUND" },
    FOUND: { SELECT_FOR_PLAY: "IN_PLAY", REST: "RESTING" }
  };
  const next = transitions[current]?.[event];
  if (!next) {
    throw new RoundModeValidationError(
      "INVALID_OBJECT_TRANSITION",
      `Object state ${current} cannot handle ${event}`
    );
  }
  return next;
}

export function normalizeLocationInput(input = {}) {
  const visibility = requireEnum(
    input.visibility || "PRIVATE",
    "visibility",
    LOCATION_VISIBILITIES
  );
  const hasLatitude = input.latitude !== undefined && input.latitude !== null;
  const hasLongitude = input.longitude !== undefined && input.longitude !== null;
  const hasExactCoordinates = hasLatitude || hasLongitude;

  if (hasLatitude !== hasLongitude) {
    throw new RoundModeValidationError(
      "INCOMPLETE_EXACT_LOCATION",
      "latitude and longitude must be supplied together"
    );
  }

  if (hasExactCoordinates) {
    if (input.exactLocationOptIn !== true) {
      throw new RoundModeValidationError(
        "EXACT_LOCATION_OPT_IN_REQUIRED",
        "Exact coordinates require explicit exactLocationOptIn=true"
      );
    }
    if (visibility !== "PRIVATE") {
      throw new RoundModeValidationError(
        "EXACT_LOCATION_MUST_BE_PRIVATE",
        "Exact coordinates may only be stored with PRIVATE visibility"
      );
    }
    if (
      typeof input.latitude !== "number" ||
      typeof input.longitude !== "number" ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      throw new RoundModeValidationError("INVALID_COORDINATES", "Exact coordinates are invalid");
    }
  }

  return {
    visibility,
    locationLabel:
      input.locationLabel === undefined || input.locationLabel === null
        ? null
        : requireString(input.locationLabel, "locationLabel", 240),
    latitude: hasExactCoordinates ? input.latitude : null,
    longitude: hasExactCoordinates ? input.longitude : null,
    exactLocationOptIn: hasExactCoordinates ? true : false
  };
}
