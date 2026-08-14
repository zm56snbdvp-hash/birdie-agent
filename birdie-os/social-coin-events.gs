/**
 * BIRDIE OS — Governed Social Coin Events V1
 *
 * Owns the narrow SOCIAL_COIN_EVENTS transitions used by the controlled
 * Instagram-comment flow. Coin/Profile and Community Identity may read these
 * rows, but only this module binds an exact resolved identity and marks the
 * exact event WRITTEN after an authoritative ledger proof.
 */

var BIRDIE_SOCIAL_COIN_EVENTS_SHEET_ = "SOCIAL_COIN_EVENTS";
var BIRDIE_SOCIAL_WORK_QUEUE_SHEET_ = "COMMUNITY WORK QUEUE";
var BIRDIE_SOCIAL_ACTION_CATALOG_SHEET_ = "COIN ACTION CATALOG";

var BIRDIE_SOCIAL_EVENT_HEADERS_ = [
  "eventId",
  "platform",
  "eventType",
  "instagramHandle",
  "birdieId",
  "points",
  "sourceReference",
  "verificationStatus",
  "coinWriteStatus",
  "createdAt",
  "verifiedAt",
  "processedAt",
  "idempotencyKey",
  "note"
];

var BIRDIE_SOCIAL_WORK_HEADERS_ = [
  "workItemId",
  "syncEventId",
  "sourceType",
  "externalUserId",
  "eventType",
  "actionCode",
  "sourceReference",
  "payloadSummary",
  "detectedAt",
  "resolutionStatus",
  "matchedBirdieId",
  "decision",
  "agentNotes",
  "processedBy",
  "processedAt",
  "sourceSnapshotKey",
  "identityConfidence",
  "identityReason",
  "identityConflict",
  "identityDecisionMode"
];

var BIRDIE_SOCIAL_ACTION_HEADERS_ = [
  "actionCode",
  "actionName",
  "category",
  "defaultCoins",
  "accountType",
  "sourceTypes",
  "approvalMode",
  "frequencyRule",
  "evidenceRequired",
  "status",
  "createdAt",
  "notes"
];

var BIRDIE_SOCIAL_CONFIRMATIONS_ = {
  BIND_IDENTITY: "BIND_IG_COMMENT_IDENTITY",
  CREATE_CLAIM: "CREATE_IG_COMMENT_CLAIM",
  APPROVE_CLAIM: "APPROVE_IG_COMMENT_CLAIM",
  MARK_WRITTEN: "MARK_IG_COMMENT_WRITTEN"
};

function birdieSocialGetEvent_(request) {
  var eventId = birdieCoinRequired_(request.eventId, "eventId");
  var found = birdieSocialFindEvent_(eventId);
  if (!found) throw new Error("SOCIAL_COIN_EVENT_NOT_FOUND");
  return birdieCoinSuccess_({
    event: found.object,
    rowNumber: found.row
  });
}

