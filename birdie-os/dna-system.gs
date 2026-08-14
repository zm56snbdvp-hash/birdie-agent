/**
 * BIRDIE OS — Birdie DNA / Living Object System V0
 *
 * Dependency: birdie-os/coin-system.gs must be loaded in the same Apps Script
 * project because Birdie DNA reuses canonical spreadsheet/profile/audit helpers.
 *
 * Route every action beginning with `dna` to handleBirdieDnaAction_(request).
 * Run setupBirdieDnaSystem_() once before the first request.
 *
 * Core invariant:
 * object identity -> ownership -> append-only lifecycle events -> derived evolution -> passport.
 * Birdie DNA never posts Birdie coins directly.
 */

var BIRDIE_DNA_SHEETS_ = {
  OBJECTS: "BIRDIE_OBJECTS",
  EVENTS: "OBJECT_EVENTS",
  OWNERSHIP: "OBJECT_OWNERSHIP",
  EVOLUTION: "OBJECT EVOLUTION RULES"
};

var BIRDIE_DNA_OBJECT_TYPES_ = ["BALL", "COIN", "MARKER", "CARD", "OTHER"];
var BIRDIE_DNA_PHYSICAL_IDENTITY_TYPES_ = ["QR", "NFC", "QR_NFC", "NONE"];
var BIRDIE_DNA_EVENT_TYPES_ = [
  "ACTIVATED", "COURSE_VISIT", "FIRST_BIRDIE", "INSTAGRAM_TAG_VERIFIED",
  "COMMUNITY_EVENT", "OWNERSHIP_TRANSFER", "RELEASED_TO_FLOCK"
];
var BIRDIE_DNA_TRANSFER_MODES_ = ["DIRECT", "RELEASE_TO_FLOCK"];
var BIRDIE_DNA_VERIFICATION_MODES_ = ["OWNER_SUBMITTED", "SYSTEM_VERIFIED", "FOUNDER_VERIFIED"];

var BIRDIE_DNA_HEADERS_ = {};
BIRDIE_DNA_HEADERS_[BIRDIE_DNA_SHEETS_.OBJECTS] = [
  "objectId", "objectType", "editionCode", "serialNumber", "displayName",
  "currentOwnerBirdieId", "lifecycleStatus", "evolutionTier", "evolutionScore",
  "physicalIdentityType", "physicalIdentityRef", "bornAt", "activatedAt",
  "publicPassport", "updatedAt", "idempotencyKey"
];
BIRDIE_DNA_HEADERS_[BIRDIE_DNA_SHEETS_.EVENTS] = [
  "eventId", "objectId", "eventType", "birdieId", "sourceType",
  "sourceReference", "courseName", "locationLabel", "eventAt", "evidenceUrl",
  "status", "evolutionPoints", "metadataJson", "createdAt", "idempotencyKey"
];
BIRDIE_DNA_HEADERS_[BIRDIE_DNA_SHEETS_.OWNERSHIP] = [
  "ownershipId", "objectId", "fromBirdieId", "toBirdieId", "transferMode",
  "status", "initiatedAt", "acceptedAt", "initiatedBy", "acceptedBy",
  "releaseState", "sourceReference", "updatedAt", "idempotencyKey",
  "claimTokenHash", "claimTokenIssuedAt", "claimTokenUsedAt"
];
BIRDIE_DNA_HEADERS_[BIRDIE_DNA_SHEETS_.EVOLUTION] = [
  "ruleId", "ruleType", "eventType", "points", "maxPerObject", "tierCode",
  "threshold", "status", "notes", "updatedAt"
];

function setupBirdieDnaSystem_() {
  var spreadsheet = birdieCoinSpreadsheet_();
  Object.keys(BIRDIE_DNA_HEADERS_).forEach(function (sheetName) {
    birdieCoinEnsureSheet_(spreadsheet, sheetName, BIRDIE_DNA_HEADERS_[sheetName]);
  });
  return birdieDnaSuccess_({ initialized: true });
}

function handleBirdieDnaAction_(request) {
  request = request || {};
  setupBirdieDnaSystem_();
  switch (String(request.action || "")) {
    case "dnaGetConfig": return birdieDnaGetConfig_(request);
    case "dnaCreateObject": return birdieDnaCreateObject_(request);
    case "dnaGetObject": return birdieDnaGetObject_(request);
    case "dnaGetPassport": return birdieDnaGetPassport_(request);
    case "dnaCreateEvent": return birdieDnaCreateEvent_(request);
    case "dnaDecideEvent": return birdieDnaDecideEvent_(request);
    case "dnaInitiateTransfer": return birdieDnaInitiateTransfer_(request);
    case "dnaRotateReleaseClaimToken": return birdieDnaRotateReleaseClaimToken_(request);
    case "dnaAcceptTransfer": return birdieDnaAcceptTransfer_(request);
    default: throw new Error("UNKNOWN_BIRDIE_DNA_ACTION");
  }
}

