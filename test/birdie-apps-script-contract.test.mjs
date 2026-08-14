import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../birdie-os/app-world-projection.gs", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

function loadContext(overrides = {}) {
  const context = { ...overrides };
  runInNewContext(source, context);
  return context;
}

test("BirdieWorld declares the two durable sheet schemas", () => {
  const context = loadContext();

  assert.equal(context.BIRDIE_WORLD_SHEETS_.PROJECTIONS, "WORLD_PROJECTIONS");
  assert.equal(
    context.BIRDIE_WORLD_SHEETS_.RESPONSES,
    "BIRDIE_RESPONSE_OUTBOX"
  );
  assert.deepEqual(
    Array.from(context.BIRDIE_WORLD_PROJECTION_HEADERS_),
    [
      "eventId",
      "transactionId",
      "birdieId",
      "amount",
      "transactionType",
      "actionCode",
      "sourceType",
      "sourceReference",
      "status",
      "approvedAt",
      "createdAt",
      "projectedAt",
      "projectionVersion",
      "idempotencyKey"
    ]
  );
  assert.deepEqual(
    Array.from(context.BIRDIE_WORLD_RESPONSE_HEADERS_),
    [
      "responseId",
      "eventId",
      "transactionId",
      "birdieId",
      "kind",
      "payloadJson",
      "status",
      "createdAt",
      "availableAt",
      "leaseId",
      "leaseOwner",
      "leasedAt",
      "leaseExpiresAt",
      "attemptCount",
      "acknowledgedAt",
      "ackedBy",
      "lastError",
      "idempotencyKey"
    ]
  );
});

test("projection and response identifiers are stable ledger derivatives", () => {
  const context = loadContext();

  assert.equal(context.birdieWorldEventId_("TX-123"), "coin:TX-123");
  assert.equal(
    context.birdieWorldResponseId_("TX-123"),
    "birdie-response:TX-123"
  );
  assert.match(
    source,
    /idempotencyKey: eventId/
  );
  assert.match(
    source,
    /idempotencyKey: responseId/
  );
});

test("public projection reads the canonical transaction under ScriptLock", () => {
  const implementation = functionSource(
    "birdieWorldProjectApprovedEarn_",
    "birdieWorldReconcileFromCanonicalLedger_"
  );

  assert.match(implementation, /birdieWorldRequireAuthScope_/);
  assert.match(implementation, /BIRDIE_WORLD_SCOPES_\.PROJECT/);
  assert.match(implementation, /LockService\.getScriptLock\(\)/);
  assert.match(implementation, /lock\.waitLock\(20000\)/);
  assert.match(
    implementation,
    /birdieWorldRequireCanonicalTransaction_\(transactionId\)/
  );
  assert.match(
    implementation,
    /birdieWorldProjectApprovedEarnUnderLock_\(transaction\)/
  );
  assert.match(implementation, /finally\s*{\s*lock\.releaseLock\(\)/);
  assert.doesNotMatch(implementation, /request\.amount/);
  assert.doesNotMatch(implementation, /request\.birdieId/);
});

test("eligibility is limited to APPROVED EARN transactions", () => {
  const context = loadContext();
  const base = {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "COMMENT-1",
    status: "APPROVED"
  };

  assert.equal(context.birdieWorldIsApprovedEarn_(base), true);
  assert.equal(
    context.birdieWorldIsApprovedEarn_({ ...base, status: "PENDING" }),
    false
  );
  assert.equal(
    context.birdieWorldIsApprovedEarn_({
      ...base,
      transactionType: "ADJUSTMENT"
    }),
    false
  );

  const implementation = functionSource(
    "birdieWorldProjectApprovedEarnUnderLock_",
    "birdieWorldListApprovedEarnEvents_"
  );
  assert.match(implementation, /reason: "NOT_APPROVED_EARN"/);
  assert.match(implementation, /reason: "BEFORE_BIRDIE_WORLD_CUTOVER"/);
  assert.match(implementation, /transactionType: "EARN"/);
  assert.match(implementation, /status: "APPROVED"/);
  assert.match(implementation, /kind: "COIN_EARNED"/);
});

test("projection cutover suppresses historical earn-response backfill", () => {
  const context = loadContext({
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            assert.equal(name, "BIRDIE_WORLD_V1_CUTOVER_AT");
            return "2026-08-14T10:00:00.000Z";
          }
        };
      }
    }
  });

  assert.equal(context.birdieWorldIsAtOrAfterCutover_({
    approvedAt: "2026-08-14T09:59:59.999Z"
  }), false);
  assert.equal(context.birdieWorldIsAtOrAfterCutover_({
    approvedAt: "2026-08-14T10:00:00.000Z"
  }), true);

  const missing = loadContext({
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => "" })
    }
  });
  assert.throws(
    () => missing.birdieWorldIsAtOrAfterCutover_({
      approvedAt: "2026-08-14T10:00:00.000Z"
    }),
    /BIRDIE_WORLD_V1_CUTOVER_AT_MISSING/
  );
});

