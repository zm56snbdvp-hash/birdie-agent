/**
 * BIRDIE OS — Birdie Coin System V1
 *
 * Add this file to the authoritative Birdie OS Apps Script project and route
 * every action beginning with `coin` to handleBirdieCoinAction_(request).
 * Run setupBirdieCoinSystem_() once before the first request.
 */

var BIRDIE_COIN_SHEETS_ = {
  PROFILES: "BIRDIE_PROFILES",
  TRANSACTIONS: "COIN_TRANSACTIONS",
  CLAIMS: "ACTION_CLAIMS",
  REWARDS: "REWARDS",
  REDEMPTIONS: "REDEMPTIONS",
  BADGES: "USER_BADGES",
  AUDIT: "AUDIT_EVENTS"
};

var BIRDIE_COIN_HEADERS_ = {};
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.PROFILES] = [
  "birdieId", "displayName", "email", "accountType", "instagramHandle",
  "publicWall", "status", "profileOrigin", "joinedAt", "createdAt", "updatedAt",
  "idempotencyKey"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.TRANSACTIONS] = [
  "transactionId", "birdieId", "amount", "transactionType", "actionCode",
  "sourceType", "sourceReference", "status", "createdAt", "approvedAt",
  "approvedBy", "idempotencyKey", "note"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.CLAIMS] = [
  "claimId", "birdieId", "actionCode", "sourceType", "sourceReference",
  "evidenceUrl", "note", "status", "approvedAmount", "submittedAt",
  "decidedAt", "decidedBy", "decisionReason", "idempotencyKey"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.REWARDS] = [
  "rewardId", "accountType", "name", "price", "fulfillmentType", "status",
  "inventory", "createdAt", "updatedAt"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.REDEMPTIONS] = [
  "redemptionId", "birdieId", "rewardId", "price", "status", "requestedAt",
  "decidedAt", "decidedBy", "fulfilledAt", "decisionReason", "idempotencyKey"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.BADGES] = [
  "userBadgeId", "birdieId", "badgeCode", "badgeName", "awardedAt",
  "awardedBy", "note", "idempotencyKey"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.AUDIT] = [
  "auditId", "eventType", "entityType", "entityId", "actor", "createdAt",
  "detailsJson", "idempotencyKey"
];

var BIRDIE_COIN_ACTIONS_ = {
  PROFILE_REGISTERED: { accountTypes: ["PRIVATE", "B2B", "TEAM"], points: 1 },
  INSTAGRAM_VERIFIED: { accountTypes: ["PRIVATE", "B2B"], points: 1 },
  IG_COMMENT: {
    accountTypes: ["PRIVATE"],
    points: 1,
    sourceTypes: ["INSTAGRAM"],
    approvalMode: "MANUAL_APPROVAL",
    frequencyRule: "PER_DISTINCT_COMMENT",
    version: "V1",
    status: "ACTIVE",
    rolloutMode: "CONTROLLED_E2E"
  },
  COMMUNITY_CONTRIBUTION: { accountTypes: ["PRIVATE"], points: 1 },
  STORY_SHARE_TAGGED: { accountTypes: ["PRIVATE", "B2B"], points: 2 },
  UGC_APPROVED: { accountTypes: ["PRIVATE"], points: 3 },
  PRODUCT_REVIEW_VERIFIED: { accountTypes: ["PRIVATE"], points: 3 },
  REFERRAL_VERIFIED: { accountTypes: ["PRIVATE"], points: 5 },
  STARTER_KIT_PURCHASE: { accountTypes: ["PRIVATE"], points: 5 },
  BOOSTER_ORDER_PURCHASE: { accountTypes: ["PRIVATE"], points: 2 },
  COMMUNITY_HELP: { accountTypes: ["PRIVATE"], minPoints: 1, maxPoints: 10 },
  B2B_PROFILE_VERIFIED: { accountTypes: ["B2B"], points: 2 },
  B2B_FEED_OR_REEL: { accountTypes: ["B2B"], points: 4 },
  B2B_REFERRAL_VERIFIED: { accountTypes: ["B2B"], points: 8 },
  B2B_COMMUNITY_ACTION: { accountTypes: ["B2B"], minPoints: 5, maxPoints: 20 },
  B2B_PRODUCT_OR_EVENT_SUPPORT: {
    accountTypes: ["B2B"], minPoints: 5, maxPoints: 25
  }
};

var BIRDIE_COIN_LEVELS_ = [
  { code: "TEE_STARTER", name: "Tee Starter", minimum: 0 },
  { code: "FAIRWAY_FRIEND", name: "Fairway Friend", minimum: 10 },
  { code: "CLUBHOUSE_BIRDIE", name: "Clubhouse Birdie", minimum: 25 },
  { code: "FLOCK_CAPTAIN", name: "Flock Captain", minimum: 50 },
  { code: "BIRDIE_LEGEND", name: "Birdie Legend", minimum: 100 }
];

