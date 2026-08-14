/**
 * BIRDIE OS — Direct Meta Community Intake V1
 *
 * Route `appendCommunitySyncEvent` to handleMetaCommunityAction_(request).
 * The Node adapter verifies X-Hub-Signature-256 before this action is called.
 *
 * IG_COMMENT governance:
 * - one ScriptLock covers preflight, missing-row repair and three-sheet readback
 * - IDs and +1 point are immutable; initial pending states are server-derived
 * - later identity/ledger state changes are accepted only as downstream replay state
 * - the caller cannot provide a Birdie identity, Coin amount or write state
 * - exact replay is a no-op; missing exact rows are repaired
 * - duplicate or mismatching rows fail closed
 *
 * DM_RECEIVED remains queue-only and never creates Coin or identity work.
 */

var BIRDIE_META_SYNC_QUEUE_ = "COMMUNITY SYNC QUEUE";
var BIRDIE_META_WORK_QUEUE_ = "COMMUNITY WORK QUEUE";
var BIRDIE_META_SOCIAL_EVENTS_ = "SOCIAL_COIN_EVENTS";

var BIRDIE_META_SYNC_HEADERS_ = [
  "syncEventId",
  "sourceType",
  "sourceAccount",
  "sourceReference",
  "externalUserId",
  "birdieId",
  "eventType",
  "actionCode",
  "payloadSummary",
  "detectedAt",
  "syncStatus",
  "claimId",
  "processedAt",
  "processedBy",
  "idempotencyKey",
  "notes"
];