function birdieSocialBindInstagramCommentIdentity_(request) {
  birdieSocialRequireConfirmation_(
    request.confirmation,
    BIRDIE_SOCIAL_CONFIRMATIONS_.BIND_IDENTITY
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var eventId = birdieCoinRequired_(request.eventId, "eventId");
    var workItemId = birdieCoinRequired_(request.workItemId, "workItemId");
    var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
    var eventFound = birdieSocialFindEvent_(eventId);
    if (!eventFound) throw new Error("SOCIAL_COIN_EVENT_NOT_FOUND");

    var event = eventFound.object;
    birdieSocialValidateInstagramCommentEvent_(event, {
      allowWritten: true,
      allowPendingIdentity: true
    });
    birdieSocialRequireUniqueInstagramComment_(event);
    birdieSocialRequireResolvedWorkItemForEvent_(
      event,
      birdieId,
      workItemId
    );
    birdieSocialValidateActivePrivateProfile_(birdieId, event.instagramHandle);

    var currentBirdieId = String(event.birdieId || "").trim();
    var currentStatus = String(event.verificationStatus || "");
    if (
      String(event.coinWriteStatus) === "WRITTEN" &&
      !(
        currentStatus === "IDENTITY_RESOLVED" &&
        currentBirdieId === birdieId
      )
    ) {
      throw new Error("WRITTEN_SOCIAL_EVENT_IDENTITY_MISMATCH");
    }
    if (
      currentBirdieId &&
      currentBirdieId !== birdieId
    ) {
      throw new Error("SOCIAL_EVENT_IDENTITY_CONFLICT");
    }
    if (
      currentStatus !== "IDENTITY_PENDING" &&
      currentStatus !== "IDENTITY_RESOLVED"
    ) {
      throw new Error("SOCIAL_EVENT_NOT_IDENTITY_PENDING");
    }

    var auditKey =
      "social-identity:" + eventId + ":" + workItemId + ":" + birdieId;
    var auditDetails = {
      eventId: eventId,
      workItemId: workItemId,
      birdieId: birdieId,
      sourceReference: event.sourceReference
    };
    if (
      currentStatus === "IDENTITY_RESOLVED" &&
      currentBirdieId === birdieId
    ) {
      birdieCoinAudit_(
        "SOCIAL_COIN_EVENT_IDENTITY_RESOLVED",
        "SOCIAL_COIN_EVENT",
        eventId,
        request.source,
        auditDetails,
        auditKey
      );
      return birdieCoinSuccess_({
        event: event,
        workItemId: workItemId,
        idempotent: true
      });
    }

    var existingIdentityAudit = birdieCoinPreflightAudit_(
      "SOCIAL_COIN_EVENT_IDENTITY_RESOLVED",
      "SOCIAL_COIN_EVENT",
      eventId,
      request.source,
      auditDetails,
      auditKey
    );
    if (existingIdentityAudit) {
      throw new Error("SOCIAL_EVENT_IDENTITY_AUDIT_STATE_CONFLICT");
    }

    var verifiedAt = birdieCoinNow_();
    birdieSocialWriteField_(
      eventFound.sheet,
      eventFound.row,
      BIRDIE_SOCIAL_EVENT_HEADERS_,
      "birdieId",
      birdieId
    );
    birdieSocialWriteField_(
      eventFound.sheet,
      eventFound.row,
      BIRDIE_SOCIAL_EVENT_HEADERS_,
      "verifiedAt",
      verifiedAt
    );
    birdieSocialWriteField_(
      eventFound.sheet,
      eventFound.row,
      BIRDIE_SOCIAL_EVENT_HEADERS_,
      "verificationStatus",
      "IDENTITY_RESOLVED"
    );
    SpreadsheetApp.flush();

    var readback = birdieSocialFindEvent_(eventId);
    if (
      !readback ||
      String(readback.object.birdieId) !== birdieId ||
      String(readback.object.verificationStatus) !== "IDENTITY_RESOLVED" ||
      String(readback.object.verifiedAt) !== verifiedAt
    ) {
      throw new Error("SOCIAL_EVENT_IDENTITY_READBACK_MISMATCH");
    }
    birdieSocialValidateInstagramCommentEvent_(readback.object, {
      allowWritten: false,
      requireResolvedIdentity: true
    });

    birdieCoinAudit_(
      "SOCIAL_COIN_EVENT_IDENTITY_RESOLVED",
      "SOCIAL_COIN_EVENT",
      eventId,
      request.source,
      auditDetails,
      auditKey
    );
    return birdieCoinSuccess_({
      event: readback.object,
      workItemId: workItemId,
      idempotent: false
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieSocialCreateInstagramCommentClaim_(request) {
  birdieSocialRequireConfirmation_(
    request.confirmation,
    BIRDIE_SOCIAL_CONFIRMATIONS_.CREATE_CLAIM
  );

  var eventId = birdieCoinRequired_(request.eventId, "eventId");
  var workItemId = birdieCoinRequired_(request.workItemId, "workItemId");
  var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
  var eventFound = birdieSocialFindEvent_(eventId);
  if (!eventFound) throw new Error("SOCIAL_COIN_EVENT_NOT_FOUND");
  var event = eventFound.object;

  birdieSocialRequireApprovedInstagramCommentRule_();
  birdieSocialValidateInstagramCommentEvent_(event, {
    allowWritten: true,
    requireResolvedIdentity: true
  });
  birdieSocialRequireUniqueInstagramComment_(event);
  birdieSocialRequireResolvedWorkItemForEvent_(
    event,
    birdieId,
    workItemId
  );
  if (String(event.birdieId) !== birdieId) {
    throw new Error("SOCIAL_EVENT_BIRDIE_ID_MISMATCH");
  }
  birdieSocialValidateActivePrivateProfile_(birdieId, event.instagramHandle);

  return birdieCoinCreateClaim_({
    action: "coinCreateInstagramCommentClaim",
    eventId: eventId,
    workItemId: workItemId,
    birdieId: birdieId,
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: String(event.sourceReference),
    note:
      "Canonical Instagram comment event " +
      eventId +
      " | workItemId=" +
      workItemId,
    idempotencyKey: "claim:" + String(event.idempotencyKey),
    confirmation: BIRDIE_SOCIAL_CONFIRMATIONS_.CREATE_CLAIM,
    source: String(request.source || "Birdie Agent")
  }, "IG_COMMENT");
}

function birdieSocialValidateInstagramCommentClaim_(profile, request) {
  birdieSocialRequireConfirmation_(
    request.confirmation,
    BIRDIE_SOCIAL_CONFIRMATIONS_.CREATE_CLAIM
  );

  var eventId = birdieCoinRequired_(request.eventId, "eventId");
  var workItemId = birdieCoinRequired_(request.workItemId, "workItemId");
  var found = birdieSocialFindEvent_(eventId);
  if (!found) throw new Error("SOCIAL_COIN_EVENT_NOT_FOUND");
  var event = found.object;
  birdieSocialRequireApprovedInstagramCommentRule_();
  birdieSocialValidateInstagramCommentEvent_(event, {
    allowWritten: true,
    requireResolvedIdentity: true
  });
  birdieSocialRequireUniqueInstagramComment_(event);
  birdieSocialRequireResolvedWorkItemForEvent_(
    event,
    String(profile.birdieId),
    workItemId
  );
  birdieSocialValidateActivePrivateProfile_(
    String(profile.birdieId),
    event.instagramHandle
  );

  var expectedKey = "claim:" + String(event.idempotencyKey);
  if (
    String(profile.accountType) !== "PRIVATE" ||
    String(event.birdieId) !== String(profile.birdieId) ||
    String(request.birdieId) !== String(profile.birdieId) ||
    String(request.actionCode) !== "IG_COMMENT" ||
    String(request.sourceType) !== "INSTAGRAM" ||
    String(request.sourceReference) !== String(event.sourceReference) ||
    String(request.idempotencyKey) !== expectedKey
  ) {
    throw new Error("INVALID_IG_COMMENT_CLAIM_BINDING");
  }
  return event;
}

function birdieSocialValidateInstagramCommentApproval_(claim, request) {
  var event = birdieSocialRequireEventBySourceReference_(
    claim.sourceReference
  ).object;
  var eventId = birdieCoinRequired_(request.eventId, "eventId");
  var workItemId = birdieCoinRequired_(request.workItemId, "workItemId");
  var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
  birdieSocialRequireApprovedInstagramCommentRule_();
  if (
    String(event.eventId) !== eventId ||
    String(claim.birdieId) !== birdieId
  ) {
    throw new Error("INVALID_IG_COMMENT_APPROVAL_CONTEXT");
  }
  birdieSocialValidateInstagramCommentEvent_(event, {
    allowWritten: true,
    requireResolvedIdentity: true
  });
  birdieSocialRequireUniqueInstagramComment_(event);
  birdieSocialRequireResolvedWorkItemForEvent_(
    event,
    birdieId,
    workItemId
  );
  if (
    String(claim.actionCode) !== "IG_COMMENT" ||
    String(claim.sourceType) !== "INSTAGRAM" ||
    String(claim.birdieId) !== String(event.birdieId) ||
    String(claim.idempotencyKey) !==
      "claim:" + String(event.idempotencyKey) ||
    ["PENDING", "APPROVED"].indexOf(String(claim.status)) === -1 ||
    (
      String(claim.status) === "APPROVED" &&
      Number(claim.approvedAmount) !== 1
    )
  ) {
    throw new Error("INVALID_IG_COMMENT_APPROVAL_BINDING");
  }
  if (
    String(event.coinWriteStatus) === "WRITTEN" &&
    String(claim.status) !== "APPROVED"
  ) {
    throw new Error("WRITTEN_EVENT_REQUIRES_APPROVED_CLAIM");
  }
  birdieSocialValidateActivePrivateProfile_(
    String(claim.birdieId),
    event.instagramHandle
  );
  if (String(claim.status) === "APPROVED") {
    birdieSocialRequireInstagramCommentLedgerProof_(claim, event);
  }
  return event;
}

function birdieSocialRequireInstagramCommentLedgerProof_(claim, event) {
  var transactionSheet = birdieCoinSheet_(
    BIRDIE_COIN_SHEETS_.TRANSACTIONS
  );
  var transactionFound = birdieCoinFind_(
    transactionSheet,
    "idempotencyKey",
    "claim:" + String(claim.claimId)
  );
  if (!transactionFound) throw new Error("IG_COMMENT_LEDGER_PROOF_MISSING");
  var transaction = transactionFound.object;
  if (
    String(transaction.transactionId || "").trim() === "" ||
    String(transaction.approvedAt || "").trim() === "" ||
    String(transaction.approvedBy || "").trim() === "" ||
    String(transaction.birdieId) !== String(claim.birdieId) ||
    Number(transaction.amount) !== 1 ||
    String(transaction.transactionType) !== "EARN" ||
    String(transaction.actionCode) !== "IG_COMMENT" ||
    String(transaction.sourceType) !== "INSTAGRAM" ||
    String(transaction.sourceReference) !== String(event.sourceReference) ||
    String(transaction.status) !== "APPROVED"
  ) {
    throw new Error("IG_COMMENT_LEDGER_PROOF_MISMATCH");
  }

  var matchingTransactions = birdieCoinObjects_(transactionSheet).filter(
    function (row) {
      return (
        String(row.actionCode) === "IG_COMMENT" &&
        String(row.sourceType) === "INSTAGRAM" &&
        String(row.sourceReference) === String(event.sourceReference)
      );
    }
  );
  if (matchingTransactions.length !== 1) {
    throw new Error("IG_COMMENT_LEDGER_PROOF_NOT_UNIQUE");
  }
  return transaction;
}

function birdieSocialRequireInstagramCommentLedgerAppendable_(claim, event) {
  var transactionSheet = birdieCoinSheet_(
    BIRDIE_COIN_SHEETS_.TRANSACTIONS
  );
  var expectedKey = "claim:" + String(claim.claimId);
  var sameSource = birdieCoinObjects_(transactionSheet).filter(function (row) {
    return (
      String(row.actionCode) === "IG_COMMENT" &&
      String(row.sourceType) === "INSTAGRAM" &&
      String(row.sourceReference) === String(event.sourceReference)
    );
  });
  if (sameSource.length === 0) return null;
  if (sameSource.length !== 1) {
    throw new Error("IG_COMMENT_LEDGER_SOURCE_CONFLICT");
  }

  var transaction = sameSource[0];
  if (
    String(transaction.idempotencyKey) !== expectedKey ||
    String(transaction.transactionId || "").trim() === "" ||
    String(transaction.approvedAt || "").trim() === "" ||
    String(transaction.approvedBy || "").trim() === "" ||
    Number(transaction.amount) !== 1 ||
    String(transaction.transactionType) !== "EARN" ||
    String(transaction.status) !== "APPROVED"
  ) {
    throw new Error("IG_COMMENT_LEDGER_SOURCE_CONFLICT");
  }
  return transaction;
}

function birdieSocialAssertInstagramCommentRejectable_(claim) {
  var transactionSheet = birdieCoinSheet_(
    BIRDIE_COIN_SHEETS_.TRANSACTIONS
  );
  var claimKey = birdieCoinFind_(
    transactionSheet,
    "idempotencyKey",
    "claim:" + String(claim.claimId)
  );
  var sameSource = birdieCoinObjects_(transactionSheet).some(function (row) {
    return (
      String(row.actionCode) === "IG_COMMENT" &&
      String(row.sourceType) === "INSTAGRAM" &&
      String(row.sourceReference) === String(claim.sourceReference)
    );
  });
  if (claimKey || sameSource) {
    throw new Error("IG_COMMENT_REQUIRES_APPROVAL_REPAIR");
  }
}

function birdieSocialMarkInstagramCommentWritten_(request) {
  birdieSocialRequireConfirmation_(
    request.confirmation,
    BIRDIE_SOCIAL_CONFIRMATIONS_.MARK_WRITTEN
  );

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var eventId = birdieCoinRequired_(request.eventId, "eventId");
    var workItemId = birdieCoinRequired_(request.workItemId, "workItemId");
    var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
    var claimId = birdieCoinRequired_(request.claimId, "claimId");
    var eventFound = birdieSocialFindEvent_(eventId);
    if (!eventFound) throw new Error("SOCIAL_COIN_EVENT_NOT_FOUND");
    var event = eventFound.object;

    birdieSocialRequireApprovedInstagramCommentRule_();
    birdieSocialValidateInstagramCommentEvent_(event, {
      allowWritten: true,
      allowPrepared: true,
      requireResolvedIdentity: true
    });
    birdieSocialRequireUniqueInstagramComment_(event);
    var workItem = birdieSocialRequireResolvedWorkItemForEvent_(
      event,
      birdieId,
      workItemId
    );
    if (String(event.birdieId) !== birdieId) {
      throw new Error("SOCIAL_EVENT_BIRDIE_ID_MISMATCH");
    }
    birdieSocialValidateActivePrivateProfile_(birdieId, event.instagramHandle);

    var claimFound = birdieCoinFind_(
      birdieCoinSheet_(BIRDIE_COIN_SHEETS_.CLAIMS),
      "claimId",
      claimId
    );
    if (!claimFound) throw new Error("CLAIM_NOT_FOUND");
    var claim = claimFound.object;
    if (
      String(claim.birdieId) !== birdieId ||
      String(claim.actionCode) !== "IG_COMMENT" ||
      String(claim.sourceType) !== "INSTAGRAM" ||
      String(claim.sourceReference) !== String(event.sourceReference) ||
      String(claim.idempotencyKey) !==
        "claim:" + String(event.idempotencyKey) ||
      String(claim.status) !== "APPROVED" ||
      Number(claim.approvedAmount) !== 1 ||
      String(claim.decidedAt || "").trim() === "" ||
      String(claim.decidedBy || "").trim() === ""
    ) {
      throw new Error("IG_COMMENT_CLAIM_NOT_APPROVED");
    }

    var transaction = birdieSocialRequireInstagramCommentLedgerProof_(
      claim,
      event
    );

    var initialWriteStatus = String(event.coinWriteStatus);
    var auditKey = birdieSocialWrittenAuditKey_(eventId);
    var auditSheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.AUDIT);
    var existingAudit = birdieCoinFindUniqueAuditByKey_(auditSheet, auditKey);
    var processedAt = String(event.processedAt || "").trim();
    if (existingAudit) {
      processedAt = birdieSocialWrittenAuditProcessedAt_(existingAudit);
    }
    if (!processedAt) processedAt = birdieCoinNow_();
    var auditDetails = birdieSocialWrittenAuditDetails_(
      event,
      workItem,
      claim,
      transaction,
      processedAt
    );
    if (existingAudit) {
      birdieCoinAudit_(
        "SOCIAL_COIN_EVENT_WRITTEN",
        "SOCIAL_COIN_EVENT",
        eventId,
        request.source,
        auditDetails,
        auditKey
      );
    }

    if (initialWriteStatus === "NOT_WRITTEN") {
      birdieSocialWriteField_(
        eventFound.sheet,
        eventFound.row,
        BIRDIE_SOCIAL_EVENT_HEADERS_,
        "processedAt",
        processedAt
      );
      birdieSocialWriteField_(
        eventFound.sheet,
        eventFound.row,
        BIRDIE_SOCIAL_EVENT_HEADERS_,
        "coinWriteStatus",
        "WRITE_PREPARED"
      );
      SpreadsheetApp.flush();

      var preparedReadback = birdieSocialFindEvent_(eventId);
      if (
        !preparedReadback ||
        String(preparedReadback.object.coinWriteStatus) !== "WRITE_PREPARED" ||
        String(preparedReadback.object.processedAt) !== processedAt ||
        String(preparedReadback.object.birdieId) !== birdieId ||
        JSON.stringify(
          birdieSocialWrittenAuditDetails_(
            preparedReadback.object,
            workItem,
            claim,
            transaction,
            processedAt
          )
        ) !== JSON.stringify(auditDetails)
      ) {
        throw new Error("SOCIAL_COIN_EVENT_PREPARE_READBACK_MISMATCH");
      }
      eventFound = preparedReadback;
      event = preparedReadback.object;
    } else if (initialWriteStatus === "WRITE_PREPARED") {
      if (String(event.processedAt || "").trim() !== processedAt) {
        throw new Error("SOCIAL_COIN_EVENT_PREPARED_STATE_MISMATCH");
      }
    } else if (initialWriteStatus === "WRITTEN") {
      if (String(event.processedAt || "").trim() !== processedAt) {
        throw new Error("SOCIAL_COIN_EVENT_WRITTEN_STATE_MISMATCH");
      }
    } else {
      throw new Error("INVALID_SOCIAL_COIN_WRITE_TRANSITION");
    }

    birdieCoinAudit_(
      "SOCIAL_COIN_EVENT_WRITTEN",
      "SOCIAL_COIN_EVENT",
      eventId,
      request.source,
      auditDetails,
      auditKey
    );
    if (!existingAudit) SpreadsheetApp.flush();
    birdieCoinAudit_(
      "SOCIAL_COIN_EVENT_WRITTEN",
      "SOCIAL_COIN_EVENT",
      eventId,
      request.source,
      auditDetails,
      auditKey
    );

    if (initialWriteStatus !== "WRITTEN") {
      birdieSocialWriteField_(
        eventFound.sheet,
        eventFound.row,
        BIRDIE_SOCIAL_EVENT_HEADERS_,
        "coinWriteStatus",
        "WRITTEN"
      );
      SpreadsheetApp.flush();
    }

    var readback = birdieSocialFindEvent_(eventId);
    if (
      !readback ||
      String(readback.object.coinWriteStatus) !== "WRITTEN" ||
      String(readback.object.processedAt) !== processedAt ||
      String(readback.object.birdieId) !== birdieId ||
      JSON.stringify(
        birdieSocialWrittenAuditDetails_(
          readback.object,
          workItem,
          claim,
          transaction,
          processedAt
        )
      ) !== JSON.stringify(auditDetails)
    ) {
      throw new Error("SOCIAL_COIN_EVENT_WRITE_READBACK_MISMATCH");
    }
    birdieSocialValidateInstagramCommentEvent_(readback.object, {
      allowWritten: true,
      requireResolvedIdentity: true
    });

    return birdieCoinSuccess_({
      event: readback.object,
      claim: claim,
      transaction: transaction,
      idempotent: initialWriteStatus === "WRITTEN" && !!existingAudit,
      recovered: initialWriteStatus === "WRITE_PREPARED"
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieSocialWrittenAuditKey_(eventId) {
  var value = String(eventId);
  return "social-written:v2|" + value.length + ":" + value;
}

function birdieSocialWrittenAuditProcessedAt_(audit) {
  var details;
  try {
    details = JSON.parse(String(audit.detailsJson || ""));
  } catch (error) {
    throw new Error("SOCIAL_COIN_EVENT_WRITTEN_AUDIT_MISMATCH");
  }
  var processedAt = String(details.processedAt || "").trim();
  if (!processedAt) {
    throw new Error("SOCIAL_COIN_EVENT_WRITTEN_AUDIT_MISMATCH");
  }
  return processedAt;
}

function birdieSocialWrittenAuditDetails_(
  event,
  workItem,
  claim,
  transaction,
  processedAt
) {
  return {
    eventId: String(event.eventId),
    workItemId: String(workItem.workItemId),
    birdieId: String(event.birdieId),
    claimId: String(claim.claimId),
    claimIdempotencyKey: String(claim.idempotencyKey),
    claimSubmittedAt: String(claim.submittedAt),
    claimDecidedAt: String(claim.decidedAt),
    claimDecidedBy: String(claim.decidedBy),
    transactionId: String(transaction.transactionId),
    transactionIdempotencyKey: String(transaction.idempotencyKey),
    transactionApprovedAt: String(transaction.approvedAt),
    transactionApprovedBy: String(transaction.approvedBy),
    sourceReference: String(event.sourceReference),
    instagramHandle: birdieCoinNormalizeInstagramHandle_(event.instagramHandle),
    eventIdempotencyKey: String(event.idempotencyKey),
    eventCreatedAt: String(event.createdAt),
    eventVerifiedAt: String(event.verifiedAt),
    sourceSnapshotKey: String(workItem.sourceSnapshotKey),
    resolverProcessedBy: String(workItem.processedBy),
    resolverProcessedAt: String(workItem.processedAt),
    processedAt: String(processedAt),
    transition: "NOT_WRITTEN_TO_WRITTEN"
  };
}

function birdieSocialValidateInstagramCommentEvent_(event, options) {
  options = options || {};
  if (
    typeof event.sourceReference !== "string" ||
    typeof event.idempotencyKey !== "string"
  ) {
    throw new Error("IG_COMMENT_SOURCE_REFERENCE_NOT_TEXT");
  }
  var handle = birdieCoinNormalizeInstagramHandle_(event.instagramHandle);
  var sourceReference = birdieCoinRequired_(
    event.sourceReference,
    "sourceReference"
  );
  if (
    String(event.platform).toUpperCase() !== "INSTAGRAM" ||
    String(event.eventType) !== "IG_COMMENT" ||
    Number(event.points) !== 1 ||
    !/^[0-9]{5,80}$/.test(sourceReference) ||
    String(event.idempotencyKey) !==
      "ig:ig_comment:" + handle + ":" + sourceReference
  ) {
    throw new Error("INVALID_IG_COMMENT_EVENT");
  }

  var writeStatus = String(event.coinWriteStatus);
  if (
    writeStatus !== "NOT_WRITTEN" &&
    !(options.allowPrepared === true && writeStatus === "WRITE_PREPARED") &&
    !(options.allowWritten === true && writeStatus === "WRITTEN")
  ) {
    throw new Error("IG_COMMENT_EVENT_ALREADY_WRITTEN");
  }

  var identityStatus = String(event.verificationStatus);
  if (
    identityStatus === "IDENTITY_RESOLVED" &&
    (
      String(event.birdieId || "").trim() === "" ||
      String(event.verifiedAt || "").trim() === ""
    )
  ) {
    throw new Error("IG_COMMENT_RESOLVED_IDENTITY_INCOMPLETE");
  }
  if (
    (writeStatus === "WRITE_PREPARED" || writeStatus === "WRITTEN") &&
    String(event.processedAt || "").trim() === ""
  ) {
    throw new Error("IG_COMMENT_WRITTEN_STATE_INCOMPLETE");
  }
  if (
    options.requireResolvedIdentity === true &&
    identityStatus !== "IDENTITY_RESOLVED"
  ) {
    throw new Error("IG_COMMENT_IDENTITY_NOT_RESOLVED");
  }
  if (
    options.allowPendingIdentity === true &&
    ["IDENTITY_PENDING", "IDENTITY_RESOLVED"].indexOf(identityStatus) === -1
  ) {
    throw new Error("INVALID_IG_COMMENT_IDENTITY_STATUS");
  }
  return event;
}

function birdieSocialValidateResolvedWorkItem_(workItem, event, birdieId) {
  if (
    typeof workItem.sourceReference !== "string" ||
    typeof workItem.sourceSnapshotKey !== "string" ||
    String(workItem.sourceSnapshotKey).trim() === ""
  ) {
    throw new Error("IG_COMMENT_WORK_ITEM_SOURCE_NOT_TEXT");
  }
  if (
    String(workItem.syncEventId) !== String(event.eventId) ||
    String(workItem.sourceType) !== "INSTAGRAM" ||
    String(workItem.externalUserId || "").trim().toLowerCase().replace(/^@/, "") !==
      birdieCoinNormalizeInstagramHandle_(event.instagramHandle) ||
    String(workItem.eventType) !== "IG_COMMENT" ||
    String(workItem.actionCode) !== "IG_COMMENT" ||
    String(workItem.sourceReference) !== String(event.sourceReference) ||
    String(workItem.resolutionStatus) !== "IDENTITY_RESOLVED" ||
    String(workItem.matchedBirdieId) !== birdieId ||
    String(workItem.decision) !== "EXACT_IDENTITY_LINK" ||
    String(workItem.processedBy) !== "ZAPIER_IDENTITY_RESOLVER" ||
    String(workItem.processedAt || "").trim() === "" ||
    Number(workItem.identityConfidence) !== 100 ||
    birdieSocialBoolean_(workItem.identityConflict) !== false ||
    String(workItem.identityDecisionMode) !== "AUTO_EXACT_LINK"
  ) {
    throw new Error("WORK_ITEM_NOT_EXACT_IG_COMMENT_IDENTITY");
  }
  return workItem;
}

function birdieSocialRequireApprovedInstagramCommentRule_() {
  var definition = BIRDIE_COIN_ACTIONS_.IG_COMMENT;
  if (
    !definition ||
    definition.version !== "V1" ||
    definition.status !== "ACTIVE" ||
    definition.rolloutMode !== "CONTROLLED_E2E" ||
    Number(definition.points) !== 1 ||
    !Array.isArray(definition.accountTypes) ||
    definition.accountTypes.length !== 1 ||
    definition.accountTypes[0] !== "PRIVATE" ||
    !Array.isArray(definition.sourceTypes) ||
    definition.sourceTypes.length !== 1 ||
    definition.sourceTypes[0] !== "INSTAGRAM" ||
    definition.approvalMode !== "MANUAL_APPROVAL" ||
    definition.frequencyRule !== "PER_DISTINCT_COMMENT"
  ) {
    throw new Error("IG_COMMENT_SOURCE_RULE_NOT_APPROVED");
  }

  var sheet = birdieSocialSheet_(BIRDIE_SOCIAL_ACTION_CATALOG_SHEET_);
  var matches = birdieSocialObjects_(
    sheet,
    BIRDIE_SOCIAL_ACTION_HEADERS_
  ).filter(function (row) {
    return String(row.actionCode) === "IG_COMMENT";
  });
  if (matches.length !== 1) {
    throw new Error("IG_COMMENT_CATALOG_RULE_NOT_UNIQUE");
  }
  var rule = matches[0];
  if (
    Number(rule.defaultCoins) !== 1 ||
    String(rule.accountType) !== "PRIVATE" ||
    String(rule.sourceTypes) !== "INSTAGRAM" ||
    String(rule.approvalMode) !== "MANUAL_APPROVAL" ||
    String(rule.frequencyRule) !== "PER_DISTINCT_COMMENT" ||
    String(rule.status) !== "ACTIVE"
  ) {
    throw new Error("IG_COMMENT_CATALOG_RULE_NOT_ACTIVE");
  }
  return rule;
}

function birdieSocialRequireResolvedWorkItemForEvent_(
  event,
  birdieId,
  expectedWorkItemId
) {
  var sheet = birdieSocialSheet_(BIRDIE_SOCIAL_WORK_QUEUE_SHEET_);
  var workItems = birdieSocialObjects_(
    sheet,
    BIRDIE_SOCIAL_WORK_HEADERS_
  );
  var matches = workItems.filter(function (row) {
    return String(row.syncEventId) === String(event.eventId);
  });
  if (matches.length !== 1) {
    throw new Error("IG_COMMENT_WORK_ITEM_NOT_UNIQUE");
  }
  if (
    expectedWorkItemId &&
    String(matches[0].workItemId) !== String(expectedWorkItemId)
  ) {
    throw new Error("IG_COMMENT_WORK_ITEM_MISMATCH");
  }
  if (
    expectedWorkItemId &&
    workItems.filter(function (row) {
      return String(row.workItemId) === String(expectedWorkItemId);
    }).length !== 1
  ) {
    throw new Error("IG_COMMENT_WORK_ITEM_ID_NOT_UNIQUE");
  }
  return birdieSocialValidateResolvedWorkItem_(
    matches[0],
    event,
    birdieId
  );
}

function birdieSocialValidateActivePrivateProfile_(birdieId, instagramHandle) {
  var profile = birdieCoinRequireProfile_(birdieId);
  if (
    String(profile.status) !== "ACTIVE" ||
    String(profile.accountType) !== "PRIVATE" ||
    birdieCoinNormalizeInstagramHandle_(profile.instagramHandle) !==
      birdieCoinNormalizeInstagramHandle_(instagramHandle)
  ) {
    throw new Error("IG_COMMENT_PROFILE_BINDING_INVALID");
  }
  return profile;
}

function birdieSocialRequireUniqueInstagramComment_(event) {
  var matches = birdieSocialObjects_(
    birdieSocialSheet_(BIRDIE_SOCIAL_COIN_EVENTS_SHEET_),
    BIRDIE_SOCIAL_EVENT_HEADERS_
  ).filter(function (row) {
    return (
      String(row.platform).toUpperCase() === "INSTAGRAM" &&
      String(row.eventType) === "IG_COMMENT" &&
      String(row.sourceReference) === String(event.sourceReference)
    );
  });
  if (matches.length !== 1 || String(matches[0].eventId) !== String(event.eventId)) {
    throw new Error("IG_COMMENT_SOURCE_REFERENCE_NOT_UNIQUE");
  }
}

function birdieSocialFindEvent_(eventId) {
  var sheet = birdieSocialSheet_(BIRDIE_SOCIAL_COIN_EVENTS_SHEET_);
  var events = birdieSocialObjects_(sheet, BIRDIE_SOCIAL_EVENT_HEADERS_);
  var matches = [];
  events.forEach(function (event, index) {
    if (String(event.eventId) === String(eventId)) {
      matches.push({ row: index + 2, object: event, sheet: sheet });
    }
  });
  if (matches.length > 1) {
    throw new Error("SOCIAL_COIN_EVENT_ID_NOT_UNIQUE");
  }
  return matches.length === 1 ? matches[0] : null;
}

function birdieSocialRequireEventBySourceReference_(sourceReference) {
  var sheet = birdieSocialSheet_(BIRDIE_SOCIAL_COIN_EVENTS_SHEET_);
  var matches = birdieSocialObjects_(
    sheet,
    BIRDIE_SOCIAL_EVENT_HEADERS_
  ).filter(function (row) {
    return (
      String(row.platform).toUpperCase() === "INSTAGRAM" &&
      String(row.eventType) === "IG_COMMENT" &&
      String(row.sourceReference) === String(sourceReference)
    );
  });
  if (matches.length !== 1) {
    throw new Error("IG_COMMENT_SOURCE_REFERENCE_NOT_UNIQUE");
  }
  return birdieSocialFindEvent_(matches[0].eventId);
}

function birdieSocialRequireWorkItem_(workItemId) {
  var sheet = birdieSocialSheet_(BIRDIE_SOCIAL_WORK_QUEUE_SHEET_);
  var matches = birdieSocialObjects_(
    sheet,
    BIRDIE_SOCIAL_WORK_HEADERS_
  ).filter(function (row) {
    return String(row.workItemId) === String(workItemId);
  });
  if (matches.length === 0) throw new Error("WORK_ITEM_NOT_FOUND");
  if (matches.length !== 1) {
    throw new Error("IG_COMMENT_WORK_ITEM_ID_NOT_UNIQUE");
  }
  return matches[0];
}

function birdieSocialSheet_(name) {
  var sheet = birdieCoinSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("SHEET_NOT_FOUND:" + name);
  return sheet;
}

function birdieSocialObjects_(sheet, headers) {
  birdieSocialValidateHeaders_(sheet, headers);
  if (sheet.getLastRow() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues()
    .map(function (row) {
      var object = {};
      headers.forEach(function (header, index) {
        object[header] = row[index];
      });
      return object;
    });
}

function birdieSocialFindObject_(sheet, headers, field, value) {
  var objects = birdieSocialObjects_(sheet, headers);
  for (var index = 0; index < objects.length; index += 1) {
    if (String(objects[index][field]) === String(value)) {
      return { row: index + 2, object: objects[index] };
    }
  }
  return null;
}

function birdieSocialWriteField_(sheet, row, headers, field, value) {
  birdieSocialValidateHeaders_(sheet, headers);
  var index = headers.indexOf(field);
  if (index === -1) throw new Error("SOCIAL_FIELD_NOT_FOUND:" + field);
  sheet.getRange(row, index + 1, 1, 1).setValue(value);
}

function birdieSocialValidateHeaders_(sheet, expected) {
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var index = 0; index < expected.length; index += 1) {
    if (String(actual[index]) !== expected[index]) {
      throw new Error("INVALID_SOCIAL_SHEET_HEADERS");
    }
  }
}

function birdieSocialRequireConfirmation_(value, expected) {
  if (String(value || "") !== expected) {
    throw new Error("INVALID_CONFIRMATION");
  }
  return expected;
}

function birdieSocialBoolean_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}