function birdieDnaGetConfig_() {
  var allRules = birdieCoinObjects_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVOLUTION));
  var activeRules = allRules.filter(function (row) {
    return String(row.status || "").toUpperCase() === "ACTIVE";
  });
  var activeEventRules = activeRules.filter(function (row) {
    return String(row.ruleType) === "EVENT_POINTS";
  });
  var activeTierRules = activeRules.filter(function (row) {
    return String(row.ruleType) === "TIER_THRESHOLD";
  });
  return birdieDnaSuccess_({
    objectTypes: BIRDIE_DNA_OBJECT_TYPES_,
    physicalIdentityTypes: BIRDIE_DNA_PHYSICAL_IDENTITY_TYPES_,
    eventTypes: BIRDIE_DNA_EVENT_TYPES_,
    transferModes: BIRDIE_DNA_TRANSFER_MODES_,
    verificationModes: BIRDIE_DNA_VERIFICATION_MODES_,
    evolutionRules: allRules.map(function (row) {
      return {
        ruleId: row.ruleId,
        ruleType: row.ruleType,
        eventType: row.eventType || "",
        points: row.points === "" ? null : Number(row.points),
        maxPerObject: row.maxPerObject || "",
        tierCode: row.tierCode || "",
        threshold: row.threshold === "" ? null : Number(row.threshold),
        status: row.status || ""
      };
    }),
    activeEventRuleCount: activeEventRules.length,
    activeTierRuleCount: activeTierRules.length,
    eventScoringEnabled: activeEventRules.length > 0 && activeTierRules.length > 0,
    principles: {
      birdieOsAuthoritative: true,
      eventLedgerAuthoritative: true,
      clientControlledEvolution: false,
      directCoinWrites: false,
      publicPassportDefault: false,
      preparedRulesDoNotScore: true,
      releaseClaimStoresHashOnly: true,
      releaseClaimOneTime: true,
      productionObjectIssuanceRequiresFounderApproval: true
    }
  });
}

function birdieDnaCreateObject_(request) {
  if (request.founderApproved !== true) throw new Error("FOUNDER_APPROVAL_REQUIRED");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OBJECTS);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) return birdieDnaSuccess_(birdieDnaObjectInternalView_(duplicate.object));

    var objectType = birdieCoinRequired_(request.objectType, "objectType").toUpperCase();
    if (BIRDIE_DNA_OBJECT_TYPES_.indexOf(objectType) === -1) throw new Error("INVALID_DNA_OBJECT_TYPE");
    var physicalIdentityType = String(request.physicalIdentityType || "NONE").toUpperCase();
    if (BIRDIE_DNA_PHYSICAL_IDENTITY_TYPES_.indexOf(physicalIdentityType) === -1) {
      throw new Error("INVALID_DNA_PHYSICAL_IDENTITY_TYPE");
    }

    var serialNumber = birdieCoinRequired_(request.serialNumber, "serialNumber");
    if (birdieCoinFind_(sheet, "serialNumber", serialNumber)) throw new Error("DNA_SERIAL_ALREADY_EXISTS");
    var physicalRef = String(request.physicalIdentityRef || "").trim();
    if (physicalRef && birdieCoinFind_(sheet, "physicalIdentityRef", physicalRef)) {
      throw new Error("DNA_PHYSICAL_IDENTITY_ALREADY_EXISTS");
    }

    var ownerBirdieId = String(request.ownerBirdieId || "").trim();
    if (ownerBirdieId) birdieCoinRequireProfile_(ownerBirdieId);
    var config = birdieDnaEvolutionConfig_();
    var initialTier = config.tiers.length ? config.tiers[0].tierCode : "COMMON_RARE";
    var now = birdieCoinNow_();
    var object = {
      objectId: birdieCoinId_("DNA"),
      objectType: objectType,
      editionCode: String(request.editionCode || ""),
      serialNumber: serialNumber,
      displayName: birdieCoinRequired_(request.displayName, "displayName"),
      currentOwnerBirdieId: ownerBirdieId,
      lifecycleStatus: "ISSUED",
      evolutionTier: initialTier,
      evolutionScore: 0,
      physicalIdentityType: physicalIdentityType,
      physicalIdentityRef: physicalRef,
      bornAt: now,
      activatedAt: "",
      publicPassport: request.publicPassport === true,
      updatedAt: now,
      idempotencyKey: key
    };
    birdieCoinAppendObject_(sheet, object);
    birdieCoinAudit_("DNA_OBJECT_ISSUED", "OBJECT", object.objectId, request.source, {
      objectId: object.objectId,
      objectType: object.objectType,
      editionCode: object.editionCode,
      serialNumber: object.serialNumber,
      ownerBirdieId: object.currentOwnerBirdieId,
      publicPassport: object.publicPassport
    }, key);
    return birdieDnaSuccess_(birdieDnaObjectInternalView_(object));
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaGetObject_(request) {
  var found = birdieDnaRequireObjectFound_(request.objectId);
  var refreshed = birdieDnaRefreshObjectEvolution_(found);
  return birdieDnaSuccess_(birdieDnaObjectInternalView_(refreshed.object));
}