var BIRDIE_META_WORK_HEADERS_ = [
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

var BIRDIE_META_SOCIAL_HEADERS_ = [
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

var BIRDIE_META_COMMENT_NOTE_ =
  "Signed Meta comment webhook ingested. Identity and Coin writes remain pending governed processing.";
var BIRDIE_META_DM_NOTE_ =
  "Signed Meta DM webhook ingested queue-only; no Coin event is created.";
var BIRDIE_META_WORK_NOTE_ =
  "Awaiting canonical exact ACTIVE profile link or Founder review.";
var BIRDIE_META_SOCIAL_NOTE_ =
  "Canonical signed Instagram comment; identity pending and no Coin written.";

function handleMetaCommunityAction_(request) {
  request = request || {};
  if (String(request.action || "") !== "appendCommunitySyncEvent") {
    throw new Error("UNKNOWN_META_COMMUNITY_ACTION");
  }
  return birdieMetaAppendCommunityEvent_(request);
}

function birdieMetaAppendCommunityEvent_(request) {
  var event = request.event || {};
  birdieMetaRejectCallerAuthority_(event);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (String(event.eventType || "") === "IG_COMMENT") {
      return birdieMetaAppendInstagramComment_(event);
    }
    if (String(event.eventType || "") === "DM_RECEIVED") {
      return birdieMetaAppendInstagramDm_(event);
    }
    throw new Error("UNSUPPORTED_META_COMMUNITY_EVENT");
  } finally {
    lock.releaseLock();
  }
}

function birdieMetaAppendInstagramComment_(event) {
  var input = birdieMetaCommentInput_(event);
  var syncSheet = birdieMetaSheet_(BIRDIE_META_SYNC_QUEUE_);
  var workSheet = birdieMetaSheet_(BIRDIE_META_WORK_QUEUE_);
  var socialSheet = birdieMetaSheet_(BIRDIE_META_SOCIAL_EVENTS_);

  birdieMetaValidateHeaders_(syncSheet, BIRDIE_META_SYNC_HEADERS_);
  birdieMetaValidateHeaders_(workSheet, BIRDIE_META_WORK_HEADERS_);
  birdieMetaValidateHeaders_(socialSheet, BIRDIE_META_SOCIAL_HEADERS_);

  var expectedSync = {
    syncEventId: input.syncEventId,
    sourceType: "INSTAGRAM",
    sourceAccount: input.sourceAccount,
    sourceReference: input.sourceReference,
    externalUserId: input.instagramHandle,
    birdieId: "",
    eventType: "IG_COMMENT",
    actionCode: "IG_COMMENT",
    payloadSummary: input.payloadSummary,
    detectedAt: input.detectedAt,
    syncStatus: "PENDING",
    claimId: "",
    processedAt: "",
    processedBy: "",
    idempotencyKey: input.idempotencyKey,
    notes: BIRDIE_META_COMMENT_NOTE_
  };
  var expectedWork = {
    workItemId: input.workItemId,
    syncEventId: input.syncEventId,
    sourceType: "INSTAGRAM",
    externalUserId: input.instagramHandle,
    eventType: "IG_COMMENT",
    actionCode: "IG_COMMENT",
    sourceReference: input.sourceReference,
    payloadSummary: input.payloadSummary,
    detectedAt: input.detectedAt,
    resolutionStatus: "IDENTITY_PENDING",
    matchedBirdieId: "",
    decision: "",
    agentNotes: BIRDIE_META_WORK_NOTE_,
    processedBy: "",
    processedAt: "",
    sourceSnapshotKey: input.sourceSnapshotKey,
    identityConfidence: 0,
    identityReason: "Signed Meta intake received; canonical identity resolution pending.",
    identityConflict: false,
    identityDecisionMode: "PENDING_RESOLUTION"
  };
  var expectedSocial = {
    eventId: input.syncEventId,
    platform: "Instagram",
    eventType: "IG_COMMENT",
    instagramHandle: input.instagramHandle,
    birdieId: "",
    points: 1,
    sourceReference: input.sourceReference,
    verificationStatus: "IDENTITY_PENDING",
    coinWriteStatus: "NOT_WRITTEN",
    createdAt: input.detectedAt,
    verifiedAt: "",
    processedAt: "",
    idempotencyKey: input.idempotencyKey,
    note: BIRDIE_META_SOCIAL_NOTE_
  };

  var syncFound = birdieMetaInspectExact_(
    syncSheet,
    BIRDIE_META_SYNC_HEADERS_,
    expectedSync,
    ["syncEventId", "sourceReference", "idempotencyKey"],
    "META_COMMUNITY_SYNC_DUPLICATE",
    "META_COMMUNITY_SYNC_MISMATCH",
    [
      "syncEventId", "sourceType", "sourceAccount", "sourceReference",
      "externalUserId", "eventType", "actionCode", "payloadSummary",
      "detectedAt", "idempotencyKey", "notes"
    ]
  );
  var workFound = birdieMetaInspectExact_(
    workSheet,
    BIRDIE_META_WORK_HEADERS_,
    expectedWork,
    ["workItemId", "syncEventId", "sourceReference", "sourceSnapshotKey"],
    "META_COMMUNITY_WORK_DUPLICATE",
    "META_COMMUNITY_WORK_MISMATCH",
    [
      "workItemId", "syncEventId", "sourceType", "externalUserId",
      "eventType", "actionCode", "sourceReference", "payloadSummary",
      "detectedAt", "sourceSnapshotKey"
    ]
  );
  var socialFound = birdieMetaInspectExact_(
    socialSheet,
    BIRDIE_META_SOCIAL_HEADERS_,
    expectedSocial,
    ["eventId", "sourceReference", "idempotencyKey"],
    "META_SOCIAL_COIN_EVENT_DUPLICATE",
    "META_SOCIAL_COIN_EVENT_MISMATCH",
    [
      "eventId", "platform", "eventType", "instagramHandle", "points",
      "sourceReference", "createdAt", "idempotencyKey", "note"
    ]
  );

  var existingCount = (syncFound ? 1 : 0) + (workFound ? 1 : 0) + (socialFound ? 1 : 0);
  if (existingCount > 0 && existingCount < 3) {
    if (
      (syncFound && !birdieMetaObjectEqual_(syncFound.object, expectedSync, BIRDIE_META_SYNC_HEADERS_)) ||
      (workFound && !birdieMetaObjectEqual_(workFound.object, expectedWork, BIRDIE_META_WORK_HEADERS_)) ||
      (socialFound && !birdieMetaObjectEqual_(socialFound.object, expectedSocial, BIRDIE_META_SOCIAL_HEADERS_))
    ) {
      throw new Error("META_PARTIAL_STATE_NOT_EXACT");
    }
  }
  var created = [];
  if (!syncFound) {
    birdieMetaAppendObject_(syncSheet, BIRDIE_META_SYNC_HEADERS_, expectedSync);
    created.push(BIRDIE_META_SYNC_QUEUE_);
  }
  if (!workFound) {
    birdieMetaAppendObject_(workSheet, BIRDIE_META_WORK_HEADERS_, expectedWork);
    created.push(BIRDIE_META_WORK_QUEUE_);
  }
  if (!socialFound) {
    birdieMetaAppendObject_(socialSheet, BIRDIE_META_SOCIAL_HEADERS_, expectedSocial);
    created.push(BIRDIE_META_SOCIAL_EVENTS_);
  }

  if (typeof SpreadsheetApp.flush === "function") SpreadsheetApp.flush();

  var syncReadback = birdieMetaRequireReadback_(
    syncSheet,
    BIRDIE_META_SYNC_HEADERS_,
    expectedSync,
    ["syncEventId", "sourceReference", "idempotencyKey"],
    "META_COMMUNITY_SYNC_READBACK_FAILED",
    [
      "syncEventId", "sourceType", "sourceAccount", "sourceReference",
      "externalUserId", "eventType", "actionCode", "payloadSummary",
      "detectedAt", "idempotencyKey", "notes"
    ]
  );
  var workReadback = birdieMetaRequireReadback_(
    workSheet,
    BIRDIE_META_WORK_HEADERS_,
    expectedWork,
    ["workItemId", "syncEventId", "sourceReference", "sourceSnapshotKey"],
    "META_COMMUNITY_WORK_READBACK_FAILED",
    [
      "workItemId", "syncEventId", "sourceType", "externalUserId",
      "eventType", "actionCode", "sourceReference", "payloadSummary",
      "detectedAt", "sourceSnapshotKey"
    ]
  );
  var socialReadback = birdieMetaRequireReadback_(
    socialSheet,
    BIRDIE_META_SOCIAL_HEADERS_,
    expectedSocial,
    ["eventId", "sourceReference", "idempotencyKey"],
    "META_SOCIAL_COIN_EVENT_READBACK_FAILED",
    [
      "eventId", "platform", "eventType", "instagramHandle", "points",
      "sourceReference", "createdAt", "idempotencyKey", "note"
    ]
  );

  return {
    success: true,
    data: {
      syncEventId: input.syncEventId,
      workItemId: input.workItemId,
      socialEventId: input.syncEventId,
      sourceReference: input.sourceReference,
      idempotencyKey: input.idempotencyKey,
      idempotent: created.length === 0,
      repaired: created.length > 0 && existingCount > 0,
      createdSheets: created,
      rowNumbers: {
        communitySync: syncReadback.row,
        communityWork: workReadback.row,
        socialCoinEvent: socialReadback.row
      },
      readback: {
        communitySync: syncReadback.object,
        communityWork: workReadback.object,
        socialCoinEvent: socialReadback.object
      }
    }
  };
}

function birdieMetaAppendInstagramDm_(event) {
  var sourceReference = birdieMetaMessageReference_(event.sourceReference);
  var senderId = birdieMetaMessageReference_(event.externalUserId);
  var syncEventId = "SCE-IG-DM-" + sourceReference;
  var idempotencyKey = "ig:dm:" + senderId + ":" + sourceReference;
  var sourceAccount = birdieMetaHandle_(event.sourceAccount, "sourceAccount");
  var detectedAt = birdieMetaIsoTimestamp_(event.detectedAt);
  var payloadSummary = birdieMetaBounded_(event.payloadSummary, "payloadSummary", 500);

  birdieMetaExact_(event.syncEventId, syncEventId, "syncEventId");
  birdieMetaExact_(event.sourceType, "INSTAGRAM", "sourceType");
  birdieMetaExact_(event.eventType, "DM_RECEIVED", "eventType");
  birdieMetaExact_(event.actionCode, "INSTAGRAM_DM", "actionCode");
  birdieMetaExact_(event.idempotencyKey, idempotencyKey, "idempotencyKey");
  if (event.syncStatus !== undefined) {
    birdieMetaExact_(event.syncStatus, "PENDING", "syncStatus");
  }

  var expected = {
    syncEventId: syncEventId,
    sourceType: "INSTAGRAM",
    sourceAccount: sourceAccount,
    sourceReference: sourceReference,
    externalUserId: senderId,
    birdieId: "",
    eventType: "DM_RECEIVED",
    actionCode: "INSTAGRAM_DM",
    payloadSummary: payloadSummary,
    detectedAt: detectedAt,
    syncStatus: "PENDING",
    claimId: "",
    processedAt: "",
    processedBy: "",
    idempotencyKey: idempotencyKey,
    notes: BIRDIE_META_DM_NOTE_
  };
  var sheet = birdieMetaSheet_(BIRDIE_META_SYNC_QUEUE_);
  birdieMetaValidateHeaders_(sheet, BIRDIE_META_SYNC_HEADERS_);
  var found = birdieMetaInspectExact_(
    sheet,
    BIRDIE_META_SYNC_HEADERS_,
    expected,
    ["syncEventId", "idempotencyKey"],
    "META_DM_SYNC_DUPLICATE",
    "META_DM_SYNC_MISMATCH",
    [
      "syncEventId", "sourceType", "sourceAccount", "sourceReference",
      "externalUserId", "eventType", "actionCode", "payloadSummary",
      "detectedAt", "idempotencyKey", "notes"
    ]
  );
  if (!found) birdieMetaAppendObject_(sheet, BIRDIE_META_SYNC_HEADERS_, expected);
  if (typeof SpreadsheetApp.flush === "function") SpreadsheetApp.flush();
  var readback = birdieMetaRequireReadback_(
    sheet,
    BIRDIE_META_SYNC_HEADERS_,
    expected,
    ["syncEventId", "idempotencyKey"],
    "META_DM_SYNC_READBACK_FAILED",
    [
      "syncEventId", "sourceType", "sourceAccount", "sourceReference",
      "externalUserId", "eventType", "actionCode", "payloadSummary",
      "detectedAt", "idempotencyKey", "notes"
    ]
  );

  return {
    success: true,
    data: {
      syncEventId: syncEventId,
      idempotencyKey: idempotencyKey,
      queueOnly: true,
      idempotent: !!found,
      rowNumbers: { communitySync: readback.row },
      readback: { communitySync: readback.object }
    }
  };
}

function birdieMetaCommentInput_(event) {
  var sourceReference = birdieMetaCommentReference_(event.sourceReference);
  var handle = birdieMetaHandle_(event.externalUserId, "externalUserId");
  var sourceAccount = birdieMetaHandle_(event.sourceAccount, "sourceAccount");
  var syncEventId = "SCE-IG-COMMENT-" + sourceReference;
  var workItemId = "WORK-IG-COMMENT-" + sourceReference;
  var sourceSnapshotKey = "SSK-IG-COMMENT-" + sourceReference;
  var idempotencyKey = "ig:ig_comment:" + handle + ":" + sourceReference;

  birdieMetaExact_(event.syncEventId, syncEventId, "syncEventId");
  birdieMetaExact_(event.workItemId, workItemId, "workItemId");
  birdieMetaExact_(event.sourceSnapshotKey, sourceSnapshotKey, "sourceSnapshotKey");
  birdieMetaExact_(event.sourceType, "INSTAGRAM", "sourceType");
  birdieMetaExact_(event.eventType, "IG_COMMENT", "eventType");
  birdieMetaExact_(event.actionCode, "IG_COMMENT", "actionCode");
  birdieMetaExact_(event.idempotencyKey, idempotencyKey, "idempotencyKey");
  if (event.syncStatus !== undefined) {
    birdieMetaExact_(event.syncStatus, "PENDING", "syncStatus");
  }

  return {
    sourceReference: sourceReference,
    instagramHandle: handle,
    sourceAccount: sourceAccount,
    syncEventId: syncEventId,
    workItemId: workItemId,
    sourceSnapshotKey: sourceSnapshotKey,
    idempotencyKey: idempotencyKey,
    detectedAt: birdieMetaIsoTimestamp_(event.detectedAt),
    payloadSummary: birdieMetaBounded_(event.payloadSummary, "payloadSummary", 500)
  };
}

function birdieMetaRejectCallerAuthority_(event) {
  [
    "birdieId",
    "matchedBirdieId",
    "points",
    "amount",
    "approvedAmount",
    "coinAmount",
    "claimId",
    "verificationStatus",
    "coinWriteStatus",
    "resolutionStatus",
    "identityConfidence",
    "identityDecisionMode"
  ].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(event, field)) {
      throw new Error("CALLER_AUTHORITY_FORBIDDEN:" + field);
    }
  });
}