test("Apps Script emits the same deterministic DTO used by the Birdie app core", () => {
  const context = loadContext();
  const canonical = context.birdieWorldCanonicalEarn_({
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "COMMENT-1",
    status: "APPROVED",
    approvedAt: "2026-08-14T12:01:00+02:00",
    createdAt: "2026-08-14T12:00:00+02:00"
  });
  assert.deepEqual(structuredClone(canonical), {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "COMMENT-1",
    status: "APPROVED",
    approvedAt: "2026-08-14T10:01:00.000Z",
    createdAt: "2026-08-14T10:00:00.000Z"
  });
  assert.deepEqual(
    structuredClone(context.birdieWorldResponsePayload_(canonical)),
    {
      schemaVersion: "birdie-system-response/v1",
      responseId: "birdie-response:TX-1",
      eventId: "coin:TX-1",
      birdieId: "BIRDIE-1",
      kind: "COIN_EARNED",
      language: "de-DE",
      amount: 1,
      actionCode: "IG_COMMENT",
      text: "+1 Birdie ist angekommen."
    }
  );
});

test("projection has duplicate guards and creates exactly one response row", () => {
  const implementation = functionSource(
    "birdieWorldProjectApprovedEarnUnderLock_",
    "birdieWorldListApprovedEarnEvents_"
  );

  assert.match(
    implementation,
    /birdieWorldFindUniqueProjectionForTransaction_\(\s*projectionSheet,\s*canonical/
  );
  assert.match(
    implementation,
    /birdieWorldFindUniqueResponseForTransaction_\(\s*responseSheet,\s*canonical/
  );
  assert.match(implementation, /if \(projectionFound\)/);
  assert.match(implementation, /if \(responseFound\)/);
  assert.match(implementation, /birdieWorldRequireProjectionMatches_/);
  assert.match(implementation, /birdieWorldRequireResponseMatches_/);

  const appendCalls = implementation.match(/birdieWorldAppendObject_\(/g) || [];
  assert.equal(appendCalls.length, 2);
  assert.match(implementation, /WORLD_PROJECTION_READBACK_MISMATCH/);
  assert.match(implementation, /BIRDIE_RESPONSE_READBACK_MISMATCH/);
  assert.match(
    source,
    /String\(found\.object\.transactionId\) === canonical\.transactionId/
  );
  assert.match(source, /if \(matches\.length > 1\) throw new Error\("WORLD_PROJECTION_DUPLICATE"\)/);
  assert.match(source, /if \(matches\.length > 1\) throw new Error\("BIRDIE_RESPONSE_DUPLICATE"\)/);
});

test("reconciliation scans the canonical ledger and reuses idempotent projection", () => {
  const implementation = functionSource(
    "birdieWorldReconcileFromCanonicalLedger_",
    "birdieWorldProjectApprovedEarnUnderLock_"
  );

  assert.match(implementation, /BIRDIE_WORLD_SCOPES_\.RECONCILE/);
  assert.match(implementation, /LockService\.getScriptLock\(\)/);
  assert.match(implementation, /birdieWorldCanonicalTransactions_\(\)/);
  assert.match(implementation, /birdieWorldRequireUniqueTransactionIds_/);
  assert.match(implementation, /birdieWorldIsApprovedEarn_\(transaction\)/);
  assert.match(implementation, /birdieWorldIsAtOrAfterCutover_\(transaction\)/);
  assert.match(
    implementation,
    /birdieWorldProjectApprovedEarnUnderLock_\(transaction\)/
  );
  assert.match(implementation, /alreadyProjected/);
  assert.match(implementation, /finally\s*{\s*lock\.releaseLock\(\)/);
  assert.match(source, /TRANSACTIONS: "COIN_TRANSACTIONS"/);
  assert.match(source, /"BIRDIE_WORLD_V1_CUTOVER_AT"/);
});

test("response leasing is scoped, locked, recoverable and request-idempotent", () => {
  const implementation = functionSource(
    "birdieWorldLeaseNextResponse_",
    "birdieWorldAckResponse_"
  );

  assert.match(implementation, /BIRDIE_WORLD_SCOPES_\.LEASE/);
  assert.match(implementation, /birdieId/);
  assert.match(implementation, /request\.leaseId/);
  assert.match(implementation, /request\.leasedAt/);
  assert.match(implementation, /request\.leaseExpiresAt/);
  assert.match(implementation, /LockService\.getScriptLock\(\)/);
  assert.match(implementation, /birdieWorldRequireUniqueResponseIds_/);
  assert.match(implementation, /String\(response\.status\) === "READY"/);
  assert.match(implementation, /String\(response\.status\) === "LEASED"/);
  assert.match(implementation, /birdieWorldLeaseExpired_/);
  assert.match(implementation, /response\.status = "LEASED"/);
  assert.match(implementation, /response\.leaseId = leaseId/);
  assert.match(implementation, /response\.leasedAt = leasedAt/);
  assert.match(implementation, /response\.leaseExpiresAt = leaseExpiresAt/);
  assert.match(implementation, /response\.attemptCount/);
  assert.match(implementation, /BIRDIE_RESPONSE_LEASE_ID_CONFLICT/);
  assert.match(implementation, /BIRDIE_RESPONSE_LEASE_READBACK_MISMATCH/);
  assert.match(implementation, /finally\s*{\s*lock\.releaseLock\(\)/);

  const context = loadContext();
  assert.deepEqual(
    structuredClone(context.birdieWorldLeaseEnvelope_({
      responseId: "birdie-response:TX-1",
      eventId: "coin:TX-1",
      birdieId: "BIRDIE-1",
      payloadJson: JSON.stringify({
        schemaVersion: "birdie-system-response/v1",
        responseId: "birdie-response:TX-1",
        eventId: "coin:TX-1",
        birdieId: "BIRDIE-1",
        kind: "COIN_EARNED",
        language: "de-DE",
        amount: 1,
        actionCode: "IG_COMMENT",
        text: "+1 Birdie ist angekommen."
      }),
      leaseId: "lease:test-1",
      leaseExpiresAt: "2026-08-14T10:05:30.000Z"
    })),
    {
      response: {
        schemaVersion: "birdie-system-response/v1",
        responseId: "birdie-response:TX-1",
        eventId: "coin:TX-1",
        birdieId: "BIRDIE-1",
        kind: "COIN_EARNED",
        language: "de-DE",
        amount: 1,
        actionCode: "IG_COMMENT",
        text: "+1 Birdie ist angekommen."
      },
      leaseId: "lease:test-1",
      leaseExpiresAt: "2026-08-14T10:05:30.000Z"
    }
  );
});

test("ACK requires the exact active lease and is idempotent after success", () => {
  const implementation = functionSource(
    "birdieWorldAckResponse_",
    "birdieWorldEventId_"
  );

  assert.match(implementation, /BIRDIE_WORLD_SCOPES_\.ACK/);
  assert.match(implementation, /LockService\.getScriptLock\(\)/);
  assert.match(implementation, /String\(response\.status\) === "ACKED"/);
  assert.match(implementation, /idempotent: true/);
  assert.match(implementation, /String\(response\.status\) !== "LEASED"/);
  assert.match(implementation, /request\.leaseId/);
  assert.match(implementation, /request\.acknowledgedAt/);
  assert.match(implementation, /BIRDIE_RESPONSE_LEASE_MISMATCH/);
  assert.match(implementation, /BIRDIE_RESPONSE_LEASE_EXPIRED/);
  assert.match(implementation, /response\.status = "ACKED"/);
  assert.match(implementation, /response\.acknowledgedAt = acknowledgedAt/);
  assert.match(implementation, /response\.ackedBy = String\(auth\.subject\)/);
  assert.match(implementation, /BIRDIE_RESPONSE_ACK_READBACK_MISMATCH/);
  assert.match(implementation, /finally\s*{\s*lock\.releaseLock\(\)/);
});

test("dispatcher auth wrapper fails closed and binds scope to the exact request", () => {
  const context = loadContext();
  assert.throws(
    () => context.birdieWorldRequireAuthScope_(
      { action: "worldLeaseResponses" },
      "birdie-world:responses:lease",
      "BIRDIE-1"
    ),
    /BIRDIE_WORLD_AUTH_UNVERIFIED/
  );

  const request = {
    action: "worldLeaseResponses",
    source: "Birdie Agent BirdieWorld V1",
    authSubject: "auth0|birdie-1",
    authBirdieId: "BIRDIE-1"
  };
  context.BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_ = {
    request,
    action: request.action,
    subject: request.authSubject,
    birdieId: request.authBirdieId,
    scope: "birdie-world:responses:lease"
  };
  const authorized = context.birdieWorldRequireAuthScope_(
    request,
    "birdie-world:responses:lease",
    "BIRDIE-1"
  );
  assert.equal(authorized.subject, "auth0|birdie-1");

  assert.throws(
    () => context.birdieWorldRequireAuthScope_(
      { ...request },
      "birdie-world:responses:lease",
      "BIRDIE-1"
    ),
    /BIRDIE_WORLD_AUTH_UNVERIFIED/
  );
  assert.throws(
    () => context.birdieWorldRequireAuthScope_(
      request,
      "birdie-world:responses:lease",
      "BIRDIE-2"
    ),
    /BIRDIE_WORLD_BIRDIE_SCOPE_MISMATCH/
  );

  assert.equal(
    context.birdieWorldAuthorizedScopeForAction_("worldAckResponse"),
    "birdie-world:responses:ack"
  );
  assert.throws(
    () => context.birdieWorldAuthorizedScopeForAction_("coinGetLedger"),
    /UNKNOWN_BIRDIE_WORLD_ACTION/
  );

  const wrapper = functionSource(
    "handleBirdieWorldAuthorizedAction_",
    "birdieWorldAuthorizedScopeForAction_"
  );
  assert.match(wrapper, /BIRDIE_WORLD_TRUSTED_SOURCE_REQUIRED/);
  assert.match(wrapper, /BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_/);
  assert.match(wrapper, /handleBirdieWorldProjectionAction_\(request\)/);
  assert.match(wrapper, /finally/);
});
