/**
 * BIRDIE OS — BirdieWorld Ledger Projection V1
 *
 * Persists an append-only BirdieWorld projection and a durable response outbox
 * from the canonical COIN_TRANSACTIONS ledger. Only APPROVED EARN
 * transactions are eligible. The public entry points acquire ScriptLock and
 * read the canonical transaction by transactionId; callers cannot inject an
 * economic payload.
 *
 * After validating the canonical BirdieOS API key, the dispatcher must route
 * these actions through handleBirdieWorldAuthorizedAction_(request), never
 * directly through handleBirdieWorldProjectionAction_. The wrapper creates a
 * synchronous in-process auth context for this exact request object. Raw
 * client input cannot set or replay that context, and direct handler calls
 * fail closed.
 */

var BIRDIE_WORLD_PROJECTION_VERSION_ = "V1";
var BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_ = null;

var BIRDIE_WORLD_SHEETS_ = {
  TRANSACTIONS: "COIN_TRANSACTIONS",
  PROJECTIONS: "WORLD_PROJECTIONS",
  RESPONSES: "BIRDIE_RESPONSE_OUTBOX"
};

var BIRDIE_WORLD_PROJECTION_HEADERS_ = [
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
];

var BIRDIE_WORLD_RESPONSE_HEADERS_ = [
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
];

var BIRDIE_WORLD_REQUIRED_TRANSACTION_HEADERS_ = [
  "transactionId",
  "birdieId",
  "amount",
  "transactionType",
  "actionCode",
  "sourceType",
  "sourceReference",
  "status",
  "approvedAt"
];

var BIRDIE_WORLD_SCOPES_ = {
  PROJECT: "birdie-world:projection:write",
  RECONCILE: "birdie-world:projection:reconcile",
  READ: "birdie-world:projection:read",
  LEASE: "birdie-world:responses:lease",
  ACK: "birdie-world:responses:ack",
  ADMIN: "birdie-world:admin"
};

function setupBirdieWorldProjectionSystem_() {
  var spreadsheet = birdieWorldSpreadsheet_();
  birdieWorldEnsureSheet_(
    spreadsheet,
    BIRDIE_WORLD_SHEETS_.PROJECTIONS,
    BIRDIE_WORLD_PROJECTION_HEADERS_
  );
  birdieWorldEnsureSheet_(
    spreadsheet,
    BIRDIE_WORLD_SHEETS_.RESPONSES,
    BIRDIE_WORLD_RESPONSE_HEADERS_
  );
  birdieWorldRequireTransactionSheet_();
  return {
    success: true,
    data: {
      initialized: true,
      projectionVersion: BIRDIE_WORLD_PROJECTION_VERSION_
    }
  };
}

function handleBirdieWorldAuthorizedAction_(request) {
  request = request || {};
  if (String(request.source || "") !== "Birdie Agent BirdieWorld V1") {
    throw new Error("BIRDIE_WORLD_TRUSTED_SOURCE_REQUIRED");
  }
  var action = String(request.action || "");
  var scope = birdieWorldAuthorizedScopeForAction_(action);
  var subject = birdieWorldRequired_(request.authSubject, "authSubject");
  if (!/^[^\s]{1,300}$/.test(subject)) {
    throw new Error("INVALID_BIRDIE_WORLD_AUTH_SUBJECT");
  }
  var birdieId = String(request.authBirdieId || "").trim();
  if (
    (
      scope === BIRDIE_WORLD_SCOPES_.READ ||
      scope === BIRDIE_WORLD_SCOPES_.LEASE ||
      scope === BIRDIE_WORLD_SCOPES_.ACK
    ) &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(birdieId)
  ) {
    throw new Error("INVALID_BIRDIE_WORLD_AUTH_BIRDIE_ID");
  }

  var previous = BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_;
  BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_ = {
    request: request,
    action: action,
    subject: subject,
    birdieId: birdieId,
    scope: scope
  };
  try {
    return handleBirdieWorldProjectionAction_(request);
  } finally {
    BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_ = previous;
  }
}