function birdieDnaGetPassport_(request) {
  var found = birdieDnaRequireObjectFound_(request.objectId);
  var refreshed = birdieDnaRefreshObjectEvolution_(found);
  var object = refreshed.object;
  if (!birdieDnaBoolean_(object.publicPassport)) throw new Error("DNA_PASSPORT_PRIVATE");

  var events = birdieDnaVerifiedEvents_(object.objectId);
  var ownership = birdieCoinObjects_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OWNERSHIP)).filter(function (row) {
    return String(row.objectId) === String(object.objectId) && String(row.status) === "ACCEPTED";
  });
  var courses = {};
  var instagramMoments = 0;
  var communityEvents = 0;
  var releases = 0;
  events.forEach(function (event) {
    if (String(event.courseName || "").trim()) courses[String(event.courseName).trim()] = true;
    if (String(event.eventType) === "INSTAGRAM_TAG_VERIFIED") instagramMoments += 1;
    if (String(event.eventType) === "COMMUNITY_EVENT") communityEvents += 1;
    if (String(event.eventType) === "RELEASED_TO_FLOCK") releases += 1;
  });

  return birdieDnaSuccess_({
    objectId: object.objectId,
    objectType: object.objectType,
    editionCode: object.editionCode,
    serialNumber: object.serialNumber,
    displayName: object.displayName,
    lifecycleStatus: object.lifecycleStatus,
    bornAt: birdieDnaPublicDate_(object.bornAt),
    activatedAt: birdieDnaPublicDate_(object.activatedAt),
    owner: birdieDnaPublicOwner_(object.currentOwnerBirdieId),
    evolution: birdieDnaEvolutionView_(object.evolutionScore, object.evolutionTier),
    journey: {
      verifiedEvents: events.length,
      coursesVisited: Object.keys(courses).length,
      ownershipTransfers: ownership.length,
      instagramMoments: instagramMoments,
      communityEvents: communityEvents,
      releasedToFlock: releases
    },
    history: events.map(function (event) {
      return {
        eventType: event.eventType,
        courseName: event.courseName || "",
        locationLabel: event.locationLabel || "",
        eventAt: birdieDnaPublicDate_(event.eventAt),
        hasEvidence: Boolean(String(event.evidenceUrl || "").trim())
      };
    })
  });
}