function birdieMetaInspectExact_(
  sheet,
  headers,
  expected,
  identityFields,
  duplicateError,
  mismatchError,
  comparisonHeaders
) {
  var objects = birdieMetaObjects_(sheet, headers);
  var matches = [];
  objects.forEach(function (entry, index) {
    var matched = identityFields.some(function (field) {
      return birdieMetaCellEqual_(entry[field], expected[field]);
    });
    if (matched) matches.push({ row: index + 2, object: entry });
  });

  if (matches.length > 1) throw new Error(duplicateError);
  if (matches.length === 0) return null;
  if (!birdieMetaObjectEqual_(
    matches[0].object,
    expected,
    comparisonHeaders || headers
  )) {
    throw new Error(mismatchError);
  }
  return matches[0];
}

function birdieMetaRequireReadback_(
  sheet,
  headers,
  expected,
  identityFields,
  errorCode,
  comparisonHeaders
) {
  try {
    var found = birdieMetaInspectExact_(
      sheet,
      headers,
      expected,
      identityFields,
      errorCode,
      errorCode,
      comparisonHeaders
    );
    if (!found) throw new Error(errorCode);
    return found;
  } catch (error) {
    if (String(error && error.message) === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function birdieMetaObjectEqual_(actual, expected, headers) {
  return headers.every(function (header) {
    return birdieMetaCellEqual_(actual[header], expected[header]);
  });
}

function birdieMetaCellEqual_(actual, expected) {
  if (
    Object.prototype.toString.call(actual) === "[object Date]" &&
    !isNaN(actual.getTime())
  ) {
    actual = actual.toISOString();
  }
  if (actual === true || String(actual).toUpperCase() === "TRUE") actual = true;
  if (actual === false || String(actual).toUpperCase() === "FALSE") actual = false;
  return String(actual === undefined || actual === null ? "" : actual) ===
    String(expected === undefined || expected === null ? "" : expected);
}

function birdieMetaAppendObject_(sheet, headers, object) {
  sheet.appendRow(
    headers.map(function (header) {
      return object[header] === undefined ? "" : object[header];
    })
  );
}

function birdieMetaObjects_(sheet, headers) {
  birdieMetaValidateHeaders_(sheet, headers);
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

function birdieMetaValidateHeaders_(sheet, expected) {
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var index = 0; index < expected.length; index += 1) {
    if (String(actual[index]) !== String(expected[index])) {
      throw new Error("INVALID_META_COMMUNITY_SHEET_HEADERS");
    }
  }
}

function birdieMetaSheet_(name) {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    "BIRDIE_COIN_SPREADSHEET_ID"
  );
  var spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("BIRDIE_OS_SPREADSHEET_MISSING");
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("SHEET_NOT_FOUND:" + name);
  return sheet;
}

function birdieMetaExact_(actual, expected, field) {
  if (String(actual === undefined || actual === null ? "" : actual) !== String(expected)) {
    throw new Error("INVALID_META_EVENT_FIELD:" + field);
  }
}

function birdieMetaCommentReference_(value) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d{5,80}$/.test(result)) {
    throw new Error("META_COMMENT_SOURCE_REFERENCE_INVALID");
  }
  return result;
}

function birdieMetaMessageReference_(value) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(result)) {
    throw new Error("META_DM_SOURCE_REFERENCE_INVALID");
  }
  return result;
}

function birdieMetaHandle_(value, field) {
  var result = String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();
  if (result.charAt(0) === "@") result = result.slice(1);
  if (!/^[a-z0-9._]{1,30}$/.test(result)) {
    throw new Error("INVALID_INSTAGRAM_HANDLE:" + field);
  }
  return result;
}

function birdieMetaIsoTimestamp_(value) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  var parsed = new Date(result);
  if (!result || isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    throw new Error("INVALID_META_EVENT_TIMESTAMP");
  }
  return result;
}

function birdieMetaBounded_(value, field, maxLength) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!result) throw new Error("MISSING_FIELD:" + field);
  if (result.length > maxLength) throw new Error("FIELD_TOO_LONG:" + field);
  return result;
}