var BIRDIE_COIN_BADGES_ = {
  FOUNDING_BIRDIE: { name: "Founding Birdie", founderApprovalRequired: true },
  FIRST_FLOCK: { name: "First Flock", founderApprovalRequired: true },
  DAY_ONE_SUPPORTER: { name: "Day One Supporter", founderApprovalRequired: true },
  COMMUNITY_BUILDER: { name: "Community Builder", founderApprovalRequired: false }
};

var BIRDIE_COIN_PILOT_REWARDS_ = [
  ["RW-PRIVATE-WALLPAPER", "PRIVATE", "Exklusives Birdie-Wallpaper", 5, "DIGITAL"],
  ["RW-PRIVATE-SUPPORTER-WALL", "PRIVATE", "Name auf der digitalen Supporter Wall", 10, "MANUAL"],
  ["RW-PRIVATE-EARLY-ACCESS", "PRIVATE", "Early Access zum nächsten Produktdrop", 15, "DIGITAL"],
  ["RW-B2B-INTERACTION", "B2B", "Ehrlicher Account-Besuch und passende Interaktion", 10, "MANUAL"],
  ["RW-B2B-STORY-MENTION", "B2B", "Story-Erwähnung als Supporter", 20, "MANUAL"],
  ["RW-B2B-SUPPORTER-WALL", "B2B", "B2B-Profil auf der Supporter Wall", 25, "MANUAL"]
];

function setupBirdieCoinSystem_() {
  var spreadsheet = birdieCoinSpreadsheet_();
  Object.keys(BIRDIE_COIN_HEADERS_).forEach(function (sheetName) {
    birdieCoinEnsureSheet_(spreadsheet, sheetName, BIRDIE_COIN_HEADERS_[sheetName]);
  });
  birdieCoinSeedRewards_();
  return { success: true, data: { initialized: true } };
}

function handleBirdieCoinAction_(request) {
  request = request || {};
  setupBirdieCoinSystem_();

  switch (String(request.action || "")) {
    case "coinCreateProfile": return birdieCoinCreateProfile_(request);
    case "coinGetProfile": return birdieCoinGetProfile_(request);
    case "coinLinkInstagramHandle": return birdieCoinLinkInstagramHandle_(request);
    case "coinGetLedger": return birdieCoinGetLedger_(request);
    case "coinGetSocialEvent": return birdieSocialGetEvent_(request);
    case "coinBindInstagramCommentIdentity": return birdieSocialBindInstagramCommentIdentity_(request);
    case "coinCreateInstagramCommentClaim": return birdieSocialCreateInstagramCommentClaim_(request);
    case "coinMarkInstagramCommentWritten": return birdieSocialMarkInstagramCommentWritten_(request);
    case "coinAwardBadge": return birdieCoinAwardBadge_(request);
    case "coinCreateClaim": return birdieCoinCreateClaim_(request, "");
    case "coinDecideClaim": return birdieCoinDecideClaim_(request);
    case "coinListRewards": return birdieCoinListRewards_(request);
    case "coinAdminQueue": return birdieCoinAdminQueue_(request);
    case "coinCreateRedemption": return birdieCoinCreateRedemption_(request);
    case "coinDecideRedemption": return birdieCoinDecideRedemption_(request);
    case "coinImportOpeningBalance": return birdieCoinImportOpeningBalance_(request);
    default: throw new Error("UNKNOWN_BIRDIE_COIN_ACTION");
  }
}

function birdieCoinCreateProfile_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var migrationProfile = request.migrationProfile === true;
    if (migrationProfile && request.founderApproved !== true) {
      throw new Error("FOUNDER_APPROVAL_REQUIRED");
    }
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.PROFILES);
    var existingByKey = birdieCoinFind_(sheet, "idempotencyKey", birdieCoinRequired_(request.idempotencyKey, "idempotencyKey"));
    if (existingByKey) {
      if (String(existingByKey.object.profileOrigin) !== "FOUNDING_MIGRATION") {
        birdieCoinEnsureRegistrationCredit_(existingByKey.object, request.source);
      }
      return birdieCoinSuccess_(birdieCoinProfileView_(existingByKey.object));
    }

    var email = birdieCoinRequired_(request.email, "email").toLowerCase();
    if (birdieCoinFind_(sheet, "email", email)) throw new Error("EMAIL_ALREADY_REGISTERED");

    var accountType = birdieCoinAccountType_(request.accountType);
    var now = birdieCoinNow_();
    var profile = {
      birdieId: birdieCoinId_("BIRDIE"),
      displayName: birdieCoinRequired_(request.displayName, "displayName"),
      email: email,
      accountType: accountType,
      instagramHandle: String(request.instagramHandle || ""),
      publicWall: request.publicWall === true,
      status: "ACTIVE",
      profileOrigin: migrationProfile ? "FOUNDING_MIGRATION" : "ORGANIC",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: request.idempotencyKey
    };
    birdieCoinAppendObject_(sheet, profile);
    if (!migrationProfile) birdieCoinEnsureRegistrationCredit_(profile, request.source);
    birdieCoinAudit_("PROFILE_CREATED", "PROFILE", profile.birdieId, request.source, profile, request.idempotencyKey);
    return birdieCoinSuccess_(birdieCoinProfileView_(profile));
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinEnsureRegistrationCredit_(profile, actor) {
  return birdieCoinAppendTransaction_({
    birdieId: profile.birdieId,
    amount: BIRDIE_COIN_ACTIONS_.PROFILE_REGISTERED.points,
    transactionType: "EARN",
    actionCode: "PROFILE_REGISTERED",
    sourceType: "SYSTEM",
    sourceReference: profile.birdieId,
    status: "APPROVED",
    approvedBy: String(actor || "Birdie Agent"),
    idempotencyKey: "profile-registration:" + profile.birdieId,
    note: "Welcome Birdie"
  });
}