function birdieDnaCreateEvent_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var objectFound = birdieDnaRequireObjectFound_(request.objectId);
    var object = objectFound.object;
    var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
    birdieCoinRequireProfile_(birdieId);
    if (String(object.currentOwnerBirdieId || "") !== birdieId) throw new Error("DNA_OBJECT_OWNER_MISMATCH");

    var eventType = birdieCoinRequired_(request.eventType, "eventType").toUpperCase();
    if (BIRDIE_DNA_EVENT_TYPES_.indexOf(eventType) === -1) throw new Error("UNKNOWN_DNA_EVENT_TYPE");
    if (["OWNERSHIP_TRANSFER", "RELEASED_TO_FLOCK"].indexOf(eventType) !== -1) throw new Error("DNA_SYSTEM_EVENT_ONLY");
    var rule = birdieDnaRuleForEvent_(eventType);
    if (!rule) throw new Error("DNA_EVOLUTION_RULE_NOT_ACTIVE");

    var verificationMode = String(request.verificationMode || "OWNER_SUBMITTED").toUpperCase();
    if (BIRDIE_DNA_VERIFICATION_MODES_.indexOf(verificationMode) === -1) {
      throw new Error("INVALID_DNA_VERIFICATION_MODE");
    }
    var status = "PENDING";
    if (verificationMode === "SYSTEM_VERIFIED") {
      if (request.systemVerified !== true) throw new Error("SYSTEM_VERIFICATION_REQUIRED");
      status = "VERIFIED";
    }
    if (verificationMode === "FOUNDER_VERIFIED") {
      if (request.founderApproved !== true) throw new Error("FOUNDER_APPROVAL_REQUIRED");
      status = "VERIFIED";
    }

    var event = birdieDnaAppendEvent_({
      objectId: object.objectId,
      eventType: eventType,
      birdieId: birdieId,
      sourceType: birdieCoinRequired_(request.sourceType, "sourceType").toUpperCase(),
      sourceReference: birdieCoinRequired_(request.sourceReference, "sourceReference"),
      courseName: String(request.courseName || ""),
      locationLabel: String(request.locationLabel || ""),
      eventAt: String(request.eventAt || birdieCoinNow_()),
      evidenceUrl: String(request.evidenceUrl || ""),
      status: status,
      evolutionPoints: status === "VERIFIED" ? Number(rule.points || 0) : 0,
      metadataJson: JSON.stringify(request.metadata || {}),
      idempotencyKey: birdieCoinRequired_(request.idempotencyKey, "idempotencyKey"),
      actor: request.source || "Birdie Agent"
    });
    var refreshed = status === "VERIFIED"
      ? birdieDnaRefreshObjectEvolution_(birdieDnaRequireObjectFound_(object.objectId))
      : objectFound;
    return birdieDnaSuccess_({ event: event, object: birdieDnaObjectInternalView_(refreshed.object) });
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaDecideEvent_(request) {
  if (request.founderApproved !== true) throw new Error("FOUNDER_APPROVAL_REQUIRED");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVENTS);
    var found = birdieCoinFind_(sheet, "eventId", birdieCoinRequired_(request.eventId, "eventId"));
    if (!found) throw new Error("DNA_EVENT_NOT_FOUND");
    var event = found.object;
    var decision = birdieCoinRequired_(request.decision, "decision").toUpperCase();
    if (["APPROVE", "REJECT"].indexOf(decision) === -1) throw new Error("INVALID_DNA_EVENT_DECISION");
    var targetStatus = decision === "APPROVE" ? "VERIFIED" : "REJECTED";
    if (String(event.status) === targetStatus) {
      return birdieDnaSuccess_({ event: event, object: birdieDnaGetObject_({ objectId: event.objectId }).data });
    }
    if (["VERIFIED", "REJECTED"].indexOf(String(event.status)) !== -1) throw new Error("DNA_EVENT_ALREADY_DECIDED");

    var rule = birdieDnaRuleForEvent_(String(event.eventType));
    if (decision === "APPROVE" && !rule) throw new Error("DNA_EVOLUTION_RULE_NOT_ACTIVE");
    if (decision === "APPROVE") {
      birdieDnaValidateEventUniqueness_(event.objectId, event.eventType, event.courseName, event.sourceReference, event.eventId);
    }
    event.status = targetStatus;
    event.evolutionPoints = decision === "APPROVE" ? Number(rule.points || 0) : 0;
    birdieCoinWriteObject_(sheet, found.row, event);
    birdieCoinAudit_("DNA_EVENT_" + targetStatus, "OBJECT_EVENT", event.eventId, request.actor, {
      eventId: event.eventId,
      objectId: event.objectId,
      decision: decision,
      reason: String(request.reason || "")
    }, request.idempotencyKey);
    var refreshed = birdieDnaRefreshObjectEvolution_(birdieDnaRequireObjectFound_(event.objectId));
    return birdieDnaSuccess_({ event: event, object: birdieDnaObjectInternalView_(refreshed.object) });
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaInitiateTransfer_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OWNERSHIP);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) {
      if (String(duplicate.object.transferMode) === "RELEASE_TO_FLOCK") {
        birdieDnaAppendSystemEvent_(
          duplicate.object.objectId,
          "RELEASED_TO_FLOCK",
          duplicate.object.fromBirdieId,
          duplicate.object.ownershipId
        );
      }
      return birdieDnaSuccess_(duplicate.object);
    }

    var objectFound = birdieDnaRequireObjectFound_(request.objectId);
    var object = objectFound.object;
    var fromBirdieId = birdieCoinRequired_(request.fromBirdieId, "fromBirdieId");
    birdieCoinRequireProfile_(fromBirdieId);
    if (String(object.currentOwnerBirdieId || "") !== fromBirdieId) throw new Error("DNA_OBJECT_OWNER_MISMATCH");
    var openTransfer = birdieCoinObjects_(sheet).some(function (row) {
      return String(row.objectId) === String(object.objectId) && String(row.status) === "PENDING";
    });
    if (openTransfer) throw new Error("DNA_TRANSFER_ALREADY_PENDING");

    var transferMode = birdieCoinRequired_(request.transferMode, "transferMode").toUpperCase();
    if (BIRDIE_DNA_TRANSFER_MODES_.indexOf(transferMode) === -1) throw new Error("INVALID_DNA_TRANSFER_MODE");
    var toBirdieId = String(request.toBirdieId || "").trim();
    var claimTokenHash = "";
    if (transferMode === "DIRECT") {
      if (!toBirdieId) throw new Error("DNA_TRANSFER_RECIPIENT_REQUIRED");
      if (toBirdieId === fromBirdieId) throw new Error("DNA_TRANSFER_SAME_OWNER");
      birdieCoinRequireProfile_(toBirdieId);
    } else {
      if (toBirdieId) throw new Error("DNA_RELEASE_RECIPIENT_NOT_ALLOWED");
      claimTokenHash = birdieDnaRequireClaimTokenHash_(request.claimTokenHash);
    }

    var now = birdieCoinNow_();
    var ownership = {
      ownershipId: birdieCoinId_("OWN"),
      objectId: object.objectId,
      fromBirdieId: fromBirdieId,
      toBirdieId: toBirdieId,
      transferMode: transferMode,
      status: "PENDING",
      initiatedAt: now,
      acceptedAt: "",
      initiatedBy: String(request.actor || fromBirdieId),
      acceptedBy: "",
      releaseState: transferMode === "RELEASE_TO_FLOCK" ? "OPEN" : "NONE",
      sourceReference: String(request.sourceReference || ""),
      updatedAt: now,
      idempotencyKey: key,
      claimTokenHash: claimTokenHash,
      claimTokenIssuedAt: transferMode === "RELEASE_TO_FLOCK" ? now : "",
      claimTokenUsedAt: ""
    };
    birdieCoinAppendObject_(sheet, ownership);
    if (transferMode === "RELEASE_TO_FLOCK") {
      birdieDnaAppendSystemEvent_(object.objectId, "RELEASED_TO_FLOCK", fromBirdieId, ownership.ownershipId);
    }
    birdieCoinAudit_("DNA_TRANSFER_INITIATED", "OBJECT_OWNERSHIP", ownership.ownershipId, ownership.initiatedBy, {
      ownershipId: ownership.ownershipId,
      objectId: ownership.objectId,
      fromBirdieId: ownership.fromBirdieId,
      toBirdieId: ownership.toBirdieId,
      transferMode: ownership.transferMode,
      status: ownership.status,
      releaseState: ownership.releaseState,
      claimTokenIssued: Boolean(ownership.claimTokenHash)
    }, key);
    return birdieDnaSuccess_(ownership);
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaRotateReleaseClaimToken_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OWNERSHIP);
    var found = birdieCoinFind_(sheet, "ownershipId", birdieCoinRequired_(request.ownershipId, "ownershipId"));
    if (!found) throw new Error("DNA_TRANSFER_NOT_FOUND");
    var ownership = found.object;
    if (String(ownership.transferMode) !== "RELEASE_TO_FLOCK") throw new Error("DNA_CLAIM_TOKEN_NOT_APPLICABLE");
    if (String(ownership.status) !== "PENDING") throw new Error("DNA_TRANSFER_NOT_PENDING");

    var fromBirdieId = birdieCoinRequired_(request.fromBirdieId, "fromBirdieId");
    if (String(ownership.fromBirdieId) !== fromBirdieId) throw new Error("DNA_TRANSFER_OWNER_MISMATCH");
    var objectFound = birdieDnaRequireObjectFound_(ownership.objectId);
    if (String(objectFound.object.currentOwnerBirdieId || "") !== fromBirdieId) throw new Error("DNA_TRANSFER_STALE_OWNER");

    var now = birdieCoinNow_();
    ownership.claimTokenHash = birdieDnaRequireClaimTokenHash_(request.claimTokenHash);
    ownership.claimTokenIssuedAt = now;
    ownership.claimTokenUsedAt = "";
    ownership.updatedAt = now;
    birdieCoinWriteObject_(sheet, found.row, ownership);
    birdieCoinAudit_("DNA_RELEASE_CLAIM_TOKEN_ROTATED", "OBJECT_OWNERSHIP", ownership.ownershipId, request.actor, {
      ownershipId: ownership.ownershipId,
      objectId: ownership.objectId,
      fromBirdieId: ownership.fromBirdieId,
      claimTokenRotated: true
    }, request.idempotencyKey);
    return birdieDnaSuccess_(ownership);
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaAcceptTransfer_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OWNERSHIP);
    var found = birdieCoinFind_(sheet, "ownershipId", birdieCoinRequired_(request.ownershipId, "ownershipId"));
    if (!found) throw new Error("DNA_TRANSFER_NOT_FOUND");
    var ownership = found.object;
    var toBirdieId = birdieCoinRequired_(request.toBirdieId, "toBirdieId");
    birdieCoinRequireProfile_(toBirdieId);

    if (String(ownership.status) === "ACCEPTED") {
      if (String(ownership.toBirdieId) !== toBirdieId) throw new Error("DNA_TRANSFER_ALREADY_ACCEPTED_BY_OTHER_PROFILE");
      var repaired = birdieDnaReconcileAcceptedTransfer_(ownership, toBirdieId);
      return birdieDnaSuccess_({
        transfer: ownership,
        object: birdieDnaObjectInternalView_(repaired.object),
        passport: birdieDnaBoolean_(repaired.object.publicPassport)
          ? birdieDnaGetPassport_({ objectId: ownership.objectId }).data
          : null
      });
    }
    if (String(ownership.status) !== "PENDING") throw new Error("DNA_TRANSFER_NOT_PENDING");
    if (String(ownership.transferMode) === "DIRECT" && String(ownership.toBirdieId) !== toBirdieId) {
      throw new Error("DNA_TRANSFER_RECIPIENT_MISMATCH");
    }
    if (String(ownership.fromBirdieId) === toBirdieId) throw new Error("DNA_TRANSFER_SAME_OWNER");

    if (String(ownership.transferMode) === "RELEASE_TO_FLOCK") {
      if (!String(ownership.claimTokenHash || "")) throw new Error("DNA_RELEASE_CLAIM_TOKEN_MISSING");
      if (String(ownership.claimTokenUsedAt || "")) throw new Error("DNA_RELEASE_CLAIM_TOKEN_ALREADY_USED");
      var presentedHash = birdieDnaRequireClaimTokenHash_(request.claimTokenHash);
      if (presentedHash !== String(ownership.claimTokenHash)) throw new Error("DNA_RELEASE_CLAIM_TOKEN_INVALID");
    }

    var objectFound = birdieDnaRequireObjectFound_(ownership.objectId);
    var object = objectFound.object;
    if (String(object.currentOwnerBirdieId || "") !== String(ownership.fromBirdieId)) throw new Error("DNA_TRANSFER_STALE_OWNER");

    var now = birdieCoinNow_();
    ownership.toBirdieId = toBirdieId;
    ownership.status = "ACCEPTED";
    ownership.acceptedAt = now;
    ownership.acceptedBy = String(request.actor || toBirdieId);
    ownership.releaseState = String(ownership.transferMode) === "RELEASE_TO_FLOCK" ? "CLAIMED" : "NONE";
    if (String(ownership.transferMode) === "RELEASE_TO_FLOCK") ownership.claimTokenUsedAt = now;
    ownership.sourceReference = String(request.sourceReference || ownership.sourceReference || "");
    ownership.updatedAt = now;
    birdieCoinWriteObject_(sheet, found.row, ownership);

    var reconciled = birdieDnaReconcileAcceptedTransfer_(ownership, toBirdieId);
    birdieCoinAudit_("DNA_TRANSFER_ACCEPTED", "OBJECT_OWNERSHIP", ownership.ownershipId, ownership.acceptedBy, {
      objectId: ownership.objectId,
      fromBirdieId: ownership.fromBirdieId,
      toBirdieId: ownership.toBirdieId,
      transferMode: ownership.transferMode,
      claimTokenConsumed: String(ownership.transferMode) === "RELEASE_TO_FLOCK"
    }, request.idempotencyKey);
    return birdieDnaSuccess_({
      transfer: ownership,
      object: birdieDnaObjectInternalView_(reconciled.object),
      passport: birdieDnaBoolean_(reconciled.object.publicPassport)
        ? birdieDnaGetPassport_({ objectId: ownership.objectId }).data
        : null
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieDnaReconcileAcceptedTransfer_(ownership, toBirdieId) {
  var objectFound = birdieDnaRequireObjectFound_(ownership.objectId);
  var object = objectFound.object;
  var currentOwner = String(object.currentOwnerBirdieId || "");
  if (currentOwner !== String(toBirdieId)) {
    if (currentOwner !== String(ownership.fromBirdieId)) throw new Error("DNA_TRANSFER_STALE_OWNER");
    object.currentOwnerBirdieId = toBirdieId;
    object.lifecycleStatus = "ACTIVE";
    object.updatedAt = birdieCoinNow_();
    birdieCoinWriteObject_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OBJECTS), objectFound.row, object);
  }
  birdieDnaAppendSystemEvent_(object.objectId, "OWNERSHIP_TRANSFER", toBirdieId, ownership.ownershipId);
  return birdieDnaRefreshObjectEvolution_(birdieDnaRequireObjectFound_(object.objectId));
}

