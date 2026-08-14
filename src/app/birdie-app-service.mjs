import { randomUUID } from "node:crypto";

import {
  BirdieWorldProjectionError,
  birdieResponseId,
  createBirdieSystemResponse,
  ledgerEventId,
  normalizeApprovedEarnLedgerEvent,
  projectApprovedEarnLedgerEvents
} from "./ledger-world-projector.mjs";

const BIRDIE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const RESPONSE_ID_PATTERN = /^birdie-response:[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const LEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ACTION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{0,79}$/;
const SUBJECT_PATTERN = /^[^\s]{1,300}$/;

export class BirdieAppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BirdieAppError";
    this.code = code;
    this.status = status;
  }
}

function appError(code, message, status) {
  throw new BirdieAppError(code, message, status);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    appError("INVALID_APP_REQUEST", `${label} must be an object`, 400);
  }
  return value;
}

function requirePattern(
  value,
  pattern,
  label,
  code = "INVALID_APP_REQUEST",
  status = 400
) {
  const normalized = String(value ?? "").trim();
  if (!pattern.test(normalized)) {
    appError(code, `${label} is invalid`, status);
  }
  return normalized;
}

function authenticatedBirdieSession(authContext) {
  if (!authContext || typeof authContext !== "object") {
    appError("BIRDIE_APP_UNAUTHENTICATED", "An authenticated Birdie session is required", 401);
  }
  const birdieId = requirePattern(
    authContext.birdieId,
    BIRDIE_ID_PATTERN,
    "authenticated birdieId",
    "BIRDIE_APP_UNAUTHENTICATED",
    401
  );
  const subject = requirePattern(
    authContext.subject,
    SUBJECT_PATTERN,
    "authenticated subject",
    "BIRDIE_APP_UNAUTHENTICATED",
    401
  );
  return { birdieId, subject };
}

function rejectClientScope(input) {
  if (input.birdieId !== undefined) {
    appError(
      "CLIENT_BIRDIE_ID_FORBIDDEN",
      "birdieId is derived exclusively from the authenticated session",
      403
    );
  }
}

function isoFromClock(clock) {
  const value = clock();
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new Error("clock must return a Date or a parseable timestamp");
  }
  return new Date(timestamp).toISOString();
}

function requireStorage(storage) {
  const requiredMethods = [
    "applyLedgerProjection",
    "listApprovedEarnEvents",
    "leaseNextResponse",
    "ackResponse"
  ];
  for (const method of requiredMethods) {
    if (typeof storage?.[method] !== "function") {
      throw new Error(`storage.${method} dependency is required`);
    }
  }
  return storage;
}

function normalizeStoredResponse(response, expectedBirdieId) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("storage returned an invalid response DTO");
  }
  const responseId = String(response.responseId || "");
  if (!RESPONSE_ID_PATTERN.test(responseId)) {
    throw new Error("storage returned an invalid responseId");
  }
  const transactionId = responseId.slice("birdie-response:".length);
  const eventId = ledgerEventId(transactionId);
  if (response.eventId !== eventId) {
    throw new Error("storage returned a response with a mismatched eventId");
  }
  if (response.birdieId !== expectedBirdieId) {
    appError("CROSS_BIRDIE_ACCESS", "Response crossed the Birdie scope", 403);
  }

  const amount = Number(response.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("storage returned a response with an invalid amount");
  }
  const actionCode = String(response.actionCode || "");
  if (!ACTION_CODE_PATTERN.test(actionCode)) {
    throw new Error("storage returned a response with an invalid actionCode");
  }
  const expectedText = amount === 1
    ? "+1 Birdie ist angekommen."
    : `+${amount} Birdies sind angekommen.`;
  if (
    response.schemaVersion !== "birdie-system-response/v1" ||
    response.kind !== "COIN_EARNED" ||
    response.language !== "de-DE" ||
    response.text !== expectedText
  ) {
    throw new Error("storage returned a non-deterministic Birdie response");
  }

  return {
    schemaVersion: "birdie-system-response/v1",
    responseId,
    eventId,
    birdieId: expectedBirdieId,
    kind: "COIN_EARNED",
    language: "de-DE",
    amount,
    actionCode,
    text: expectedText
  };
}

function assertStoredProjection(result, expectedEvent, expectedResponse) {
  if (!result || typeof result !== "object" || typeof result.created !== "boolean") {
    throw new Error("storage.applyLedgerProjection must return { created }");
  }

  if (result.event !== undefined) {
    const storedEvent = normalizeApprovedEarnLedgerEvent(result.event);
    if (JSON.stringify(storedEvent) !== JSON.stringify(expectedEvent)) {
      appError(
        "LEDGER_EVENT_CONFLICT",
        "Stored projection does not match the canonical ledger event",
        409
      );
    }
  }
  if (result.response !== undefined) {
    const storedResponse = normalizeStoredResponse(
      result.response,
      expectedResponse.birdieId
    );
    if (JSON.stringify(storedResponse) !== JSON.stringify(expectedResponse)) {
      appError(
        "BIRDIE_RESPONSE_CONFLICT",
        "Stored response does not match the deterministic response",
        409
      );
    }
  }
}