function birdieCoinGetProfile_(request) {
  var profile = birdieCoinRequireProfile_(request.birdieId);
  return birdieCoinSuccess_(birdieCoinProfileView_(profile));
}

function birdieCoinLinkInstagramHandle_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
    var instagramHandle = birdieCoinNormalizeInstagramHandle_(request.instagramHandle);
    var idempotencyKey = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.PROFILES);
    var target = birdieCoinFind_(sheet, "birdieId", birdieId);

    if (!target) throw new Error("BIRDIE_PROFILE_NOT_FOUND");
    if (String(target.object.status) !== "ACTIVE") {
      throw new Error("BIRDIE_PROFILE_NOT_ACTIVE");
    }

    var conflict = birdieCoinObjects_(sheet).some(function (profile) {
      if (String(profile.status) !== "ACTIVE") return false;
      if (String(profile.birdieId) === birdieId) return false;
      var existingHandle = String(profile.instagramHandle || "").trim();
      return existingHandle &&
        birdieCoinNormalizeInstagramHandle_(existingHandle) === instagramHandle;
    });
    if (conflict) throw new Error("INSTAGRAM_HANDLE_ALREADY_LINKED");

    var targetExistingHandle = String(target.object.instagramHandle || "").trim();
    if (targetExistingHandle) {
      if (birdieCoinNormalizeInstagramHandle_(targetExistingHandle) === instagramHandle) {
        birdieCoinAudit_(
          "INSTAGRAM_HANDLE_LINKED",
          "PROFILE",
          birdieId,
          request.source,
          { instagramHandle: instagramHandle },
          idempotencyKey
        );
        return birdieCoinSuccess_({
          profile: birdieCoinProfileView_(target.object),
          idempotent: true
        });
      }
      throw new Error("INSTAGRAM_HANDLE_CHANGE_REQUIRES_REVIEW");
    }

    var updatedAt = birdieCoinNow_();
    birdieCoinWriteInstagramHandle_(
      sheet,
      target.row,
      instagramHandle,
      updatedAt
    );
    SpreadsheetApp.flush();

    var readback = birdieCoinFind_(sheet, "birdieId", birdieId);
    var readbackMatches = false;
    var preservedFieldsMatch = readback && Object.keys(target.object).every(function (field) {
      if (field === "instagramHandle" || field === "updatedAt") return true;
      return String(readback.object[field]) === String(target.object[field]);
    });
    if (readback &&
        String(readback.object.birdieId) === birdieId &&
        String(readback.object.status) === "ACTIVE" &&
        String(readback.object.updatedAt) === updatedAt &&
        preservedFieldsMatch) {
      try {
        readbackMatches = birdieCoinNormalizeInstagramHandle_(
          readback.object.instagramHandle
        ) === instagramHandle;
      } catch (readbackError) {
        readbackMatches = false;
      }
    }
    if (!readbackMatches) {
      throw new Error("INSTAGRAM_HANDLE_READBACK_MISMATCH");
    }

    birdieCoinAudit_(
      "INSTAGRAM_HANDLE_LINKED",
      "PROFILE",
      birdieId,
      request.source,
      { instagramHandle: instagramHandle },
      idempotencyKey
    );
    return birdieCoinSuccess_({
      profile: birdieCoinProfileView_(readback.object),
      idempotent: false
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinGetLedger_(request) {
  var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
  birdieCoinRequireProfile_(birdieId);
  var transactions = birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.TRANSACTIONS)).filter(function (row) {
    return String(row.birdieId) === birdieId;
  });
  return birdieCoinSuccess_({
    birdieId: birdieId,
    balances: birdieCoinBalances_(birdieId),
    transactions: transactions
  });
}