function birdieDnaAppendSystemEvent_(objectId, eventType, birdieId, sourceReference) {
  if (BIRDIE_DNA_EVENT_TYPES_.indexOf(eventType) === -1) throw new Error("UNKNOWN_DNA_SYSTEM_EVENT_TYPE");
  var rule = birdieDnaRuleForEvent_(eventType);
  var key = "DNA|" + objectId + "|" + eventType + "|" + sourceReference;
  return birdieDnaAppendEvent_({
    objectId: objectId,
    eventType: eventType,
    birdieId: birdieId,
    sourceType: "SYSTEM",
    sourceReference: sourceReference,
    courseName: "",
    locationLabel: "",
    eventAt: birdieCoinNow_(),
    evidenceUrl: "",
    status: "VERIFIED",
    evolutionPoints: rule ? Number(rule.points || 0) : 0,
    metadataJson: "{}",
    idempotencyKey: key,
    actor: "Birdie DNA"
  });
}

function birdieDnaAppendEvent_(input) {
  var sheet = birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVENTS);
  var duplicate = birdieCoinFind_(sheet, "idempotencyKey", input.idempotencyKey);
  if (duplicate) return duplicate.object;
  birdieDnaValidateEventUniqueness_(input.objectId, input.eventType, input.courseName, input.sourceReference, "");
  var now = birdieCoinNow_();
  var event = {
    eventId: birdieCoinId_("EVT"),
    objectId: input.objectId,
    eventType: input.eventType,
    birdieId: input.birdieId,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
    courseName: input.courseName || "",
    locationLabel: input.locationLabel || "",
    eventAt: input.eventAt || now,
    evidenceUrl: input.evidenceUrl || "",
    status: input.status,
    evolutionPoints: Number(input.evolutionPoints || 0),
    metadataJson: input.metadataJson || "{}",
    createdAt: now,
    idempotencyKey: input.idempotencyKey
  };
  birdieCoinAppendObject_(sheet, event);
  birdieCoinAudit_("DNA_EVENT_CREATED", "OBJECT_EVENT", event.eventId, input.actor, {
    eventId: event.eventId,
    objectId: event.objectId,
    eventType: event.eventType,
    status: event.status,
    evolutionPoints: event.evolutionPoints
  }, input.idempotencyKey);
  if (String(event.status) === "VERIFIED" && String(event.eventType) === "ACTIVATED") {
    var objectFound = birdieDnaRequireObjectFound_(event.objectId);
    var object = objectFound.object;
    if (!String(object.activatedAt || "")) object.activatedAt = event.eventAt;
    object.lifecycleStatus = "ACTIVE";
    object.updatedAt = now;
    birdieCoinWriteObject_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OBJECTS), objectFound.row, object);
  }
  return event;
}

