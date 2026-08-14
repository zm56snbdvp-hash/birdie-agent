const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{0,79}$/;

export class BirdieWorldProjectionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BirdieWorldProjectionError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message) {
  throw new BirdieWorldProjectionError(code, message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_LEDGER_EVENT", `${label} must be an object`);
  }
  return value;
}

function requireIdentifier(value, label) {
  const normalized = String(value ?? "").trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    fail(
      "INVALID_LEDGER_EVENT",
      `${label} must be a stable identifier containing only letters, numbers, periods, underscores, or hyphens`
    );
  }
  return normalized;
}

function requireCode(value, label) {
  const normalized = String(value ?? "").trim();
  if (!CODE_PATTERN.test(normalized)) {
    fail("INVALID_LEDGER_EVENT", `${label} must be an uppercase canonical code`);
  }
  return normalized;
}

function requireText(value, label, maximumLength) {
  if (typeof value !== "string") {
    fail("INVALID_LEDGER_EVENT", `${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    fail(
      "INVALID_LEDGER_EVENT",
      `${label} must contain between 1 and ${maximumLength} characters`
    );
  }
  return normalized;
}

function requireApprovedAt(value) {
  const approvedAt = requireText(value, "approvedAt", 80);
  const timestamp = Date.parse(approvedAt);
  if (!Number.isFinite(timestamp)) {
    fail("INVALID_LEDGER_EVENT", "approvedAt must be a valid timestamp");
  }
  return new Date(timestamp).toISOString();
}

function optionalTimestamp(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const timestamp = Date.parse(requireText(value, label, 80));
  if (!Number.isFinite(timestamp)) {
    fail("INVALID_LEDGER_EVENT", `${label} must be a valid timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function canonicalFingerprint(event) {
  return JSON.stringify(event);
}

export function ledgerEventId(transactionId) {
  return `coin:${requireIdentifier(transactionId, "transactionId")}`;
}

export function birdieResponseId(transactionId) {
  return `birdie-response:${requireIdentifier(transactionId, "transactionId")}`;
}

export function normalizeApprovedEarnLedgerEvent(input) {
  const event = requireObject(input, "ledger event");
  const transactionId = requireIdentifier(event.transactionId, "transactionId");
  const birdieId = requireIdentifier(event.birdieId, "birdieId");

  if (event.transactionType !== "EARN") {
    fail(
      "LEDGER_EVENT_NOT_EARN",
      "BirdieWorld V1 accepts only canonical EARN transactions"
    );
  }
  if (event.status !== "APPROVED") {
    fail(
      "LEDGER_EVENT_NOT_APPROVED",
      "BirdieWorld V1 accepts only APPROVED transactions"
    );
  }

  const amount = Number(event.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail(
      "INVALID_LEDGER_EVENT",
      "amount must be a positive safe integer for an approved EARN transaction"
    );
  }

  const normalized = {
    transactionId,
    birdieId,
    amount,
    transactionType: "EARN",
    actionCode: requireCode(event.actionCode, "actionCode"),
    sourceType: requireCode(event.sourceType, "sourceType"),
    sourceReference: requireText(event.sourceReference, "sourceReference", 500),
    status: "APPROVED",
    approvedAt: requireApprovedAt(event.approvedAt)
  };
  const createdAt = optionalTimestamp(event.createdAt, "createdAt");
  if (createdAt !== undefined) normalized.createdAt = createdAt;

  return normalized;
}

export function createBirdieSystemResponse(input) {
  const event = normalizeApprovedEarnLedgerEvent(input);
  const unit = event.amount === 1 ? "Birdie" : "Birdies";
  const verb = event.amount === 1 ? "ist" : "sind";

  return {
    schemaVersion: "birdie-system-response/v1",
    responseId: birdieResponseId(event.transactionId),
    eventId: ledgerEventId(event.transactionId),
    birdieId: event.birdieId,
    kind: "COIN_EARNED",
    language: "de-DE",
    amount: event.amount,
    actionCode: event.actionCode,
    text: `+${event.amount} ${unit} ${verb} angekommen.`
  };
}

export function projectApprovedEarnLedgerEvents(inputs, { birdieId } = {}) {
  if (!Array.isArray(inputs)) {
    fail("INVALID_LEDGER_EVENT_SET", "ledger events must be an array");
  }

  const requestedBirdieId = birdieId === undefined
    ? undefined
    : requireIdentifier(birdieId, "birdieId");
  const eventsById = new Map();
  let scopedBirdieId = requestedBirdieId;

  for (const input of inputs) {
    const event = normalizeApprovedEarnLedgerEvent(input);
    if (scopedBirdieId === undefined) scopedBirdieId = event.birdieId;
    if (event.birdieId !== scopedBirdieId) {
      fail(
        "WORLD_SCOPE_MISMATCH",
        "A BirdieWorld projection may contain events for exactly one Birdie"
      );
    }

    const eventId = ledgerEventId(event.transactionId);
    const existing = eventsById.get(eventId);
    if (existing) {
      if (canonicalFingerprint(existing) !== canonicalFingerprint(event)) {
        fail(
          "LEDGER_EVENT_CONFLICT",
          `Ledger event ${eventId} was replayed with different canonical data`
        );
      }
      continue;
    }
    eventsById.set(eventId, event);
  }

  if (scopedBirdieId === undefined) {
    fail(
      "WORLD_SCOPE_REQUIRED",
      "birdieId is required when projecting an empty ledger event set"
    );
  }

  const appliedEventIds = [...eventsById.keys()].sort();
  let approvedEarnedBirdies = 0;
  for (const eventId of appliedEventIds) {
    approvedEarnedBirdies += eventsById.get(eventId).amount;
    if (!Number.isSafeInteger(approvedEarnedBirdies)) {
      fail("WORLD_TOTAL_OVERFLOW", "Projected Birdie total exceeds the safe integer range");
    }
  }

  return {
    schemaVersion: "birdie-world-progress/v1",
    birdieId: scopedBirdieId,
    revision: appliedEventIds.length,
    approvedEarnedBirdies,
    appliedEventIds,
    lastEventId: appliedEventIds.at(-1) ?? null
  };
}