function birdieCoinAwardBadge_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var profile = birdieCoinRequireProfile_(request.birdieId);
    var badgeCode = birdieCoinRequired_(request.badgeCode, "badgeCode").toUpperCase();
    var definition = BIRDIE_COIN_BADGES_[badgeCode];
    if (!definition) throw new Error("UNKNOWN_BADGE_CODE");
    if (definition.founderApprovalRequired && request.founderApproved !== true) {
      throw new Error("FOUNDER_APPROVAL_REQUIRED");
    }

    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.BADGES);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) return birdieCoinSuccess_(duplicate.object);
    var existing = null;
    birdieCoinObjects_(sheet).some(function (row) {
      if (String(row.birdieId) === String(profile.birdieId) && String(row.badgeCode) === badgeCode) {
        existing = row;
        return true;
      }
      return false;
    });
    if (existing) return birdieCoinSuccess_(existing);

    var badge = {
      userBadgeId: birdieCoinId_("BADGE"),
      birdieId: profile.birdieId,
      badgeCode: badgeCode,
      badgeName: definition.name,
      awardedAt: birdieCoinNow_(),
      awardedBy: String(request.actor || "Birdie Agent"),
      note: String(request.note || ""),
      idempotencyKey: key
    };
    birdieCoinAppendObject_(sheet, badge);
    birdieCoinAudit_("BADGE_AWARDED", "PROFILE", profile.birdieId, badge.awardedBy, badge, key);
    return birdieCoinSuccess_({ badge: badge, profile: birdieCoinProfileView_(profile) });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinCreateClaim_(request, dedicatedActionCode) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (
      request.amount !== undefined ||
      request.points !== undefined ||
      request.approvedAmount !== undefined
    ) {
      throw new Error("CLIENT_AMOUNT_FORBIDDEN");
    }
    var requestedActionCode = birdieCoinRequired_(
      request.actionCode,
      "actionCode"
    ).toUpperCase();
    if (
      requestedActionCode === "IG_COMMENT" &&
      dedicatedActionCode !== "IG_COMMENT"
    ) {
      throw new Error("DEDICATED_IG_COMMENT_ACTION_REQUIRED");
    }
    var profile = birdieCoinRequireProfile_(request.birdieId);
    var actionCode = requestedActionCode;
    var definition = BIRDIE_COIN_ACTIONS_[actionCode];
    if (!definition) throw new Error("UNKNOWN_ACTION_CODE");
    if (dedicatedActionCode && actionCode !== dedicatedActionCode) {
      throw new Error("DEDICATED_ACTION_MISMATCH");
    }
    if (definition.accountTypes.indexOf(String(profile.accountType)) === -1) {
      throw new Error("ACTION_NOT_ALLOWED_FOR_ACCOUNT_TYPE");
    }

    var sourceType = birdieCoinRequired_(
      request.sourceType,
      "sourceType"
    ).toUpperCase();
    var sourceReference = birdieCoinRequired_(request.sourceReference, "sourceReference");
    var socialEvent = null;
    if (actionCode === "IG_COMMENT") {
      socialEvent = birdieSocialValidateInstagramCommentClaim_(profile, request);
    }

    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.CLAIMS);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) {
      if (
        String(duplicate.object.birdieId) !== String(profile.birdieId) ||
        String(duplicate.object.actionCode) !== actionCode ||
        String(duplicate.object.sourceType) !== sourceType ||
        String(duplicate.object.sourceReference) !== sourceReference
      ) {
        throw new Error("CLAIM_IDEMPOTENCY_CONFLICT");
      }
      if (actionCode === "IG_COMMENT") {
        var duplicateStatus = String(duplicate.object.status);
        if (
          ["PENDING", "APPROVED", "REJECTED"].indexOf(
            duplicateStatus
          ) === -1
        ) {
          throw new Error("INVALID_IG_COMMENT_CLAIM_STATUS");
        }
        if (duplicateStatus === "APPROVED") {
          if (Number(duplicate.object.approvedAmount) !== 1) {
            throw new Error("INVALID_IG_COMMENT_APPROVED_AMOUNT");
          }
          birdieSocialRequireInstagramCommentLedgerProof_(
            duplicate.object,
            socialEvent
          );
        }
        if (
          String(socialEvent.coinWriteStatus) === "WRITTEN" &&
          duplicateStatus !== "APPROVED"
        ) {
          throw new Error("WRITTEN_EVENT_REQUIRES_APPROVED_CLAIM");
        }
      }
      birdieCoinAudit_(
        "CLAIM_CREATED",
        "CLAIM",
        duplicate.object.claimId,
        request.source,
        duplicate.object,
        key
      );
      return birdieCoinSuccess_(duplicate.object);
    }
    if (
      socialEvent &&
      String(socialEvent.coinWriteStatus) === "WRITTEN"
    ) {
      throw new Error("IG_COMMENT_EVENT_ALREADY_WRITTEN");
    }

    var sameSource = birdieCoinObjects_(sheet).some(function (row) {
      return String(row.birdieId) === String(profile.birdieId) &&
        String(row.actionCode) === actionCode &&
        String(row.sourceReference) === sourceReference &&
        String(row.status) !== "REJECTED";
    });
    if (sameSource) throw new Error("DUPLICATE_CLAIM_SOURCE");

    var claim = {
      claimId: birdieCoinId_("CLAIM"),
      birdieId: profile.birdieId,
      actionCode: actionCode,
      sourceType: sourceType,
      sourceReference: sourceReference,
      evidenceUrl: String(request.evidenceUrl || ""),
      note: String(request.note || ""),
      status: "PENDING",
      approvedAmount: "",
      submittedAt: birdieCoinNow_(),
      decidedAt: "",
      decidedBy: "",
      decisionReason: "",
      idempotencyKey: key
    };
    birdieCoinAppendObject_(sheet, claim);
    birdieCoinAudit_("CLAIM_CREATED", "CLAIM", claim.claimId, request.source, claim, key);
    return birdieCoinSuccess_(claim);
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinDecideClaim_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var decisionKey = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.CLAIMS);
    var found = birdieCoinFind_(sheet, "claimId", birdieCoinRequired_(request.claimId, "claimId"));
    if (!found) throw new Error("CLAIM_NOT_FOUND");
    var claim = found.object;
    var decision = birdieCoinRequired_(request.decision, "decision").toUpperCase();
    var targetStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "";
    if (!targetStatus) throw new Error("INVALID_CLAIM_DECISION");
    var instagramCommentEvent = null;
    if (
      decision === "APPROVE" &&
      String(claim.actionCode) === "IG_COMMENT"
    ) {
      birdieSocialRequireConfirmation_(
        request.confirmation,
        BIRDIE_SOCIAL_CONFIRMATIONS_.APPROVE_CLAIM
      );
      if (request.approvedAmount !== undefined && request.approvedAmount !== "") {
        throw new Error("CLIENT_AMOUNT_FORBIDDEN");
      }
      instagramCommentEvent = birdieSocialValidateInstagramCommentApproval_(
        claim,
        request
      );
    }
    if (
      decision === "REJECT" &&
      String(claim.actionCode) === "IG_COMMENT"
    ) {
      birdieSocialAssertInstagramCommentRejectable_(claim);
    }
    if (String(claim.status) === targetStatus) {
      birdieCoinAudit_(
        "CLAIM_" + targetStatus,
        "CLAIM",
        claim.claimId,
        String(request.actor || "Birdie Agent"),
        claim,
        decisionKey
      );
      return birdieCoinSuccess_(claim);
    }
    if (String(claim.status) !== "PENDING") throw new Error("CLAIM_ALREADY_DECIDED");

    var approvedAmount = "";
    if (decision === "APPROVE") {
      approvedAmount = birdieCoinActionAmount_(claim.actionCode, request.approvedAmount);
      var transaction = birdieCoinAppendTransaction_({
        birdieId: claim.birdieId,
        amount: approvedAmount,
        transactionType: "EARN",
        actionCode: claim.actionCode,
        sourceType: claim.sourceType,
        sourceReference: claim.sourceReference,
        status: "APPROVED",
        approvedBy: String(request.actor || "Birdie Agent"),
        idempotencyKey: "claim:" + claim.claimId,
        note: claim.note
      });
      if (String(claim.actionCode) === "IG_COMMENT") {
        birdieSocialRequireInstagramCommentLedgerProof_(
          claim,
          instagramCommentEvent
        );
      }
    }

    claim.status = targetStatus;
    claim.approvedAmount = approvedAmount;
    claim.decidedAt = birdieCoinNow_();
    claim.decidedBy = String(request.actor || "Birdie Agent");
    claim.decisionReason = String(request.reason || "");
    birdieCoinWriteObject_(sheet, found.row, claim);
    birdieCoinAudit_("CLAIM_" + targetStatus, "CLAIM", claim.claimId, claim.decidedBy, claim, decisionKey);
    return birdieCoinSuccess_({ claim: claim, profile: birdieCoinProfileView_(birdieCoinRequireProfile_(claim.birdieId)) });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinListRewards_(request) {
  var accountType = request.accountType ? birdieCoinAccountType_(request.accountType) : "";
  var rewards = birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REWARDS)).filter(function (row) {
    return String(row.status) === "ACTIVE" && (!accountType || String(row.accountType) === accountType);
  });
  return birdieCoinSuccess_({ rewards: rewards });
}

