/**
 * BIRDIE OS — Community Identity Resolution
 *
 * Add this file to the authoritative Birdie OS Apps Script project and route
 * actions beginning with `communityIdentity` plus the two read actions
 * `communityWorkItem` and `birdieProfiles`
 * to handleCommunityIdentityAction_(request).
 *
 * This module:
 * - reads COMMUNITY WORK QUEUE
 * - reads BIRDIE_PROFILES read-only
 * - writes ONLY J:O of the SAME eligible work item
 */

var BIRDIE_COMMUNITY_WORK_QUEUE_ = "COMMUNITY WORK QUEUE";
var BIRDIE_COMMUNITY_PROFILES_ = "BIRDIE_PROFILES";

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
  "sourceSnapshotKey"
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

  var birdieIdIndex = headers.indexOf("birdieId");
  var instagramHandleIndex = headers.indexOf("instagramHandle");
  var statusIndex = headers.indexOf("status");

  if (
    birdieIdIndex === -1 ||
    instagramHandleIndex === -1 ||
    statusIndex === -1
  ) {
    throw new Error("INVALID_BIRDIE_PROFILE_HEADERS");
  }

  var profiles = values.map(function (row) {
    return {
      birdieId: row[birdieIdIndex],
      instagramHandle: row[instagramHandleIndex],
      status: row[statusIndex]
    };
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
    var write = request.write || {};

    var sheet = birdieCommunitySheet_(BIRDIE_COMMUNITY_WORK_QUEUE_);
    birdieCommunityValidateWorkQueueHeaders_(sheet);

    var found = birdieCommunityFindWorkItem_(sheet, workItemId);
    if (!found) throw new Error("WORK_ITEM_NOT_FOUND");

    var current = found.object;

    if (String(current.sourceType) !== "INSTAGRAM") {
      throw new Error("WORK_ITEM_NOT_INSTAGRAM");
    }

    if (String(current.resolutionStatus) !== "PENDING_IDENTITY") {
      throw new Error("WORK_ITEM_NOT_PENDING_IDENTITY");
    }

    if (String(current.matchedBirdieId || "").trim() !== "") {
      throw new Error("WORK_ITEM_ALREADY_MATCHED");
    }

    if (String(write.processedBy) !== "ZAPIER_IDENTITY_RESOLVER") {
      throw new Error("INVALID_IDENTITY_PROCESSOR");
    }

    var profiles = birdieCommunityActiveMatches_(
      current.externalUserId
    );

    var expected;

    if (profiles.length === 0) {
      expected = {
        resolutionStatus: "IDENTITY_PENDING",
        matchedBirdieId: "",
        decision: "NO_PROFILE_MATCH",
        agentNotes: "Instagram identity not yet linked to a Birdie Profile."
      };
    } else if (profiles.length === 1) {
      expected = {
        resolutionStatus: "IDENTITY_RESOLVED",
        matchedBirdieId: String(profiles[0].birdieId),
        decision: "MATCHED_EXISTING_PROFILE",
        agentNotes: "Instagram identity resolved automatically by exact handle match."
      };
    } else {
      expected = {
        resolutionStatus: "IDENTITY_CONFLICT",
        matchedBirdieId: "",
        decision: "MULTIPLE_PROFILE_MATCHES",
        agentNotes: "Multiple Birdie Profiles match this Instagram handle. Manual resolution required."
      };
    }

    if (
      String(write.resolutionStatus) !== expected.resolutionStatus ||
      String(write.matchedBirdieId || "") !== expected.matchedBirdieId ||
      String(write.decision) !== expected.decision ||
      String(write.agentNotes) !== expected.agentNotes
    ) {
      throw new Error("IDENTITY_RESOLUTION_MISMATCH");
    }

    var processedAt = new Date().toISOString();

    // J:O ONLY — same row only.
    sheet.getRange(found.row, 10, 1, 6).setValues([[
      expected.resolutionStatus,
      expected.matchedBirdieId,
      expected.decision,
      expected.agentNotes,
      "ZAPIER_IDENTITY_RESOLVER",
      processedAt
    ]]);

    return {
      success: true,
      data: {
        workItemId: workItemId,
        rowNumber: found.row,
        resolutionStatus: expected.resolutionStatus,
        matchedBirdieId: expected.matchedBirdieId,
        decision: expected.decision,
        agentNotes: expected.agentNotes,
        processedBy: "ZAPIER_IDENTITY_RESOLVER",
        processedAt: processedAt
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function birdieCommunityActiveMatches_(externalUserId) {
  var normalizedExternal = birdieCommunityNormalizeHandle_(externalUserId);

  var profileData = birdieCommunityProfiles_().data.profiles;

  return profileData.filter(function (profile) {
    return (
      String(profile.status) === "ACTIVE" &&
      birdieCommunityNormalizeHandle_(profile.instagramHandle) === normalizedExternal
    );
  });
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
