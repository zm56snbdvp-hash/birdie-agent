/** BirdieOS durable non-economic Instagram outreach ledger. */
var BIRDIE_SOCIAL_OUTREACH_SHEET_ = "SOCIAL_OUTREACH_EVENTS";
var BIRDIE_SOCIAL_OUTREACH_HEADERS_ = [
  "outreachEventId","channel","recipientScopedId","instagramHandle","triggerEventId",
  "intentType","templateContentId","templateVersion","assetReleaseId","provider",
  "providerMessageId","echoMessageId","eligibilityState","sendStatus","sentAt","echoAt",
  "repliedAt","optedInAt","correlationConfidence","failureCode","idempotencyKey","notes"
];

function handleSocialOutreachAction_(request) {
  request = request || {};
  if (String(request.action || "") !== "appendSocialOutreachEvent") {
    throw new Error("UNKNOWN_SOCIAL_OUTREACH_ACTION");
  }
  return birdieAppendSocialOutreachEvent_(request.event || {});
}

function birdieAppendSocialOutreachEvent_(event) {
  birdieSocialOutreachRejectEconomicAuthority_(event);
  var idem = birdieSocialOutreachRequired_(event.idempotencyKey, "idempotencyKey", 220);
  var eventId = birdieSocialOutreachRequired_(event.outreachEventId, "outreachEventId", 120);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BIRDIE_SOCIAL_OUTREACH_SHEET_);
  if (!sheet) throw new Error("SOCIAL_OUTREACH_EVENTS_MISSING");
  var headers = sheet.getRange(1, 1, 1, BIRDIE_SOCIAL_OUTREACH_HEADERS_.length).getDisplayValues()[0];
  for (var i = 0; i < BIRDIE_SOCIAL_OUTREACH_HEADERS_.length; i++) {
    if (String(headers[i] || "") !== BIRDIE_SOCIAL_OUTREACH_HEADERS_[i]) throw new Error("SOCIAL_OUTREACH_HEADERS_INVALID");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastRow = sheet.getLastRow();
    var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, BIRDIE_SOCIAL_OUTREACH_HEADERS_.length).getDisplayValues() : [];
    var idemCol = BIRDIE_SOCIAL_OUTREACH_HEADERS_.indexOf("idempotencyKey");
    var idCol = BIRDIE_SOCIAL_OUTREACH_HEADERS_.indexOf("outreachEventId");
    for (var r = 0; r < rows.length; r++) {
      if (String(rows[r][idemCol]) === idem || String(rows[r][idCol]) === eventId) {
        return { success: true, data: { idempotent: true, row: r + 2, outreachEventId: String(rows[r][idCol]), idempotencyKey: String(rows[r][idemCol]) } };
      }
    }

    var row = [];
    for (var h = 0; h < BIRDIE_SOCIAL_OUTREACH_HEADERS_.length; h++) {
      var key = BIRDIE_SOCIAL_OUTREACH_HEADERS_[h];
      row.push(birdieSocialOutreachBounded_(event[key], key));
    }
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { success: true, data: { idempotent: false, row: sheet.getLastRow(), outreachEventId: eventId, idempotencyKey: idem } };
  } finally {
    lock.releaseLock();
  }
}

function birdieSocialOutreachRejectEconomicAuthority_(event) {
  var forbidden = ["birdieId","points","amount","claimId","transactionId","balance","coinWriteStatus","approvalStatus"];
  for (var i = 0; i < forbidden.length; i++) {
    if (event[forbidden[i]] !== undefined && event[forbidden[i]] !== null && String(event[forbidden[i]]) !== "") {
      throw new Error("SOCIAL_OUTREACH_ECONOMIC_AUTHORITY_FORBIDDEN");
    }
  }
}

function birdieSocialOutreachRequired_(value, field, max) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) throw new Error("SOCIAL_OUTREACH_REQUIRED_" + field);
  if (text.length > max) throw new Error("SOCIAL_OUTREACH_FIELD_TOO_LONG_" + field);
  return text;
}

function birdieSocialOutreachBounded_(value, field) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  var max = field === "notes" ? 700 : 240;
  if (text.length > max) throw new Error("SOCIAL_OUTREACH_FIELD_TOO_LONG_" + field);
  return text;
}