function birdieCoinAdminQueue_() {
  var claims = birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.CLAIMS)).filter(function (row) {
    return String(row.status) === "PENDING";
  });
  var redemptions = birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REDEMPTIONS)).filter(function (row) {
    return ["REQUESTED", "APPROVED"].indexOf(String(row.status)) !== -1;
  });
  return birdieCoinSuccess_({ claims: claims, redemptions: redemptions });
}

function birdieCoinCreateRedemption_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REDEMPTIONS);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) return birdieCoinSuccess_(duplicate.object);

    var profile = birdieCoinRequireProfile_(request.birdieId);
    var rewardFound = birdieCoinFind_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REWARDS), "rewardId", birdieCoinRequired_(request.rewardId, "rewardId"));
    if (!rewardFound || String(rewardFound.object.status) !== "ACTIVE") throw new Error("REWARD_NOT_AVAILABLE");
    var reward = rewardFound.object;
    if (String(reward.accountType) !== String(profile.accountType)) throw new Error("REWARD_NOT_ALLOWED_FOR_ACCOUNT_TYPE");

    var price = birdieCoinPositiveInteger_(reward.price, "reward.price");
    var balances = birdieCoinBalances_(profile.birdieId);
    if (balances.available < price) throw new Error("INSUFFICIENT_BIRDIES");

    var redemption = {
      redemptionId: birdieCoinId_("REDEEM"),
      birdieId: profile.birdieId,
      rewardId: reward.rewardId,
      price: price,
      status: "REQUESTED",
      requestedAt: birdieCoinNow_(),
      decidedAt: "",
      decidedBy: "",
      fulfilledAt: "",
      decisionReason: "",
      idempotencyKey: key
    };
    birdieCoinAppendObject_(sheet, redemption);
    birdieCoinAppendTransaction_({
      birdieId: profile.birdieId,
      amount: -price,
      transactionType: "REDEEM",
      actionCode: "REWARD_REDEMPTION",
      sourceType: "REWARD_SHOP",
      sourceReference: redemption.redemptionId,
      status: "PENDING",
      approvedBy: "",
      idempotencyKey: "redemption:" + redemption.redemptionId,
      note: String(reward.name)
    });
    birdieCoinAudit_("REDEMPTION_REQUESTED", "REDEMPTION", redemption.redemptionId, request.source, redemption, key);
    return birdieCoinSuccess_({ redemption: redemption, balances: birdieCoinBalances_(profile.birdieId) });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinDecideRedemption_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var decisionKey = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REDEMPTIONS);
    var found = birdieCoinFind_(sheet, "redemptionId", birdieCoinRequired_(request.redemptionId, "redemptionId"));
    if (!found) throw new Error("REDEMPTION_NOT_FOUND");
    var redemption = found.object;
    var decision = birdieCoinRequired_(request.decision, "decision").toUpperCase();
    var actor = String(request.actor || "Birdie Agent");
    var transactionSheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.TRANSACTIONS);
    var reservation = birdieCoinFind_(transactionSheet, "idempotencyKey", "redemption:" + redemption.redemptionId);
    if (!reservation) throw new Error("REDEMPTION_RESERVATION_NOT_FOUND");

    if (decision === "APPROVE") {
      if (String(redemption.status) === "APPROVED") return birdieCoinSuccess_(redemption);
      if (String(redemption.status) !== "REQUESTED") throw new Error("INVALID_REDEMPTION_TRANSITION");
      reservation.object.status = "APPROVED";
      reservation.object.approvedAt = birdieCoinNow_();
      reservation.object.approvedBy = actor;
      birdieCoinWriteObject_(transactionSheet, reservation.row, reservation.object);
      redemption.status = "APPROVED";
    } else if (decision === "FULFILL") {
      if (String(redemption.status) === "FULFILLED") return birdieCoinSuccess_(redemption);
      if (String(redemption.status) !== "APPROVED") throw new Error("INVALID_REDEMPTION_TRANSITION");
      redemption.status = "FULFILLED";
      redemption.fulfilledAt = birdieCoinNow_();
    } else if (decision === "REJECT" || decision === "CANCEL") {
      if (["REJECTED", "CANCELLED"].indexOf(String(redemption.status)) !== -1) return birdieCoinSuccess_(redemption);
      if (String(redemption.status) === "REQUESTED") {
        reservation.object.status = "REJECTED";
        birdieCoinWriteObject_(transactionSheet, reservation.row, reservation.object);
      } else if (String(redemption.status) === "APPROVED") {
        birdieCoinAppendTransaction_({
          birdieId: redemption.birdieId,
          amount: Number(redemption.price),
          transactionType: "REVERSAL",
          actionCode: "REWARD_REDEMPTION_CANCELLED",
          sourceType: "REWARD_SHOP",
          sourceReference: redemption.redemptionId,
          status: "APPROVED",
          approvedBy: actor,
          idempotencyKey: "redemption-reversal:" + redemption.redemptionId,
          note: String(request.reason || "")
        });
      } else {
        throw new Error("INVALID_REDEMPTION_TRANSITION");
      }
      redemption.status = decision === "REJECT" ? "REJECTED" : "CANCELLED";
    } else {
      throw new Error("INVALID_REDEMPTION_DECISION");
    }

    redemption.decidedAt = birdieCoinNow_();
    redemption.decidedBy = actor;
    redemption.decisionReason = String(request.reason || "");
    birdieCoinWriteObject_(sheet, found.row, redemption);
    birdieCoinAudit_("REDEMPTION_" + redemption.status, "REDEMPTION", redemption.redemptionId, actor, redemption, decisionKey);
    return birdieCoinSuccess_({ redemption: redemption, balances: birdieCoinBalances_(redemption.birdieId) });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinImportOpeningBalance_(request) {
  if (request.founderApproved !== true) throw new Error("FOUNDER_APPROVAL_REQUIRED");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var profile = birdieCoinRequireProfile_(request.birdieId);
    var transaction = birdieCoinAppendTransaction_({
      birdieId: profile.birdieId,
      amount: birdieCoinPositiveInteger_(request.amount, "amount"),
      transactionType: "ADJUSTMENT",
      actionCode: "MIGRATION_OPENING_BALANCE",
      sourceType: "ADMIN",
      sourceReference: birdieCoinRequired_(request.sourceReference, "sourceReference"),
      status: "APPROVED",
      approvedBy: String(request.actor || "Kevin Stroop"),
      idempotencyKey: birdieCoinRequired_(request.idempotencyKey, "idempotencyKey"),
      note: "Founder-approved supporter score migration"
    });
    birdieCoinAudit_("OPENING_BALANCE_IMPORTED", "TRANSACTION", transaction.transactionId, request.actor, transaction, request.idempotencyKey);
    return birdieCoinSuccess_({ transaction: transaction, profile: birdieCoinProfileView_(profile) });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinAppendTransaction_(input) {
  var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.TRANSACTIONS);
  var duplicate = birdieCoinFind_(sheet, "idempotencyKey", input.idempotencyKey);
  if (duplicate) {
    if (
      String(duplicate.object.birdieId) !== String(input.birdieId) ||
      Number(duplicate.object.amount) !== Number(input.amount) ||
      String(duplicate.object.transactionType) !== String(input.transactionType) ||
      String(duplicate.object.actionCode) !== String(input.actionCode) ||
      String(duplicate.object.sourceType) !== String(input.sourceType) ||
      String(duplicate.object.sourceReference) !== String(input.sourceReference) ||
      String(duplicate.object.status) !== String(input.status)
    ) {
      throw new Error("TRANSACTION_IDEMPOTENCY_CONFLICT");
    }
    return duplicate.object;
  }
  var now = birdieCoinNow_();
  var transaction = {
    transactionId: birdieCoinId_("TX"),
    birdieId: input.birdieId,
    amount: Number(input.amount),
    transactionType: input.transactionType,
    actionCode: input.actionCode,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
    status: input.status,
    createdAt: now,
    approvedAt: input.status === "APPROVED" ? now : "",
    approvedBy: input.approvedBy || "",
    idempotencyKey: input.idempotencyKey,
    note: input.note || ""
  };
  birdieCoinAppendObject_(sheet, transaction);
  return transaction;
}