function birdieWorldAuthorizedScopeForAction_(action) {
  switch (String(action || "")) {
    case "worldProjectTransaction":
      return BIRDIE_WORLD_SCOPES_.PROJECT;
    case "worldReconcileLedger":
      return BIRDIE_WORLD_SCOPES_.RECONCILE;
    case "worldListApprovedEarnEvents":
      return BIRDIE_WORLD_SCOPES_.READ;
    case "worldLeaseNextResponse":
    case "worldLeaseResponses":
      return BIRDIE_WORLD_SCOPES_.LEASE;
    case "worldAckResponse":
      return BIRDIE_WORLD_SCOPES_.ACK;
    default:
      throw new Error("UNKNOWN_BIRDIE_WORLD_ACTION");
  }
}

function birdieWorldAuthScopeHook_(input) {
  var context = BIRDIE_WORLD_ACTIVE_AUTH_CONTEXT_;
  if (
    !context ||
    context.request !== input.request ||
    context.action !== String(input.request.action || "") ||
    context.scope !== input.requiredScope
  ) {
    throw new Error("BIRDIE_WORLD_AUTH_UNVERIFIED");
  }
  return {
    verified: true,
    subject: context.subject,
    birdieId: context.birdieId,
    scopes: [context.scope]
  };
}

function handleBirdieWorldProjectionAction_(request) {
  request = request || {};
  switch (String(request.action || "")) {
    case "worldProjectTransaction":
      return birdieWorldProjectApprovedEarn_(request);
    case "worldReconcileLedger":
      return birdieWorldReconcileFromCanonicalLedger_(request);
    case "worldListApprovedEarnEvents":
      return birdieWorldListApprovedEarnEvents_(request);
    case "worldLeaseNextResponse":
    case "worldLeaseResponses":
      return birdieWorldLeaseNextResponse_(request);
    case "worldAckResponse":
      return birdieWorldAckResponse_(request);
    default:
      throw new Error("UNKNOWN_BIRDIE_WORLD_ACTION");
  }
}

