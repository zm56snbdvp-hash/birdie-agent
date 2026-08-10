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
  AUDIT: "AUDIT_EVENTS",
  AUTH_CHALLENGES: "SUPPORTER_AUTH_CHALLENGES",
  SESSIONS: "SUPPORTER_SESSIONS"
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
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.AUTH_CHALLENGES] = [
  "challengeId", "birdieId", "email", "emailBucketHash", "codeHash", "status", "attempts",
  "expiresAt", "createdAt", "verifiedAt", "consumedAt", "idempotencyKey"
];
BIRDIE_COIN_HEADERS_[BIRDIE_COIN_SHEETS_.SESSIONS] = [
  "sessionId", "birdieId", "tokenHash", "status", "createdAt", "expiresAt",
  "lastSeenAt", "revokedAt", "idempotencyKey"
];

var BIRDIE_COIN_ACTIONS_ = {
  PROFILE_REGISTERED: { accountTypes: ["PRIVATE", "B2B", "TEAM"], points: 1 },
  INSTAGRAM_VERIFIED: { accountTypes: ["PRIVATE", "B2B"], points: 1 },
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
    case "coinGetLedger": return birdieCoinGetLedger_(request);
    case "coinAwardBadge": return birdieCoinAwardBadge_(request);
    case "coinCreateClaim": return birdieCoinCreateClaim_(request);
    case "coinDecideClaim": return birdieCoinDecideClaim_(request);
    case "coinListRewards": return birdieCoinListRewards_(request);
    case "coinAdminQueue": return birdieCoinAdminQueue_(request);
    case "coinCreateRedemption": return birdieCoinCreateRedemption_(request);
    case "coinDecideRedemption": return birdieCoinDecideRedemption_(request);
    case "coinImportOpeningBalance": return birdieCoinImportOpeningBalance_(request);
    case "coinCreateLoginChallenge": return birdieCoinCreateLoginChallenge_(request);
    case "coinVerifyLoginChallenge": return birdieCoinVerifyLoginChallenge_(request);
    case "coinCreateSupporterSession": return birdieCoinCreateSupporterSession_(request);
    case "coinAuthorizeSupporterSession": return birdieCoinAuthorizeSupporterSession_(request);
    case "coinRevokeSupporterSession": return birdieCoinRevokeSupporterSession_(request);
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

function birdieCoinCreateClaim_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.CLAIMS);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sheet, "idempotencyKey", key);
    if (duplicate) return birdieCoinSuccess_(duplicate.object);

    var profile = birdieCoinRequireProfile_(request.birdieId);
    var actionCode = birdieCoinRequired_(request.actionCode, "actionCode").toUpperCase();
    var definition = BIRDIE_COIN_ACTIONS_[actionCode];
    if (!definition) throw new Error("UNKNOWN_ACTION_CODE");
    if (definition.accountTypes.indexOf(String(profile.accountType)) === -1) {
      throw new Error("ACTION_NOT_ALLOWED_FOR_ACCOUNT_TYPE");
    }

    var sourceReference = birdieCoinRequired_(request.sourceReference, "sourceReference");
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
      sourceType: birdieCoinRequired_(request.sourceType, "sourceType").toUpperCase(),
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
    if (String(claim.status) === targetStatus) return birdieCoinSuccess_(claim);
    if (String(claim.status) !== "PENDING") throw new Error("CLAIM_ALREADY_DECIDED");

    var approvedAmount = "";
    if (decision === "APPROVE") {
      approvedAmount = birdieCoinActionAmount_(claim.actionCode, request.approvedAmount);
      birdieCoinAppendTransaction_({
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

function birdieCoinCreateLoginChallenge_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var challengeSheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.AUTH_CHALLENGES);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(challengeSheet, "idempotencyKey", key);
    if (duplicate) {
      var duplicateResult = {
        accepted: true,
        deliverable: false,
        challengeId: duplicate.object.challengeId,
        expiresAt: duplicate.object.expiresAt
      };
      if (duplicate.object.birdieId) {
        var duplicateProfile = birdieCoinRequireProfile_(duplicate.object.birdieId);
        duplicateResult.deliverable = String(duplicate.object.status) === "ISSUED";
        duplicateResult.deliveryEmail = duplicateProfile.email;
        duplicateResult.displayName = duplicateProfile.displayName;
      }
      return birdieCoinSuccess_(duplicateResult);
    }

    var email = birdieCoinEmail_(request.email);
    var emailBucketHash = birdieCoinHash_(request.emailBucketHash, "emailBucketHash");
    var profileFound = birdieCoinFind_(birdieCoinSheet_(BIRDIE_COIN_SHEETS_.PROFILES), "email", email);
    var deliverable = Boolean(profileFound && String(profileFound.object.status) === "ACTIVE");

    var now = Date.now();
    var existingChallenges = birdieCoinObjects_(challengeSheet);
    var recent = existingChallenges.filter(function (row) {
      var created = Date.parse(String(row.createdAt || ""));
      return String(row.emailBucketHash) === emailBucketHash &&
        isFinite(created) && created >= now - 15 * 60 * 1000;
    });
    var cooldown = recent.some(function (row) {
      return Date.parse(String(row.createdAt || "")) >= now - 60 * 1000;
    });
    if (recent.length >= 3 || cooldown) {
      var latest = recent[recent.length - 1];
      return birdieCoinSuccess_({
        accepted: true,
        deliverable: false,
        challengeId: latest.challengeId,
        expiresAt: latest.expiresAt
      });
    }

    existingChallenges.forEach(function (row, index) {
      if (String(row.emailBucketHash) === emailBucketHash &&
          ["ISSUED", "UNDELIVERABLE"].indexOf(String(row.status)) !== -1) {
        row.status = "SUPERSEDED";
        birdieCoinWriteObject_(challengeSheet, index + 2, row);
      }
    });

    var expiresAt = birdieCoinExpiry_(request.expiresAt, 1, 15);
    var challenge = {
      challengeId: birdieCoinRequired_(request.challengeId, "challengeId"),
      birdieId: deliverable ? profileFound.object.birdieId : "",
      email: deliverable ? profileFound.object.email : "",
      emailBucketHash: emailBucketHash,
      codeHash: birdieCoinHash_(request.codeHash, "codeHash"),
      status: deliverable ? "ISSUED" : "UNDELIVERABLE",
      attempts: 0,
      expiresAt: expiresAt,
      createdAt: birdieCoinNow_(),
      verifiedAt: "",
      consumedAt: "",
      idempotencyKey: key
    };
    birdieCoinAppendObject_(challengeSheet, challenge);
    if (deliverable) {
      birdieCoinAudit_(
        "LOGIN_CHALLENGE_CREATED",
        "AUTH_CHALLENGE",
        challenge.challengeId,
        request.source,
        { challengeId: challenge.challengeId, birdieId: challenge.birdieId, expiresAt: expiresAt },
        "audit:" + key
      );
    }
    var result = {
      accepted: true,
      deliverable: deliverable,
      challengeId: challenge.challengeId,
      expiresAt: expiresAt
    };
    if (deliverable) {
      result.deliveryEmail = profileFound.object.email;
      result.displayName = profileFound.object.displayName;
    }
    return birdieCoinSuccess_(result);
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinVerifyLoginChallenge_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.AUTH_CHALLENGES);
    var found = birdieCoinFind_(sheet, "challengeId", birdieCoinRequired_(request.challengeId, "challengeId"));
    if (!found) throw new Error("LOGIN_CHALLENGE_NOT_FOUND");
    var challenge = found.object;
    if (String(challenge.status) === "LOCKED") throw new Error("LOGIN_CHALLENGE_LOCKED");
    if (["VERIFIED", "CONSUMED"].indexOf(String(challenge.status)) !== -1) {
      throw new Error("INVALID_LOGIN_CODE");
    }
    if (String(challenge.status) !== "ISSUED") throw new Error("INVALID_LOGIN_CODE");
    if (Date.parse(String(challenge.expiresAt)) <= Date.now()) {
      challenge.status = "EXPIRED";
      birdieCoinWriteObject_(sheet, found.row, challenge);
      throw new Error("LOGIN_CHALLENGE_EXPIRED");
    }

    var suppliedHash = birdieCoinHash_(request.codeHash, "codeHash");
    if (String(challenge.codeHash) !== suppliedHash) {
      challenge.attempts = Number(challenge.attempts || 0) + 1;
      if (challenge.attempts >= 5) challenge.status = "LOCKED";
      birdieCoinWriteObject_(sheet, found.row, challenge);
      throw new Error(challenge.status === "LOCKED" ? "LOGIN_CHALLENGE_LOCKED" : "INVALID_LOGIN_CODE");
    }

    challenge.status = "VERIFIED";
    challenge.verifiedAt = birdieCoinNow_();
    birdieCoinWriteObject_(sheet, found.row, challenge);
    birdieCoinAudit_(
      "LOGIN_CHALLENGE_VERIFIED",
      "AUTH_CHALLENGE",
      challenge.challengeId,
      request.source,
      { challengeId: challenge.challengeId, birdieId: challenge.birdieId },
      "verified:" + challenge.challengeId
    );
    return birdieCoinSuccess_({
      challengeId: challenge.challengeId,
      birdieId: challenge.birdieId
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinCreateSupporterSession_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sessionSheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.SESSIONS);
    var key = birdieCoinRequired_(request.idempotencyKey, "idempotencyKey");
    var duplicate = birdieCoinFind_(sessionSheet, "idempotencyKey", key);
    if (duplicate) {
      return birdieCoinSuccess_({
        sessionId: duplicate.object.sessionId,
        expiresAt: duplicate.object.expiresAt,
        profile: birdieCoinProfileView_(birdieCoinRequireProfile_(duplicate.object.birdieId))
      });
    }

    var challengeSheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.AUTH_CHALLENGES);
    var challengeFound = birdieCoinFind_(
      challengeSheet,
      "challengeId",
      birdieCoinRequired_(request.challengeId, "challengeId")
    );
    if (!challengeFound || String(challengeFound.object.status) !== "VERIFIED") {
      throw new Error("LOGIN_CHALLENGE_NOT_VERIFIED");
    }
    var birdieId = birdieCoinRequired_(request.birdieId, "birdieId");
    if (String(challengeFound.object.birdieId) !== birdieId) {
      throw new Error("LOGIN_CHALLENGE_PROFILE_MISMATCH");
    }
    var profile = birdieCoinRequireProfile_(birdieId);
    var expiresAt = birdieCoinExpiry_(request.expiresAt, 60, 8 * 24 * 60);
    var now = birdieCoinNow_();
    var session = {
      sessionId: birdieCoinRequired_(request.sessionId, "sessionId"),
      birdieId: birdieId,
      tokenHash: birdieCoinHash_(request.tokenHash, "tokenHash"),
      status: "ACTIVE",
      createdAt: now,
      expiresAt: expiresAt,
      lastSeenAt: now,
      revokedAt: "",
      idempotencyKey: key
    };
    birdieCoinAppendObject_(sessionSheet, session);

    challengeFound.object.status = "CONSUMED";
    challengeFound.object.consumedAt = now;
    birdieCoinWriteObject_(challengeSheet, challengeFound.row, challengeFound.object);
    birdieCoinAudit_(
      "SUPPORTER_SESSION_CREATED",
      "SESSION",
      session.sessionId,
      request.source,
      { sessionId: session.sessionId, birdieId: birdieId, expiresAt: expiresAt },
      "audit:" + key
    );
    return birdieCoinSuccess_({
      sessionId: session.sessionId,
      expiresAt: expiresAt,
      profile: birdieCoinProfileView_(profile)
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinAuthorizeSupporterSession_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.SESSIONS);
    var found = birdieCoinFind_(sheet, "tokenHash", birdieCoinHash_(request.tokenHash, "tokenHash"));
    if (!found) throw new Error("SESSION_NOT_FOUND");
    var session = found.object;
    if (String(session.status) === "REVOKED") throw new Error("SESSION_REVOKED");
    if (String(session.status) !== "ACTIVE") throw new Error("INVALID_SESSION");
    if (Date.parse(String(session.expiresAt)) <= Date.now()) {
      session.status = "EXPIRED";
      birdieCoinWriteObject_(sheet, found.row, session);
      throw new Error("SESSION_EXPIRED");
    }

    var lastSeen = Date.parse(String(session.lastSeenAt || session.createdAt));
    if (!isFinite(lastSeen) || lastSeen < Date.now() - 5 * 60 * 1000) {
      session.lastSeenAt = birdieCoinNow_();
      birdieCoinWriteObject_(sheet, found.row, session);
    }
    return birdieCoinSuccess_({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      profile: birdieCoinProfileView_(birdieCoinRequireProfile_(session.birdieId))
    });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinRevokeSupporterSession_(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.SESSIONS);
    var found = birdieCoinFind_(sheet, "tokenHash", birdieCoinHash_(request.tokenHash, "tokenHash"));
    if (!found) return birdieCoinSuccess_({ revoked: true });
    if (String(found.object.status) !== "REVOKED") {
      found.object.status = "REVOKED";
      found.object.revokedAt = birdieCoinNow_();
      birdieCoinWriteObject_(sheet, found.row, found.object);
      birdieCoinAudit_(
        "SUPPORTER_SESSION_REVOKED",
        "SESSION",
        found.object.sessionId,
        request.source,
        { sessionId: found.object.sessionId, birdieId: found.object.birdieId },
        "revoked:" + found.object.sessionId
      );
    }
    return birdieCoinSuccess_({ revoked: true });
  } finally {
    lock.releaseLock();
  }
}

function birdieCoinAppendTransaction_(input) {
  var sheet = birdieCoinSheet_(BIRDIE_COIN_SHEETS_.TRANSACTIONS);
  var duplicate = birdieCoinFind_(sheet, "idempotencyKey", input.idempotencyKey);
  if (duplicate) return duplicate.object;
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

function birdieCoinEmail_(value) {
  var email = birdieCoinRequired_(value, "email").toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("INVALID_EMAIL");
  }
  return email;
}

function birdieCoinHash_(value, field) {
  var hash = birdieCoinRequired_(value, field);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("INVALID_HASH:" + field);
  return hash;
}

function birdieCoinExpiry_(value, minimumMinutes, maximumMinutes) {
  var expiresAt = birdieCoinRequired_(value, "expiresAt");
  var timestamp = Date.parse(expiresAt);
  var remaining = timestamp - Date.now();
  if (!isFinite(timestamp) || remaining < minimumMinutes * 60 * 1000 || remaining > maximumMinutes * 60 * 1000) {
    throw new Error("INVALID_EXPIRY");
  }
  return new Date(timestamp).toISOString();
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