function birdieCoinBalances_(birdieId) {
  var confirmed = 0;
  var reserved = 0;
  var lifetime = 0;
  birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.TRANSACTIONS)).forEach(function (row) {
    if (String(row.birdieId) !== String(birdieId)) return;
    var amount = Number(row.amount) || 0;
    if (String(row.status) === "APPROVED") {
      confirmed += amount;
      if (["EARN", "ADJUSTMENT"].indexOf(String(row.transactionType)) !== -1) {
        lifetime += amount;
      }
    } else if (String(row.status) === "PENDING" && amount < 0) {
      reserved += amount;
    }
  });
  return {
    confirmed: confirmed,
    reserved: Math.abs(reserved),
    available: confirmed + reserved,
    lifetime: Math.max(0, lifetime),
    level: birdieCoinLevel_(Math.max(0, lifetime))
  };
}

function birdieCoinProfileView_(profile) {
  var result = {};
  Object.keys(profile).forEach(function (key) {
    if (key !== "idempotencyKey") result[key] = profile[key];
  });
  result.balances = birdieCoinBalances_(profile.birdieId);
  result.badges = birdieCoinObjects_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.BADGES)).filter(function (row) {
    return String(row.birdieId) === String(profile.birdieId);
  });
  return result;
}

function birdieCoinActionAmount_(actionCode, requestedAmount) {
  var definition = BIRDIE_COIN_ACTIONS_[String(actionCode)];
  if (!definition) throw new Error("UNKNOWN_ACTION_CODE");
  if (definition.points) return definition.points;
  var amount = birdieCoinPositiveInteger_(requestedAmount, "approvedAmount");
  if (amount < definition.minPoints || amount > definition.maxPoints) {
    throw new Error("APPROVED_AMOUNT_OUTSIDE_ACTION_RANGE");
  }
  return amount;
}