function birdieWorldProjectApprovedEarn_(request) {
  request = request || {};
  birdieWorldRequireAuthScope_(
    request,
    BIRDIE_WORLD_SCOPES_.PROJECT,
    ""
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupBirdieWorldProjectionSystem_();
    var transactionId = birdieWorldRequired_(
      request.transactionId,
      "transactionId"
    );
    var transaction = birdieWorldRequireCanonicalTransaction_(transactionId);
    return {
      success: true,
      data: birdieWorldProjectApprovedEarnUnderLock_(transaction)
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldReconcileFromCanonicalLedger_(request) {
  request = request || {};
  birdieWorldRequireAuthScope_(
    request,
    BIRDIE_WORLD_SCOPES_.RECONCILE,
    ""
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupBirdieWorldProjectionSystem_();
    var transactions = birdieWorldCanonicalTransactions_();
    birdieWorldRequireUniqueTransactionIds_(transactions);

    var result = {
      scanned: transactions.length,
      eligible: 0,
      skipped: 0,
      projectionsCreated: 0,
      responsesCreated: 0,
      alreadyProjected: 0
    };

    transactions.forEach(function (transaction) {
      if (
        !birdieWorldIsApprovedEarn_(transaction) ||
        !birdieWorldIsAtOrAfterCutover_(transaction)
      ) {
        result.skipped += 1;
        return;
      }

      result.eligible += 1;
      var projected = birdieWorldProjectApprovedEarnUnderLock_(transaction);
      if (projected.projectionCreated) result.projectionsCreated += 1;
      if (projected.responseCreated) result.responsesCreated += 1;
      if (!projected.projectionCreated && !projected.responseCreated) {
        result.alreadyProjected += 1;
      }
    });

    return { success: true, data: result };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldProjectApprovedEarnUnderLock_(transaction) {
  if (!birdieWorldIsApprovedEarn_(transaction)) {
    return {
      eligible: false,
      reason: "NOT_APPROVED_EARN",
      projectionCreated: false,
      responseCreated: false,
      created: false
    };
  }
  if (!birdieWorldIsAtOrAfterCutover_(transaction)) {
    return {
      eligible: false,
      reason: "BEFORE_BIRDIE_WORLD_CUTOVER",
      projectionCreated: false,
      responseCreated: false,
      created: false
    };
  }

  var canonical = birdieWorldCanonicalEarn_(transaction);
  var eventId = birdieWorldEventId_(canonical.transactionId);
  var responseId = birdieWorldResponseId_(canonical.transactionId);
  var projectionSheet = birdieWorldSheet_(
    BIRDIE_WORLD_SHEETS_.PROJECTIONS
  );
  var responseSheet = birdieWorldSheet_(BIRDIE_WORLD_SHEETS_.RESPONSES);
  var projectionFound = birdieWorldFindUniqueProjectionForTransaction_(
    projectionSheet,
    canonical
  );
  var projectionCreated = false;
  var projectedAt;

  if (projectionFound) {
    birdieWorldRequireProjectionMatches_(projectionFound.object, canonical);
    projectedAt = String(projectionFound.object.projectedAt || "");
  } else {
    projectedAt = birdieWorldNow_();
    birdieWorldAppendObject_(projectionSheet, {
      eventId: eventId,
      transactionId: canonical.transactionId,
      birdieId: canonical.birdieId,
      amount: canonical.amount,
      transactionType: "EARN",
      actionCode: canonical.actionCode,
      sourceType: canonical.sourceType,
      sourceReference: canonical.sourceReference,
      status: "APPROVED",
      approvedAt: canonical.approvedAt,
      createdAt: canonical.createdAt || "",
      projectedAt: projectedAt,
      projectionVersion: BIRDIE_WORLD_PROJECTION_VERSION_,
      idempotencyKey: eventId
    });
    SpreadsheetApp.flush();
    projectionFound = birdieWorldFindUniqueProjectionForTransaction_(
      projectionSheet,
      canonical
    );
    if (!projectionFound) throw new Error("WORLD_PROJECTION_READBACK_MISMATCH");
    birdieWorldRequireProjectionMatches_(projectionFound.object, canonical);
    projectionCreated = true;
  }

  var responseFound = birdieWorldFindUniqueResponseForTransaction_(
    responseSheet,
    canonical
  );
  var responseCreated = false;
  var expectedPayload = birdieWorldResponsePayload_(canonical);
  var expectedPayloadJson = JSON.stringify(expectedPayload);

  if (responseFound) {
    birdieWorldRequireResponseMatches_(
      responseFound.object,
      canonical,
      expectedPayloadJson
    );
  } else {
    birdieWorldAppendObject_(responseSheet, {
      responseId: responseId,
      eventId: eventId,
      transactionId: canonical.transactionId,
      birdieId: canonical.birdieId,
      kind: "COIN_EARNED",
      payloadJson: expectedPayloadJson,
      status: "READY",
      createdAt: projectedAt || birdieWorldNow_(),
      availableAt: projectedAt || birdieWorldNow_(),
      leaseId: "",
      leaseOwner: "",
      leasedAt: "",
      leaseExpiresAt: "",
      attemptCount: 0,
      acknowledgedAt: "",
      ackedBy: "",
      lastError: "",
      idempotencyKey: responseId
    });
    SpreadsheetApp.flush();
    responseFound = birdieWorldFindUniqueResponseForTransaction_(
      responseSheet,
      canonical
    );
    if (!responseFound) throw new Error("BIRDIE_RESPONSE_READBACK_MISMATCH");
    birdieWorldRequireResponseMatches_(
      responseFound.object,
      canonical,
      expectedPayloadJson
    );
    responseCreated = true;
  }

  return {
    eligible: true,
    eventId: eventId,
    responseId: responseId,
    birdieId: canonical.birdieId,
    transactionId: canonical.transactionId,
    projectionCreated: projectionCreated,
    responseCreated: responseCreated,
    created: projectionCreated || responseCreated,
    event: birdieWorldProjectionEventView_(projectionFound.object),
    response: birdieWorldResponseDto_(responseFound.object)
  };
}

function birdieWorldListApprovedEarnEvents_(request) {
  request = request || {};
  var birdieId = birdieWorldRequired_(request.birdieId, "birdieId");
  birdieWorldRequireAuthScope_(
    request,
    BIRDIE_WORLD_SCOPES_.READ,
    birdieId
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupBirdieWorldProjectionSystem_();
    var projections = birdieWorldObjects_(
      birdieWorldSheet_(BIRDIE_WORLD_SHEETS_.PROJECTIONS)
    );
    birdieWorldRequireUniqueProjectionIds_(projections);
    var events = projections.filter(function (projection) {
      return String(projection.birdieId) === birdieId;
    }).sort(function (left, right) {
      return String(left.eventId).localeCompare(String(right.eventId));
    }).map(birdieWorldProjectionEventView_);
    return {
      success: true,
      data: events
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldLeaseNextResponse_(request) {
  request = request || {};
  var birdieId = birdieWorldRequired_(request.birdieId, "birdieId");
  var auth = birdieWorldRequireAuthScope_(
    request,
    BIRDIE_WORLD_SCOPES_.LEASE,
    birdieId
  );
  var leaseId = birdieWorldRequired_(request.leaseId, "leaseId");
  var leasedAt = birdieWorldTimestamp_(request.leasedAt, "leasedAt");
  var leaseExpiresAt = birdieWorldTimestamp_(
    request.leaseExpiresAt,
    "leaseExpiresAt"
  );
  if (new Date(leaseExpiresAt).getTime() <= new Date(leasedAt).getTime()) {
    throw new Error("INVALID_BIRDIE_RESPONSE_LEASE_WINDOW");
  }

  var leaseOwner = String(auth.subject);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupBirdieWorldProjectionSystem_();
    var sheet = birdieWorldSheet_(BIRDIE_WORLD_SHEETS_.RESPONSES);
    var rows = birdieWorldObjectsWithRows_(sheet);
    birdieWorldRequireUniqueResponseIds_(rows.map(function (row) {
      return row.object;
    }));

    var existingLease = rows.filter(function (found) {
      return String(found.object.leaseId || "") === leaseId;
    });
    if (existingLease.length > 1) {
      throw new Error("BIRDIE_RESPONSE_LEASE_ID_CONFLICT");
    }
    if (existingLease.length === 1) {
      var leasedResponse = existingLease[0].object;
      if (
        String(leasedResponse.birdieId) !== birdieId ||
        String(leasedResponse.leaseOwner) !== leaseOwner ||
        String(leasedResponse.status) !== "LEASED" ||
        String(leasedResponse.leasedAt) !== leasedAt ||
        String(leasedResponse.leaseExpiresAt) !== leaseExpiresAt ||
        birdieWorldLeaseExpired_(leasedResponse, leasedAt)
      ) {
        throw new Error("BIRDIE_RESPONSE_LEASE_ID_CONFLICT");
      }
      return {
        success: true,
        data: birdieWorldLeaseEnvelope_(leasedResponse)
      };
    }

    var candidate = rows.filter(function (found) {
      var response = found.object;
      if (String(response.birdieId) !== birdieId) return false;
      return String(response.status) === "READY" ||
        (
          String(response.status) === "LEASED" &&
          birdieWorldLeaseExpired_(response, leasedAt)
        );
    }).sort(function (left, right) {
      return String(left.object.responseId).localeCompare(
        String(right.object.responseId)
      );
    })[0];

    if (!candidate) return { success: true, data: null };

    var response = candidate.object;
    response.status = "LEASED";
    response.leaseId = leaseId;
    response.leaseOwner = leaseOwner;
    response.leasedAt = leasedAt;
    response.leaseExpiresAt = leaseExpiresAt;
    response.attemptCount = (Number(response.attemptCount) || 0) + 1;
    response.lastError = "";
    birdieWorldWriteObject_(sheet, candidate.row, response);
    SpreadsheetApp.flush();

    var readback = birdieWorldFindUnique_(
      sheet,
      "responseId",
      response.responseId,
      "BIRDIE_RESPONSE_DUPLICATE"
    );
    if (
      !readback ||
      String(readback.object.status) !== "LEASED" ||
      String(readback.object.leaseId) !== leaseId ||
      String(readback.object.leasedAt) !== leasedAt ||
      String(readback.object.leaseExpiresAt) !== leaseExpiresAt
    ) {
      throw new Error("BIRDIE_RESPONSE_LEASE_READBACK_MISMATCH");
    }

    return {
      success: true,
      data: birdieWorldLeaseEnvelope_(readback.object)
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldAckResponse_(request) {
  request = request || {};
  var responseId = birdieWorldRequired_(request.responseId, "responseId");
  var leaseId = birdieWorldRequired_(request.leaseId, "leaseId");
  var acknowledgedAt = birdieWorldTimestamp_(
    request.acknowledgedAt,
    "acknowledgedAt"
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupBirdieWorldProjectionSystem_();
    var sheet = birdieWorldSheet_(BIRDIE_WORLD_SHEETS_.RESPONSES);
    var found = birdieWorldFindUnique_(
      sheet,
      "responseId",
      responseId,
      "BIRDIE_RESPONSE_DUPLICATE"
    );
    if (!found) throw new Error("BIRDIE_RESPONSE_NOT_FOUND");

    var response = found.object;
    var auth = birdieWorldRequireAuthScope_(
      request,
      BIRDIE_WORLD_SCOPES_.ACK,
      String(response.birdieId)
    );
    if (
      String(response.status) === "ACKED" &&
      String(response.leaseId) === leaseId
    ) {
      return {
        success: true,
        data: {
          acknowledged: true,
          idempotent: true,
          birdieId: String(response.birdieId),
          responseId: responseId,
          acknowledgedAt: String(response.acknowledgedAt)
        }
      };
    }
    if (String(response.status) !== "LEASED") {
      throw new Error("BIRDIE_RESPONSE_NOT_LEASED");
    }
    if (
      String(response.leaseId) !== leaseId
    ) {
      throw new Error("BIRDIE_RESPONSE_LEASE_MISMATCH");
    }

    if (birdieWorldLeaseExpired_(response, acknowledgedAt)) {
      throw new Error("BIRDIE_RESPONSE_LEASE_EXPIRED");
    }

    response.status = "ACKED";
    response.acknowledgedAt = acknowledgedAt;
    response.ackedBy = String(auth.subject);
    birdieWorldWriteObject_(sheet, found.row, response);
    SpreadsheetApp.flush();

    var readback = birdieWorldFindUnique_(
      sheet,
      "responseId",
      responseId,
      "BIRDIE_RESPONSE_DUPLICATE"
    );
    if (
      !readback ||
      String(readback.object.status) !== "ACKED" ||
      String(readback.object.leaseId) !== leaseId ||
      String(readback.object.acknowledgedAt) !== acknowledgedAt
    ) {
      throw new Error("BIRDIE_RESPONSE_ACK_READBACK_MISMATCH");
    }

    return {
      success: true,
      data: {
        acknowledged: true,
        idempotent: false,
        birdieId: String(readback.object.birdieId),
        responseId: responseId,
        acknowledgedAt: acknowledgedAt
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldEventId_(transactionId) {
  return "coin:" + birdieWorldRequired_(transactionId, "transactionId");
}

function birdieWorldResponseId_(transactionId) {
  return "birdie-response:" +
    birdieWorldRequired_(transactionId, "transactionId");
}

function birdieWorldIsApprovedEarn_(transaction) {
  return String(transaction && transaction.status) === "APPROVED" &&
    String(transaction && transaction.transactionType) === "EARN";
}

function birdieWorldIsAtOrAfterCutover_(transaction) {
  var approvedAt = birdieWorldTimestamp_(
    transaction && transaction.approvedAt,
    "approvedAt"
  );
  return new Date(approvedAt).getTime() >=
    new Date(birdieWorldCutoverAt_()).getTime();
}

function birdieWorldCutoverAt_() {
  var value = PropertiesService.getScriptProperties().getProperty(
    "BIRDIE_WORLD_V1_CUTOVER_AT"
  );
  if (!value) throw new Error("BIRDIE_WORLD_V1_CUTOVER_AT_MISSING");
  return birdieWorldTimestamp_(value, "BIRDIE_WORLD_V1_CUTOVER_AT");
}

function birdieWorldCanonicalEarn_(transaction) {
  var canonicalEvent = {
    transactionId: birdieWorldRequired_(
      transaction.transactionId,
      "transactionId"
    ),
    birdieId: birdieWorldRequired_(transaction.birdieId, "birdieId"),
    amount: Number(transaction.amount),
    transactionType: String(transaction.transactionType),
    actionCode: birdieWorldRequired_(transaction.actionCode, "actionCode"),
    sourceType: String(transaction.sourceType || ""),
    sourceReference: String(transaction.sourceReference || ""),
    status: String(transaction.status),
    approvedAt: birdieWorldTimestamp_(transaction.approvedAt, "approvedAt"),
    createdAt: transaction.createdAt
      ? birdieWorldTimestamp_(transaction.createdAt, "createdAt")
      : ""
  };
  if (
    canonicalEvent.status !== "APPROVED" ||
    canonicalEvent.transactionType !== "EARN"
  ) {
    throw new Error("NOT_APPROVED_EARN");
  }
  if (
    !isFinite(canonicalEvent.amount) ||
    Math.floor(canonicalEvent.amount) !== canonicalEvent.amount ||
    canonicalEvent.amount <= 0 ||
    canonicalEvent.amount > 9007199254740991
  ) {
    throw new Error("INVALID_APPROVED_EARN_AMOUNT");
  }
  if (!/^[A-Z0-9][A-Z0-9_]{0,79}$/.test(canonicalEvent.actionCode)) {
    throw new Error("INVALID_APPROVED_EARN_ACTION_CODE");
  }
  if (!/^[A-Z0-9][A-Z0-9_]{0,79}$/.test(canonicalEvent.sourceType)) {
    throw new Error("INVALID_APPROVED_EARN_SOURCE_TYPE");
  }
  if (
    !canonicalEvent.sourceReference ||
    canonicalEvent.sourceReference.length > 500
  ) {
    throw new Error("INVALID_APPROVED_EARN_SOURCE_REFERENCE");
  }
  return canonicalEvent;
}

function birdieWorldResponsePayload_(canonical) {
  var unit = canonical.amount === 1 ? "Birdie" : "Birdies";
  var verb = canonical.amount === 1 ? "ist" : "sind";
  return {
    schemaVersion: "birdie-system-response/v1",
    responseId: birdieWorldResponseId_(canonical.transactionId),
    eventId: birdieWorldEventId_(canonical.transactionId),
    birdieId: canonical.birdieId,
    kind: "COIN_EARNED",
    language: "de-DE",
    amount: canonical.amount,
    actionCode: canonical.actionCode,
    text: "+" + canonical.amount + " " + unit + " " + verb + " angekommen."
  };
}

function birdieWorldRequireProjectionMatches_(projection, canonical) {
  if (
    String(projection.eventId) !==
      birdieWorldEventId_(canonical.transactionId) ||
    String(projection.transactionId) !== canonical.transactionId ||
    String(projection.birdieId) !== canonical.birdieId ||
    Number(projection.amount) !== canonical.amount ||
    String(projection.transactionType) !== "EARN" ||
    String(projection.actionCode) !== canonical.actionCode ||
    String(projection.sourceType) !== canonical.sourceType ||
    String(projection.sourceReference) !== canonical.sourceReference ||
    String(projection.status) !== "APPROVED" ||
    String(projection.approvedAt) !== canonical.approvedAt ||
    String(projection.createdAt || "") !== canonical.createdAt ||
    String(projection.projectionVersion) !==
      BIRDIE_WORLD_PROJECTION_VERSION_ ||
    String(projection.idempotencyKey) !==
      birdieWorldEventId_(canonical.transactionId)
  ) {
    throw new Error("WORLD_PROJECTION_IDEMPOTENCY_CONFLICT");
  }
}

function birdieWorldRequireResponseMatches_(
  response,
  canonical,
  expectedPayloadJson
) {
  if (
    String(response.responseId) !==
      birdieWorldResponseId_(canonical.transactionId) ||
    String(response.eventId) !== birdieWorldEventId_(canonical.transactionId) ||
    String(response.transactionId) !== canonical.transactionId ||
    String(response.birdieId) !== canonical.birdieId ||
    String(response.kind) !== "COIN_EARNED" ||
    String(response.payloadJson) !== expectedPayloadJson ||
    String(response.idempotencyKey) !==
      birdieWorldResponseId_(canonical.transactionId)
  ) {
    throw new Error("BIRDIE_RESPONSE_IDEMPOTENCY_CONFLICT");
  }
}

function birdieWorldRequireAuthScope_(request, requiredScope, birdieId) {
  if (typeof birdieWorldAuthScopeHook_ !== "function") {
    throw new Error("BIRDIE_WORLD_AUTH_SCOPE_HOOK_MISSING");
  }
  var context = birdieWorldAuthScopeHook_({
    request: request || {},
    requiredScope: requiredScope,
    birdieId: String(birdieId || "")
  });
  if (!context || context.verified !== true) {
    throw new Error("BIRDIE_WORLD_AUTH_UNVERIFIED");
  }

  var scopes = Array.isArray(context.scopes) ? context.scopes : [];
  var isAdmin = scopes.indexOf(BIRDIE_WORLD_SCOPES_.ADMIN) !== -1;
  if (!isAdmin && scopes.indexOf(requiredScope) === -1) {
    throw new Error("BIRDIE_WORLD_SCOPE_REQUIRED:" + requiredScope);
  }
  if (
    birdieId &&
    !isAdmin &&
    String(context.birdieId || "") !== String(birdieId)
  ) {
    throw new Error("BIRDIE_WORLD_BIRDIE_SCOPE_MISMATCH");
  }
  context.subject = birdieWorldRequired_(context.subject, "auth.subject");
  return context;
}

function birdieWorldRequireCanonicalTransaction_(transactionId) {
  var sheet = birdieWorldRequireTransactionSheet_();
  var found = birdieWorldFindUnique_(
    sheet,
    "transactionId",
    transactionId,
    "CANONICAL_TRANSACTION_DUPLICATE"
  );
  if (!found) throw new Error("CANONICAL_TRANSACTION_NOT_FOUND");
  return found.object;
}

function birdieWorldCanonicalTransactions_() {
  return birdieWorldObjects_(birdieWorldRequireTransactionSheet_());
}

function birdieWorldRequireUniqueTransactionIds_(transactions) {
  var seen = {};
  transactions.forEach(function (transaction) {
    var transactionId = birdieWorldRequired_(
      transaction.transactionId,
      "transactionId"
    );
    if (seen[transactionId]) {
      throw new Error("CANONICAL_TRANSACTION_DUPLICATE");
    }
    seen[transactionId] = true;
  });
}

function birdieWorldRequireUniqueResponseIds_(responses) {
  var seenResponseIds = {};
  var seenEventIds = {};
  var seenTransactionIds = {};
  responses.forEach(function (response) {
    var responseId = birdieWorldRequired_(response.responseId, "responseId");
    var eventId = birdieWorldRequired_(response.eventId, "eventId");
    var transactionId = birdieWorldRequired_(
      response.transactionId,
      "transactionId"
    );
    if (
      seenResponseIds[responseId] ||
      seenEventIds[eventId] ||
      seenTransactionIds[transactionId]
    ) {
      throw new Error("BIRDIE_RESPONSE_DUPLICATE");
    }
    seenResponseIds[responseId] = true;
    seenEventIds[eventId] = true;
    seenTransactionIds[transactionId] = true;
  });
}

function birdieWorldRequireUniqueProjectionIds_(projections) {
  var seenEventIds = {};
  var seenTransactionIds = {};
  projections.forEach(function (projection) {
    var eventId = birdieWorldRequired_(projection.eventId, "eventId");
    var transactionId = birdieWorldRequired_(
      projection.transactionId,
      "transactionId"
    );
    if (seenEventIds[eventId] || seenTransactionIds[transactionId]) {
      throw new Error("WORLD_PROJECTION_DUPLICATE");
    }
    seenEventIds[eventId] = true;
    seenTransactionIds[transactionId] = true;
  });
}

function birdieWorldFindUniqueProjectionForTransaction_(sheet, canonical) {
  var expectedEventId = birdieWorldEventId_(canonical.transactionId);
  var matches = birdieWorldObjectsWithRows_(sheet).filter(function (found) {
    return String(found.object.eventId) === expectedEventId ||
      String(found.object.transactionId) === canonical.transactionId;
  });
  if (matches.length > 1) throw new Error("WORLD_PROJECTION_DUPLICATE");
  return matches.length === 1 ? matches[0] : null;
}

function birdieWorldFindUniqueResponseForTransaction_(sheet, canonical) {
  var expectedResponseId = birdieWorldResponseId_(canonical.transactionId);
  var expectedEventId = birdieWorldEventId_(canonical.transactionId);
  var matches = birdieWorldObjectsWithRows_(sheet).filter(function (found) {
    return String(found.object.responseId) === expectedResponseId ||
      String(found.object.eventId) === expectedEventId ||
      String(found.object.transactionId) === canonical.transactionId;
  });
  if (matches.length > 1) throw new Error("BIRDIE_RESPONSE_DUPLICATE");
  return matches.length === 1 ? matches[0] : null;
}

function birdieWorldLeaseExpired_(response, now) {
  var expires = String(response.leaseExpiresAt || "");
  if (!expires) return true;
  var expiresAt = new Date(expires).getTime();
  var nowAt = new Date(now).getTime();
  if (!isFinite(expiresAt) || !isFinite(nowAt)) {
    throw new Error("INVALID_BIRDIE_RESPONSE_LEASE_TIME");
  }
  return expiresAt <= nowAt;
}

function birdieWorldProjectionEventView_(projection) {
  var event = {
    transactionId: String(projection.transactionId),
    birdieId: String(projection.birdieId),
    amount: Number(projection.amount),
    transactionType: "EARN",
    actionCode: String(projection.actionCode),
    sourceType: String(projection.sourceType),
    sourceReference: String(projection.sourceReference),
    status: "APPROVED",
    approvedAt: String(projection.approvedAt)
  };
  if (String(projection.createdAt || "")) {
    event.createdAt = String(projection.createdAt);
  }
  return event;
}

function birdieWorldResponseDto_(response) {
  var payload = JSON.parse(String(response.payloadJson));
  if (
    String(payload.responseId) !== String(response.responseId) ||
    String(payload.eventId) !== String(response.eventId) ||
    String(payload.birdieId) !== String(response.birdieId) ||
    String(payload.kind) !== "COIN_EARNED"
  ) {
    throw new Error("BIRDIE_RESPONSE_PAYLOAD_CONFLICT");
  }
  return payload;
}

function birdieWorldLeaseEnvelope_(response) {
  return {
    response: birdieWorldResponseDto_(response),
    leaseId: String(response.leaseId),
    leaseExpiresAt: String(response.leaseExpiresAt)
  };
}

function birdieWorldSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(
    "BIRDIE_COIN_SPREADSHEET_ID"
  );
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("BIRDIE_COIN_SPREADSHEET_ID_MISSING");
  return active;
}

function birdieWorldRequireTransactionSheet_() {
  var spreadsheet = birdieWorldSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(BIRDIE_WORLD_SHEETS_.TRANSACTIONS);
  if (!sheet) throw new Error("CANONICAL_COIN_TRANSACTIONS_MISSING");
  var headers = birdieWorldHeaders_(sheet);
  BIRDIE_WORLD_REQUIRED_TRANSACTION_HEADERS_.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      throw new Error("INVALID_CANONICAL_TRANSACTION_HEADERS:" + header);
    }
  });
  return sheet;
}

function birdieWorldEnsureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (actual.join("|") !== headers.join("|")) {
    throw new Error("INVALID_BIRDIE_WORLD_SHEET_HEADERS:" + name);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function birdieWorldSheet_(name) {
  var sheet = birdieWorldSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("BIRDIE_WORLD_SHEET_NOT_INITIALIZED:" + name);
  return sheet;
}

function birdieWorldHeaders_(sheet) {
  if (sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function birdieWorldObjects_(sheet) {
  return birdieWorldObjectsWithRows_(sheet).map(function (found) {
    return found.object;
  });
}

function birdieWorldObjectsWithRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function (row, index) {
    var object = {};
    headers.forEach(function (header, headerIndex) {
      object[header] = row[headerIndex];
    });
    return { row: index + 2, object: object };
  });
}

function birdieWorldFindUnique_(sheet, field, value, duplicateError) {
  var matches = birdieWorldObjectsWithRows_(sheet).filter(function (found) {
    return String(found.object[field]) === String(value);
  });
  if (matches.length > 1) throw new Error(duplicateError);
  return matches.length === 1 ? matches[0] : null;
}

function birdieWorldAppendObject_(sheet, object) {
  var headers = birdieWorldHeaders_(sheet);
  sheet.appendRow(headers.map(function (header) {
    return object[header] === undefined ? "" : object[header];
  }));
}

function birdieWorldWriteObject_(sheet, rowNumber, object) {
  var headers = birdieWorldHeaders_(sheet);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([
    headers.map(function (header) {
      return object[header] === undefined ? "" : object[header];
    })
  ]);
}

function birdieWorldRequired_(value, field) {
  var normalized = String(value === undefined || value === null ? "" : value)
    .trim();
  if (!normalized) throw new Error("MISSING_REQUIRED_FIELD:" + field);
  return normalized;
}

function birdieWorldTimestamp_(value, field) {
  var normalized = birdieWorldRequired_(value, field);
  var timestamp = new Date(normalized).getTime();
  if (!isFinite(timestamp)) throw new Error("INVALID_TIMESTAMP:" + field);
  return new Date(timestamp).toISOString();
}

function birdieWorldNow_() {
  return new Date().toISOString();
}