function validateLeasedResponse(result, birdieId, leaseRequestId, requestedAt) {
  if (result === null || result === undefined) return null;
  if (!result || typeof result !== "object" || !result.response) {
    throw new Error("storage.leaseNextResponse returned an invalid lease envelope");
  }
  const response = normalizeStoredResponse(result.response, birdieId);
  const leaseId = requirePattern(result.leaseId, LEASE_ID_PATTERN, "provider leaseId");
  const expiresAt = Date.parse(String(result.leaseExpiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(requestedAt)) {
    throw new Error("storage.leaseNextResponse returned an invalid lease expiry");
  }
  if (
    result.leaseRequestId !== undefined &&
    result.leaseRequestId !== leaseRequestId
  ) {
    throw new Error("storage.leaseNextResponse returned a mismatched lease request");
  }

  return {
    response,
    leaseId,
    leaseExpiresAt: new Date(expiresAt).toISOString()
  };
}

export function createBirdieAppService({
  storage,
  clock = () => new Date(),
  createLeaseRequestId = () => `lease-request:${randomUUID()}`,
  leaseDurationSeconds = 30
}) {
  const persistentStorage = requireStorage(storage);
  if (
    !Number.isSafeInteger(leaseDurationSeconds) ||
    leaseDurationSeconds < 15 ||
    leaseDurationSeconds > 300
  ) {
    throw new Error("leaseDurationSeconds must be an integer between 15 and 300");
  }
  if (typeof clock !== "function" || typeof createLeaseRequestId !== "function") {
    throw new Error("clock and createLeaseRequestId must be functions");
  }

  async function listProgress(birdieId) {
    const events = await persistentStorage.listApprovedEarnEvents({ birdieId });
    if (!Array.isArray(events)) {
      throw new Error("storage.listApprovedEarnEvents must return an array");
    }
    return projectApprovedEarnLedgerEvents(events, { birdieId });
  }

  return {
    async projectLedgerEvent(input) {
      const event = normalizeApprovedEarnLedgerEvent(input);
      const eventId = ledgerEventId(event.transactionId);
      const response = createBirdieSystemResponse(event);
      const result = await persistentStorage.applyLedgerProjection({
        eventId,
        responseId: birdieResponseId(event.transactionId),
        event,
        response
      });
      assertStoredProjection(result, event, response);

      return {
        applied: result.created,
        eventId,
        responseId: response.responseId,
        progress: await listProgress(event.birdieId),
        response
      };
    },

    async getWorld(authContext) {
      return listProgress(authenticatedBirdieSession(authContext).birdieId);
    },

    async leaseNextResponse(authContext, input = {}) {
      const { birdieId, subject } = authenticatedBirdieSession(authContext);
      const body = requireObject(input, "lease request");
      rejectClientScope(body);

      const requestedAt = isoFromClock(clock);
      const leaseRequestId = requirePattern(
        createLeaseRequestId(),
        LEASE_ID_PATTERN,
        "generated leaseRequestId"
      );
      const result = await persistentStorage.leaseNextResponse({
        birdieId,
        actorSubject: subject,
        leaseRequestId,
        requestedAt,
        leaseSeconds: leaseDurationSeconds
      });
      return validateLeasedResponse(result, birdieId, leaseRequestId, requestedAt);
    },

    async ackResponse(authContext, input) {
      const { birdieId, subject } = authenticatedBirdieSession(authContext);
      const body = requireObject(input, "response acknowledgement");
      rejectClientScope(body);
      const responseId = requirePattern(
        body.responseId,
        RESPONSE_ID_PATTERN,
        "responseId"
      );
      const leaseId = requirePattern(body.leaseId, LEASE_ID_PATTERN, "leaseId");
      const acknowledgedAt = isoFromClock(clock);
      const result = await persistentStorage.ackResponse({
        birdieId,
        actorSubject: subject,
        responseId,
        leaseId,
        acknowledgedAt
      });

      if (!result || typeof result !== "object" || result.acknowledged !== true) {
        throw new Error("storage.ackResponse must return an acknowledged result");
      }
      if (result.birdieId !== birdieId || result.responseId !== responseId) {
        appError("CROSS_BIRDIE_ACCESS", "Response acknowledgement crossed the Birdie scope", 403);
      }

      return {
        responseId,
        acknowledged: true,
        idempotent: result.idempotent === true,
        acknowledgedAt: result.acknowledgedAt || acknowledgedAt
      };
    }
  };
}

export { BirdieWorldProjectionError };
