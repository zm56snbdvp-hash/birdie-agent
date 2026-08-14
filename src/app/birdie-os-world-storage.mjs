const BIRDIE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SUBJECT_PATTERN = /^[^\s]{1,300}$/;

export class BirdieOsWorldStorageError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "BirdieOsWorldStorageError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new BirdieOsWorldStorageError(code, message, status);
}

function requirePattern(value, pattern, field) {
  const normalized = String(value ?? "").trim();
  if (!pattern.test(normalized)) {
    fail("BIRDIE_OS_WORLD_RESPONSE_INVALID", `Invalid ${field}`);
  }
  return normalized;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("BIRDIE_OS_WORLD_RESPONSE_INVALID", `${label} must be an object`);
  }
  return value;
}

function responseData(result, label, { nullable = false } = {}) {
  if (!result || typeof result !== "object" || !("data" in result)) {
    fail("BIRDIE_OS_WORLD_RESPONSE_INVALID", `${label} returned no data envelope`);
  }
  if (nullable && result.data === null) return null;
  return requireObject(result.data, `${label} data`);
}

function actorFields(subject, birdieId = "") {
  return {
    authSubject: requirePattern(
      subject || "birdie-agent",
      SUBJECT_PATTERN,
      "authSubject"
    ),
    authBirdieId: birdieId
      ? requirePattern(birdieId, BIRDIE_ID_PATTERN, "authBirdieId")
      : "",
    source: "Birdie Agent BirdieWorld V1"
  };
}

function leaseExpiry(requestedAt, leaseSeconds) {
  const started = Date.parse(String(requestedAt || ""));
  if (!Number.isFinite(started)) {
    fail("INVALID_BIRDIE_RESPONSE_LEASE", "requestedAt is invalid", 400);
  }
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
    fail("INVALID_BIRDIE_RESPONSE_LEASE", "leaseSeconds is invalid", 400);
  }
  return new Date(started + leaseSeconds * 1000).toISOString();
}

function canonicalApprovedEarnTransactions(ledger, birdieId) {
  if (String(ledger.birdieId ?? "") !== birdieId) {
    fail(
      "BIRDIE_OS_LEDGER_SCOPE_MISMATCH",
      "BirdieOS returned a ledger for another Birdie"
    );
  }
  if (!Array.isArray(ledger.transactions)) {
    fail("BIRDIE_OS_WORLD_RESPONSE_INVALID", "Ledger transactions must be an array");
  }

  const transactions = [];
  const fingerprints = new Map();
  for (const transaction of ledger.transactions) {
    const row = requireObject(transaction, "ledger transaction");
    if (String(row.birdieId ?? "") !== birdieId) {
      fail(
        "BIRDIE_OS_LEDGER_SCOPE_MISMATCH",
        "BirdieOS returned a transaction for another Birdie"
      );
    }
    const transactionId = requirePattern(
      row.transactionId,
      IDENTIFIER_PATTERN,
      "transactionId"
    );
    const fingerprint = JSON.stringify(row);
    const previous = fingerprints.get(transactionId);
    if (previous) {
      fail(
        previous === fingerprint
          ? "BIRDIE_OS_LEDGER_TRANSACTION_DUPLICATE"
          : "BIRDIE_OS_LEDGER_TRANSACTION_CONFLICT",
        `BirdieOS returned more than one row for ${transactionId}`
      );
    }
    fingerprints.set(transactionId, fingerprint);

    if (row.status === "APPROVED" && row.transactionType === "EARN") {
      transactions.push(row);
    }
  }
  return transactions;
}

export function createBirdieOsWorldStorage({
  birdieOSGet,
  birdieOSPost,
  reconcilerSubject = "birdie-agent"
}) {
  if (typeof birdieOSGet !== "function") throw new Error("birdieOSGet is required");
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");
  requirePattern(reconcilerSubject, SUBJECT_PATTERN, "reconcilerSubject");

  return {
    async listApprovedEarnEvents({ birdieId }) {
      const scopedBirdieId = requirePattern(birdieId, BIRDIE_ID_PATTERN, "birdieId");
      const result = await birdieOSGet("coinGetLedger", { birdieId: scopedBirdieId });
      const ledger = responseData(result, "coinGetLedger");
      return canonicalApprovedEarnTransactions(ledger, scopedBirdieId);
    },

    async applyLedgerProjection({ event }) {
      const canonicalEvent = requireObject(event, "canonical event");
      const transactionId = requirePattern(
        canonicalEvent.transactionId,
        IDENTIFIER_PATTERN,
        "transactionId"
      );
      const result = await birdieOSPost({
        action: "worldProjectTransaction",
        transactionId,
        ...actorFields(reconcilerSubject)
      });
      const data = responseData(result, "worldProjectTransaction");
      if (data.eligible !== true) {
        fail(
          "BIRDIE_WORLD_TRANSACTION_INELIGIBLE",
          `BirdieOS rejected the transaction: ${data.reason || "INELIGIBLE"}`,
          409
        );
      }
      return data;
    },

    async leaseNextResponse({
      birdieId,
      actorSubject,
      leaseRequestId,
      requestedAt,
      leaseSeconds
    }) {
      const scopedBirdieId = requirePattern(birdieId, BIRDIE_ID_PATTERN, "birdieId");
      const leaseId = requirePattern(leaseRequestId, IDENTIFIER_PATTERN, "leaseRequestId");
      const leasedAt = new Date(Date.parse(String(requestedAt || ""))).toISOString();
      const leaseExpiresAt = leaseExpiry(leasedAt, leaseSeconds);
      const result = await birdieOSPost({
        action: "worldLeaseResponses",
        birdieId: scopedBirdieId,
        leaseId,
        leasedAt,
        leaseExpiresAt,
        ...actorFields(actorSubject || reconcilerSubject, scopedBirdieId)
      });
      const data = responseData(result, "worldLeaseResponses", { nullable: true });
      if (data === null) return null;
      return { ...data, leaseRequestId };
    },

    async ackResponse({
      birdieId,
      actorSubject,
      responseId,
      leaseId,
      acknowledgedAt
    }) {
      const scopedBirdieId = requirePattern(birdieId, BIRDIE_ID_PATTERN, "birdieId");
      const result = await birdieOSPost({
        action: "worldAckResponse",
        birdieId: scopedBirdieId,
        responseId: requirePattern(responseId, IDENTIFIER_PATTERN, "responseId"),
        leaseId: requirePattern(leaseId, IDENTIFIER_PATTERN, "leaseId"),
        acknowledgedAt: new Date(Date.parse(String(acknowledgedAt || ""))).toISOString(),
        ...actorFields(actorSubject || reconcilerSubject, scopedBirdieId)
      });
      return responseData(result, "worldAckResponse");
    },

    async reconcile() {
      const result = await birdieOSPost({
        action: "worldReconcileLedger",
        ...actorFields(reconcilerSubject)
      });
      return responseData(result, "worldReconcileLedger");
    }
  };
}
