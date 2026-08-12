/**
 * BIRDIE OS — Direct Meta Community Adapter V1
 *
 * Add this file to the authoritative Birdie OS Apps Script project and route
 * `appendCommunitySyncEvent` to handleMetaCommunityAction_(request).
 *
 * Governance:
 * - append-only to COMMUNITY SYNC QUEUE
 * - never posts Coins, claims, rewards, balances or identity decisions
 * - idempotent on column O / idempotencyKey
 * - sourceType must be INSTAGRAM
 */

var BIRDIE_META_SYNC_QUEUE_ = "COMMUNITY SYNC QUEUE";
var BIRDIE_META_QUEUE_HEADERS_ = [
  "syncEventId", "sourceType", "sourceAccount", "sourceReference",
  "externalUserId", "birdieId", "eventType", "actionCode",
  "payloadSummary", "detectedAt", "syncStatus", "claimId",
  "processedAt", "processedBy", "idempotencyKey", "notes"
];

function handleMetaCommunityAction_(request) {
  request = request || {};
  if (String(request.action || "") !== "appendCommunitySyncEvent") {
    throw new Error("UNKNOWN_META_COMMUNITY_ACTION");
  }
  return birdieMetaAppendCommunityEvent_(request);
}

function birdieMetaAppendCommunityEvent_(request) {
  var event = request.event || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sheet = birdieMetaSheet_(BIRDIE_META_SYNC_QUEUE_);
    birdieMetaValidateHeaders_(sheet);

    var syncEventId = birdieMetaRequired_(event.syncEventId, "syncEventId");
    var sourceType = birdieMetaRequired_(event.sourceType, "sourceType");
    var sourceAccount = birdieMetaRequired_(event.sourceAccount, "sourceAccount");
    var sourceReference = birdieMetaRequired_(event.sourceReference, "sourceReference");
    var externalUserId = birdieMetaRequired_(event.externalUserId, "externalUserId");
    var eventType = birdieMetaRequired_(event.eventType, "eventType");
    var actionCode = birdieMetaRequired_(event.actionCode, "actionCode");
    var detectedAt = birdieMetaRequired_(event.detectedAt, "detectedAt");
    var idempotencyKey = birdieMetaRequired_(event.idempotencyKey, "idempotencyKey");

    if (sourceType !== "INSTAGRAM") throw new Error("META_EVENT_NOT_INSTAGRAM");

    var existing = birdieMetaFindByIdempotencyKey_(sheet, idempotencyKey);
    if (existing) {
      return {
        success: true,
        data: {
          syncEventId: existing.syncEventId,
          rowNumber: existing.row,
          idempotencyKey: idempotencyKey,
          idempotent: true
        }
      };
    }

    sheet.appendRow([
      syncEventId, sourceType, sourceAccount, sourceReference,
      externalUserId, "", eventType, actionCode,
      String(event.payloadSummary || ""), detectedAt, "PENDING", "",
      "", "", idempotencyKey, String(event.notes || "")
    ]);

    return {
      success: true,
      data: {
        syncEventId: syncEventId,
        rowNumber: sheet.getLastRow(),
        idempotencyKey: idempotencyKey,
        idempotent: false
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieMetaFindByIdempotencyKey_(sheet, idempotencyKey) {
  if (sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();
  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][14]) === String(idempotencyKey)) {
      return { row: index + 2, syncEventId: values[index][0] };
    }
  }
  return null;
}

function birdieMetaValidateHeaders_(sheet) {
  var actual = sheet.getRange(1, 1, 1, BIRDIE_META_QUEUE_HEADERS_.length).getValues()[0];
  if (actual.join("|") !== BIRDIE_META_QUEUE_HEADERS_.join("|")) {
    throw new Error("INVALID_COMMUNITY_SYNC_QUEUE_HEADERS");
  }
}

function birdieMetaSheet_(name) {
  var spreadsheetId =
    PropertiesService.getScriptProperties().getProperty("BIRDIE_COIN_SPREADSHEET_ID");
  var spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) throw new Error("BIRDIE_OS_SPREADSHEET_MISSING");
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("SHEET_NOT_FOUND:" + name);
  return sheet;
}

function birdieMetaRequired_(value, field) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!result) throw new Error("MISSING_FIELD:" + field);
  return result;
}