function birdieCoinLevel_(lifetime) {
  var current = BIRDIE_COIN_LEVELS_[0];
  BIRDIE_COIN_LEVELS_.forEach(function (level) {
    if (lifetime >= level.minimum) current = level;
  });
  return current;
}

function birdieCoinSeedRewards_() {
  var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.REWARDS);
  if (sheet.getLastRow() > 1) return;
  var now = birdieCoinNow_();
  BIRDIE_COIN_PILOT_REWARDS_.forEach(function (reward) {
    birdieCoinAppendObject_(sheet, {
      rewardId: reward[0], accountType: reward[1], name: reward[2], price: reward[3],
      fulfillmentType: reward[4], status: "ACTIVE", inventory: "UNLIMITED",
      createdAt: now, updatedAt: now
    });
  });
}

function birdieCoinRequireProfile_(birdieId) {
  var found = birdieCoinFind_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.PROFILES), "birdieId", birdieCoinRequired_(birdieId, "birdieId"));
  if (!found) throw new Error("BIRDIE_PROFILE_NOT_FOUND");
  if (String(found.object.status) !== "ACTIVE") throw new Error("BIRDIE_PROFILE_NOT_ACTIVE");
  return found.object;
}

function birdieCoinAudit_(eventType, entityType, entityId, actor, details, key) {
  var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.AUDIT);
  if (key && birdieCoinFind_(sheet, "idempotencyKey", key)) return;
  birdieCoinAppendObject_(sheet, {
    auditId: birdieCoinId_("AUDIT"), eventType: eventType, entityType: entityType,
    entityId: entityId, actor: String(actor || "Birdie Agent"), createdAt: birdieCoinNow_(),
    detailsJson: JSON.stringify(details || {}), idempotencyKey: String(key || "")
  });
}

function birdieCoinSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("BIRDIE_COIN_SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("BIRDIE_COIN_SPREADSHEET_ID_MISSING");
  return active;
}

function birdieCoinEnsureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (actual.join("|") !== headers.join("|")) throw new Error("INVALID_COIN_SHEET_HEADERS:" + name);
  sheet.setFrozenRows(1);
  return sheet;
}

function birdieCoinSheet_(name) {
  var sheet = birdieCoinSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("COIN_SHEET_NOT_INITIALIZED:" + name);
  return sheet;
}

function birdieCoinObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function (row) {
    var object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  });
}

function birdieCoinFind_(sheet, field, value) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var column = headers.indexOf(field);
  if (column === -1 || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][column]) === String(value)) {
      var object = {};
      headers.forEach(function (header, headerIndex) { object[header] = values[index][headerIndex]; });
      return { row: index + 2, object: object };
    }
  }
  return null;
}

function birdieCoinAppendObject_(sheet, object) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (header) {
    return object[header] === undefined ? "" : object[header];
  }));
}

function birdieCoinWriteInstagramHandle_(sheet, rowNumber, instagramHandle, updatedAt) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var instagramColumn = headers.indexOf("instagramHandle");
  var updatedAtColumn = headers.indexOf("updatedAt");
  if (instagramColumn === -1 || updatedAtColumn === -1) {
    throw new Error("INVALID_COIN_SHEET_HEADERS:" + BIRDIE_COIN_SHEETS_.PROFILES);
  }
  // Write the authoritative link last so an earlier cell-write failure cannot expose it.
  sheet.getRange(rowNumber, updatedAtColumn + 1, 1, 1).setValue(updatedAt);
  sheet.getRange(rowNumber, instagramColumn + 1, 1, 1).setValue(instagramHandle);
}

function birdieCoinWriteObject_(sheet, rowNumber, object) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (header) {
    return object[header] === undefined ? "" : object[header];
  })]);
}

function birdieCoinRequired_(value, field) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!result) throw new Error("MISSING_FIELD:" + field);
  return result;
}

function birdieCoinNormalizeInstagramHandle_(value) {
  var handle = birdieCoinRequired_(value, "instagramHandle")
    .toLowerCase()
    .replace(/^@/, "");
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    throw new Error("INVALID_INSTAGRAM_HANDLE");
  }
  return handle;
}

function birdieCoinPositiveInteger_(value, field) {
  var number = Number(value);
  if (!isFinite(number) || Math.floor(number) !== number || number <= 0) {
    throw new Error("INVALID_POSITIVE_INTEGER:" + field);
  }
  return number;
}

function birdieCoinAccountType_(value) {
  var accountType = birdieCoinRequired_(value, "accountType").toUpperCase();
  if (["PRIVATE", "B2B", "TEAM"].indexOf(accountType) === -1) throw new Error("INVALID_ACCOUNT_TYPE");
  return accountType;
}

function birdieCoinId_(prefix) {
  return prefix + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function birdieCoinNow_() {
  return new Date().toISOString();
}

function birdieCoinSuccess_(data) {
  return { success: true, data: data };
}