function birdieDnaValidateEventUniqueness_(objectId, eventType, courseName, sourceReference, excludeEventId) {
  var rule = birdieDnaRuleForEvent_(eventType);
  var events = birdieCoinObjects_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVENTS)).filter(function (row) {
    return String(row.objectId) === String(objectId) &&
      String(row.eventType) === String(eventType) &&
      String(row.status) !== "REJECTED" &&
      String(row.eventId) !== String(excludeEventId || "");
  });
  if (!rule) return;
  var limit = String(rule.maxPerObject || "").trim();
  if (/^\d+$/.test(limit) && Number(limit) > 0 && events.length >= Number(limit)) throw new Error("DNA_EVENT_LIMIT_REACHED");
  if (limit === "DISTINCT_COURSE") {
    var course = String(courseName || "").trim().toLowerCase();
    if (!course) throw new Error("DNA_COURSE_NAME_REQUIRED");
    if (events.some(function (row) { return String(row.courseName || "").trim().toLowerCase() === course; })) {
      throw new Error("DNA_DUPLICATE_COURSE_EVENT");
    }
  }
  if (limit === "DISTINCT_SOURCE" || limit === "DISTINCT_EVENT") {
    var source = String(sourceReference || "").trim();
    if (!source) throw new Error("DNA_SOURCE_REFERENCE_REQUIRED");
    if (events.some(function (row) { return String(row.sourceReference || "") === source; })) {
      throw new Error("DNA_DUPLICATE_SOURCE_EVENT");
    }
  }
}

