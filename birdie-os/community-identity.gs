/**
 * BIRDIE OS — Community Identity Resolution V1
 *
 * Add this file to the authoritative Birdie OS Apps Script project and route
 * `communityWorkItem`, `birdieProfiles`, and `updateCommunityIdentityResolution`
 * to handleCommunityIdentityAction_(request).
 *
 * Governance:
 * - reads COMMUNITY WORK QUEUE
 * - reads BIRDIE_PROFILES read-only
 * - writes ONLY resolver metadata on the SAME eligible work item
 * - writes J:O and Q:T; P/sourceSnapshotKey is never changed
 * - never touches COMMUNITY SYNC QUEUE, coins, claims, rewards or redemptions
 */

var BIRDIE_COMMUNITY_WORK_QUEUE_ = "COMMUNITY WORK QUEUE";
var BIRDIE_COMMUNITY_PROFILES_ = "BIRDIE_PROFILES";
var BIRDIE_IDENTITY_PROCESSOR_ = "ZAPIER_IDENTITY_RESOLVER";
var BIRDIE_IDENTITY_RESOLVER_VERSION_ = "v1";

var BIRDIE_COMMUNITY_WORK_HEADERS_ = [
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

function handleCommunityIdentityAction_(request) {
  request = request || {};

  switch (String(request.action || "")) {
    case "communityWorkItem":
      return birdieCommunityGetWorkItem_(request);

    case "birdieProfiles":
      return birdieCommunityProfiles_();

    case "updateCommunityIdentityResolution":
      return birdieCommunityUpdateIdentity_(request);

    default:
      throw new Error("UNKNOWN_COMMUNITY_IDENTITY_ACTION");
  }
}

function birdieCommunityGetWorkItem_(request) {
  var workItemId = birdieCommunityRequired_(request.workItemId, "workItemId");
  var sheet = birdieCommunitySheet_(BIRDIE_COMMUNITY_WORK_QUEUE_);
  var found = birdieCommunityFindWorkItem_(sheet, workItemId);

  if (!found) throw new Error("WORK_ITEM_NOT_FOUND");

  return {
    success: true,
    data: {
      workItem: found.object,
      rowNumber: found.row
    }
  };
}

function birdieCommunityProfiles_() {
  var sheet = birdieCommunitySheet_(BIRDIE_COMMUNITY_PROFILES_);

  if (sheet.getLastRow() < 2) {
    return {
      success: true,
      data: { profiles: [] }
    };
  }

  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  var required = [
    "birdieId",
    "displayName",
    "email",
    "accountType",
    "instagramHandle",
    "status"
  ];

  required.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      throw new Error("INVALID_BIRDIE_PROFILE_HEADERS");
    }
  });

  var profiles = values.map(function (row) {
    var profile = {};
    required.forEach(function (header) {
      profile[header] = row[headers.indexOf(header)];
    });
    return profile;
  });

  return {
    success: true,
    data: { profiles: profiles }
  };
}