function birdieDnaRefreshObjectEvolution_(found) {
  var object = found.object;
  var score = 0;
  birdieDnaVerifiedEvents_(object.objectId).forEach(function (event) {
    score += Number(event.evolutionPoints || 0);
  });
  var tier = birdieDnaTierForScore_(score);
  if (Number(object.evolutionScore || 0) !== score || String(object.evolutionTier) !== tier) {
    object.evolutionScore = score;
    object.evolutionTier = tier;
    object.updatedAt = birdieCoinNow_();
    birdieCoinWriteObject_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OBJECTS), found.row, object);
  }
  return { row: found.row, object: object };
}

function birdieDnaVerifiedEvents_(objectId) {
  return birdieCoinObjects_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVENTS)).filter(function (row) {
    return String(row.objectId) === String(objectId) && String(row.status) === "VERIFIED";
  }).sort(function (a, b) {
    return String(a.eventAt).localeCompare(String(b.eventAt));
  });
}

function birdieDnaEvolutionConfig_() {
  var rows = birdieCoinObjects_(birdieDnaSheet_(BIRDIE_DNA_SHEETS_.EVOLUTION)).filter(function (row) {
    return String(row.status || "").toUpperCase() === "ACTIVE";
  });
  var rules = {};
  var tiers = [];
  rows.forEach(function (row) {
    if (String(row.ruleType) === "EVENT_POINTS" && String(row.eventType || "")) {
      rules[String(row.eventType).toUpperCase()] = {
        points: Number(row.points || 0),
        maxPerObject: String(row.maxPerObject || "")
      };
    }
    if (String(row.ruleType) === "TIER_THRESHOLD" && String(row.tierCode || "")) {
      tiers.push({ tierCode: String(row.tierCode), threshold: Number(row.threshold || 0) });
    }
  });
  tiers.sort(function (a, b) { return a.threshold - b.threshold; });
  return { rules: rules, tiers: tiers };
}