function birdieCommunityUpdateIdentity_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var workItemId = birdieCommunityRequired_(request.workItemId, "workItemId");
    var resolverVersion = birdieCommunityRequired_(
      request.resolverVersion,
      "resolverVersion"
    );
    var idempotencyKey = birdieCommunityRequired_(
      request.idempotencyKey,
      "idempotencyKey"
    );
    var expectedKey = "IDENTITY|" + workItemId + "|" + BIRDIE_IDENTITY_RESOLVER_VERSION_;

    if (resolverVersion !== BIRDIE_IDENTITY_RESOLVER_VERSION_) {
      throw new Error("UNSUPPORTED_IDENTITY_RESOLVER_VERSION");
    }
    if (idempotencyKey !== expectedKey) {
      throw new Error("INVALID_IDENTITY_IDEMPOTENCY_KEY");
    }

    var write = request.write || {};
    var sheet = birdieCommunitySheet_(BIRDIE_COMMUNITY_WORK_QUEUE_);
    birdieCommunityValidateWorkQueueHeaders_(sheet);

    var found = birdieCommunityFindWorkItem_(sheet, workItemId);
    if (!found) throw new Error("WORK_ITEM_NOT_FOUND");

    var current = found.object;

    if (String(current.sourceType) !== "INSTAGRAM") {
      throw new Error("WORK_ITEM_NOT_INSTAGRAM");
    }

    if (String(current.resolutionStatus) !== "IDENTITY_PENDING") {
      throw new Error("WORK_ITEM_NOT_IDENTITY_PENDING");
    }

    if (String(current.matchedBirdieId || "").trim() !== "") {
      throw new Error("WORK_ITEM_ALREADY_MATCHED");
    }

    var normalized = birdieCommunityValidateIdentityWrite_(current, write);

    if (birdieCommunitySameResolution_(current, normalized)) {
      return {
        success: true,
        data: birdieCommunityResolutionView_(
          workItemId,
          found.row,
          current,
          expectedKey,
          true
        )
      };
    }

    var processedAt = new Date().toISOString();

    // J:O only for existing resolver metadata.
    sheet.getRange(found.row, 10, 1, 6).setValues([[
      normalized.resolutionStatus,
      normalized.matchedBirdieId,
      normalized.decision,
      normalized.agentNotes,
      BIRDIE_IDENTITY_PROCESSOR_,
      processedAt
    ]]);

    // Q:T only for Confidence Resolver V1 metadata. Column P remains untouched.
    sheet.getRange(found.row, 17, 1, 4).setValues([[
      normalized.identityConfidence,
      normalized.identityReason,
      normalized.identityConflict,
      normalized.identityDecisionMode
    ]]);

    var updated = {};
    BIRDIE_COMMUNITY_WORK_HEADERS_.forEach(function (header) {
      updated[header] = current[header];
    });
    updated.resolutionStatus = normalized.resolutionStatus;
    updated.matchedBirdieId = normalized.matchedBirdieId;
    updated.decision = normalized.decision;
    updated.agentNotes = normalized.agentNotes;
    updated.processedBy = BIRDIE_IDENTITY_PROCESSOR_;
    updated.processedAt = processedAt;
    updated.identityConfidence = normalized.identityConfidence;
    updated.identityReason = normalized.identityReason;
    updated.identityConflict = normalized.identityConflict;
    updated.identityDecisionMode = normalized.identityDecisionMode;

    return {
      success: true,
      data: birdieCommunityResolutionView_(
        workItemId,
        found.row,
        updated,
        expectedKey,
        false
      )
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieCommunityValidateIdentityWrite_(current, write) {
  if (String(write.processedBy) !== BIRDIE_IDENTITY_PROCESSOR_) {
    throw new Error("INVALID_IDENTITY_PROCESSOR");
  }

  var confidence = Number(write.identityConfidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error("INVALID_IDENTITY_CONFIDENCE");
  }
  confidence = Math.round(confidence);

  var reason = birdieCommunityRequired_(write.identityReason, "identityReason");
  if (typeof write.identityConflict !== "boolean") {
    throw new Error("INVALID_IDENTITY_CONFLICT");
  }

  var mode = birdieCommunityRequired_(write.identityDecisionMode, "identityDecisionMode");
  var resolutionStatus = birdieCommunityRequired_(
    write.resolutionStatus,
    "resolutionStatus"
  );
  var decision = birdieCommunityRequired_(write.decision, "decision");
  var agentNotes = birdieCommunityRequired_(write.agentNotes, "agentNotes");
  var matchedBirdieId = String(write.matchedBirdieId || "").trim();

  if (mode === "AUTO_EXACT_LINK") {
    if (
      resolutionStatus !== "IDENTITY_RESOLVED" ||
      decision !== "EXACT_IDENTITY_LINK" ||
      confidence !== 100 ||
      write.identityConflict !== false ||
      !matchedBirdieId
    ) {
      throw new Error("INVALID_AUTO_EXACT_IDENTITY_WRITE");
    }

    var exactMatches = birdieCommunityActiveExactMatches_(current.externalUserId);
    if (
      exactMatches.length !== 1 ||
      String(exactMatches[0].birdieId) !== matchedBirdieId
    ) {
      throw new Error("EXACT_IDENTITY_LINK_NOT_VERIFIED");
    }
  } else if (mode === "AUTO_HIGH_CONFIDENCE") {
    if (
      resolutionStatus !== "IDENTITY_RESOLVED" ||
      decision !== "HIGH_CONFIDENCE_MATCH" ||
      confidence < 90 ||
      write.identityConflict !== false ||
      !matchedBirdieId
    ) {
      throw new Error("INVALID_HIGH_CONFIDENCE_IDENTITY_WRITE");
    }

    var profile = birdieCommunityFindActiveProfileByBirdieId_(matchedBirdieId);
    if (!profile) {
      throw new Error("HIGH_CONFIDENCE_PROFILE_NOT_ACTIVE");
    }
  } else if (mode === "FOUNDER_REVIEW_CONFLICT") {
    if (
      resolutionStatus !== "IDENTITY_PENDING" ||
      decision !== "FOUNDER_REVIEW_REQUIRED" ||
      write.identityConflict !== true ||
      matchedBirdieId
    ) {
      throw new Error("INVALID_IDENTITY_CONFLICT_WRITE");
    }
  } else if (mode === "FOUNDER_REVIEW_LOW_CONFIDENCE") {
    if (
      resolutionStatus !== "IDENTITY_PENDING" ||
      write.identityConflict !== false ||
      matchedBirdieId ||
      confidence >= 90 ||
      ["FOUNDER_REVIEW_REQUIRED", "NO_PROFILE_MATCH"].indexOf(decision) === -1
    ) {
      throw new Error("INVALID_LOW_CONFIDENCE_IDENTITY_WRITE");
    }
    if (decision === "NO_PROFILE_MATCH" && confidence !== 0) {
      throw new Error("NO_PROFILE_MATCH_CONFIDENCE_MUST_BE_ZERO");
    }
  } else {
    throw new Error("UNKNOWN_IDENTITY_DECISION_MODE");
  }

  return {
    resolutionStatus: resolutionStatus,
    matchedBirdieId: matchedBirdieId,
    decision: decision,
    agentNotes: agentNotes,
    identityConfidence: confidence,
    identityReason: reason,
    identityConflict: write.identityConflict,
    identityDecisionMode: mode
  };
}

function birdieCommunitySameResolution_(current, normalized) {
  return (
    String(current.resolutionStatus || "") === normalized.resolutionStatus &&
    String(current.matchedBirdieId || "") === normalized.matchedBirdieId &&
    String(current.decision || "") === normalized.decision &&
    String(current.agentNotes || "") === normalized.agentNotes &&
    String(current.processedBy || "") === BIRDIE_IDENTITY_PROCESSOR_ &&
    Number(current.identityConfidence) === normalized.identityConfidence &&
    String(current.identityReason || "") === normalized.identityReason &&
    birdieCommunityBoolean_(current.identityConflict) === normalized.identityConflict &&
    String(current.identityDecisionMode || "") === normalized.identityDecisionMode
  );
}

function birdieCommunityResolutionView_(workItemId, rowNumber, row, idempotencyKey, idempotent) {
  return {
    workItemId: workItemId,
    rowNumber: rowNumber,
    resolutionStatus: row.resolutionStatus,
    matchedBirdieId: row.matchedBirdieId,
    decision: row.decision,
    agentNotes: row.agentNotes,
    processedBy: row.processedBy,
    processedAt: row.processedAt,
    identityConfidence: row.identityConfidence,
    identityReason: row.identityReason,
    identityConflict: birdieCommunityBoolean_(row.identityConflict),
    identityDecisionMode: row.identityDecisionMode,
    resolverVersion: BIRDIE_IDENTITY_RESOLVER_VERSION_,
    idempotencyKey: idempotencyKey,
    idempotent: idempotent === true
  };
}

function birdieCommunityActiveExactMatches_(externalUserId) {
  var normalizedExternal = birdieCommunityNormalizeHandle_(externalUserId);
  return birdieCommunityProfiles_().data.profiles.filter(function (profile) {
    return (
      String(profile.status) === "ACTIVE" &&
      birdieCommunityNormalizeHandle_(profile.instagramHandle) === normalizedExternal &&
      normalizedExternal !== ""
    );
  });
}

function birdieCommunityFindActiveProfileByBirdieId_(birdieId) {
  var profiles = birdieCommunityProfiles_().data.profiles;
  for (var index = 0; index < profiles.length; index += 1) {
    if (
      String(profiles[index].birdieId) === String(birdieId) &&
      String(profiles[index].status) === "ACTIVE"
    ) {
      return profiles[index];
    }
  }
  return null;
}

function birdieCommunityNormalizeHandle_(value) {
  var normalized = String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();

  if (normalized.charAt(0) === "@") {
    normalized = normalized.slice(1);
  }

  return normalized;
}

function birdieCommunityBoolean_(value) {
  if (value === true || String(value).toUpperCase() === "TRUE") return true;
  return false;
}

function birdieCommunitySheet_(name) {
  var spreadsheetId =
    PropertiesService.getScriptProperties().getProperty(
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

function birdieCommunityValidateWorkQueueHeaders_(sheet) {
  var actual = sheet
    .getRange(1, 1, 1, BIRDIE_COMMUNITY_WORK_HEADERS_.length)
    .getValues()[0];

  if (actual.join("|") !== BIRDIE_COMMUNITY_WORK_HEADERS_.join("|")) {
    throw new Error("INVALID_COMMUNITY_WORK_QUEUE_HEADERS");
  }
}

function birdieCommunityFindWorkItem_(sheet, workItemId) {
  birdieCommunityValidateWorkQueueHeaders_(sheet);

  if (sheet.getLastRow() < 2) return null;

  var values = sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      BIRDIE_COMMUNITY_WORK_HEADERS_.length
    )
    .getValues();

  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][0]) === String(workItemId)) {
      var object = {};

      BIRDIE_COMMUNITY_WORK_HEADERS_.forEach(function (header, column) {
        object[header] = values[index][column];
      });

      return {
        row: index + 2,
        object: object
      };
    }
  }

  return null;
}

function birdieCommunityRequired_(value, field) {
  var result = String(
    value === undefined || value === null ? "" : value
  ).trim();

  if (!result) throw new Error("MISSING_FIELD:" + field);

  return result;
}