function birdieDnaRuleForEvent_(eventType) {
  return birdieDnaEvolutionConfig_().rules[String(eventType || "").toUpperCase()] || null;
}

function birdieDnaTierForScore_(score) {
  var tiers = birdieDnaEvolutionConfig_().tiers;
  var current = tiers.length ? tiers[0].tierCode : "COMMON_RARE";
  tiers.forEach(function (tier) {
    if (Number(score) >= Number(tier.threshold)) current = tier.tierCode;
  });
  return current;
}

function birdieDnaEvolutionView_(score, tierCode) {
  var tiers = birdieDnaEvolutionConfig_().tiers;
  var next = null;
  for (var index = 0; index < tiers.length; index += 1) {
    if (Number(tiers[index].threshold) > Number(score)) {
      next = tiers[index];
      break;
    }
  }
  return {
    tier: tierCode,
    score: Number(score || 0),
    nextTier: next ? next.tierCode : null,
    nextThreshold: next ? next.threshold : null,
    pointsToNext: next ? Math.max(0, Number(next.threshold) - Number(score || 0)) : 0
  };
}

function birdieDnaPublicOwner_(birdieId) {
  if (!String(birdieId || "").trim()) return null;
  var profile = birdieCoinRequireProfile_(birdieId);
  return {
    displayName: birdieDnaBoolean_(profile.publicWall) ? String(profile.displayName) : "Private Flock Member"
  };
}

function birdieDnaPublicDate_(value) {
  var text = String(value || "").trim();
  if (!text) return "";
  var match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text.slice(0, 10);
}

function birdieDnaRequireClaimTokenHash_(value) {
  var hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("INVALID_DNA_CLAIM_TOKEN_HASH");
  return hash;
}

function birdieDnaObjectInternalView_(object) {
  var result = {};
  Object.keys(object).forEach(function (key) {
    if (key !== "idempotencyKey") result[key] = object[key];
  });
  return result;
}

function birdieDnaRequireObjectFound_(objectId) {
  var found = birdieCoinFind_(
    birdieDnaSheet_(BIRDIE_DNA_SHEETS_.OBJECTS),
    "objectId",
    birdieCoinRequired_(objectId, "objectId")
  );
  if (!found) throw new Error("DNA_OBJECT_NOT_FOUND");
  return found;
}

function birdieDnaSheet_(name) {
  var sheet = birdieCoinSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("DNA_SHEET_NOT_INITIALIZED:" + name);
  return sheet;
}

function birdieDnaBoolean_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function birdieDnaSuccess_(data) {
  return { success: true, data: data };
}
