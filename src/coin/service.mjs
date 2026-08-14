import {
  ACTION_DEFINITIONS,
  BADGE_DEFINITIONS,
  getPublicCoinConfig
} from "./catalog.mjs";
import {
  CoinValidationError,
  compact,
  optionalAccountType,
  optionalPositiveInteger,
  optionalString,
  requireAccountType,
  requireActionCode,
  requireBadgeCode,
  requireClaimDecision,
  requireObject,
  requirePositiveInteger,
  requireRedemptionDecision,
  requireString
} from "./validation.mjs";

function rejectClientControlledAmount(body) {
  if (
    body.amount !== undefined ||
    body.points !== undefined ||
    body.approvedAmount !== undefined
  ) {
    throw new CoinValidationError(
      "CLIENT_AMOUNT_FORBIDDEN",
      "Coin amounts are determined by the authoritative action or reward rule"
    );
  }
}

function requireIdempotencyKey(body) {
  return requireString(body.idempotencyKey, "idempotencyKey", 160);
}

function normalizeInstagramHandle(value, { required = false } = {}) {
  const rawHandle = required
    ? requireString(value, "instagramHandle", 80)
    : optionalString(value, "instagramHandle", 80);

  if (rawHandle === undefined) return undefined;

  const handle = String(rawHandle).trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    throw new CoinValidationError(
      "INVALID_INSTAGRAM_HANDLE",
      "instagramHandle must contain only a-z, 0-9, periods, or underscores and be at most 30 characters"
    );
  }

  return handle;
}

const INSTAGRAM_COMMENT_CONFIRMATIONS = Object.freeze({
  bindIdentity: "BIND_IG_COMMENT_IDENTITY",
  createClaim: "CREATE_IG_COMMENT_CLAIM",
  markWritten: "MARK_IG_COMMENT_WRITTEN"
});

function requireExactConfirmation(body, expected) {
  const confirmation = requireString(body.confirmation, "confirmation", 80);
  if (confirmation !== expected) {
    throw new CoinValidationError(
      "INVALID_CONFIRMATION",
      `confirmation must equal ${expected}`
    );
  }
  return confirmation;
}

export function createCoinService({ birdieOSPost }) {
  if (typeof birdieOSPost !== "function") {
    throw new Error("birdieOSPost dependency is required");
  }

  async function post(action, payload = {}) {
    const result = await birdieOSPost({ action, ...payload });
    return result.data;
  }

  return {
    getConfig() {
      return getPublicCoinConfig();
    },

    async createProfile(input) {
      const body = requireObject(input);
      const migrationProfile = body.migrationProfile === true;

      if (migrationProfile && body.founderApproved !== true) {
        throw new CoinValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          "Legacy supporter profiles require explicit founder approval",
          403
        );
      }

      return post("coinCreateProfile", compact({
        displayName: requireString(body.displayName, "displayName", 100),
        email: requireString(body.email, "email", 254).toLowerCase(),
        accountType: requireAccountType(body.accountType),
        instagramHandle: normalizeInstagramHandle(body.instagramHandle),
        publicWall: body.publicWall === true,
        migrationProfile,
        founderApproved: migrationProfile ? true : undefined,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async getProfile(birdieId) {
      return post("coinGetProfile", {
        birdieId: requireString(birdieId, "birdieId", 80)
      });
    },

    async linkInstagramHandle(birdieId, input) {
      const body = requireObject(input);

      return post("coinLinkInstagramHandle", {
        birdieId: requireString(birdieId, "birdieId", 80),
        instagramHandle: normalizeInstagramHandle(body.instagramHandle, { required: true }),
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      });
    },

    async getLedger(birdieId) {
      return post("coinGetLedger", {
        birdieId: requireString(birdieId, "birdieId", 80)
      });
    },

    async getSocialCoinEvent(eventId) {
      return post("coinGetSocialEvent", {
        eventId: requireString(eventId, "eventId", 120)
      });
    },

    async bindInstagramCommentIdentity(eventId, input) {
      const body = requireObject(input);
      rejectClientControlledAmount(body);

      return post("coinBindInstagramCommentIdentity", {
        eventId: requireString(eventId, "eventId", 120),
        workItemId: requireString(body.workItemId, "workItemId", 160),
        birdieId: requireString(body.birdieId, "birdieId", 80),
        confirmation: requireExactConfirmation(
          body,
          INSTAGRAM_COMMENT_CONFIRMATIONS.bindIdentity
        ),
        source: "Birdie Agent"
      });
    },

    async createInstagramCommentClaim(eventId, input) {
      const body = requireObject(input);
      rejectClientControlledAmount(body);

      return post("coinCreateInstagramCommentClaim", {
        eventId: requireString(eventId, "eventId", 120),
        workItemId: requireString(body.workItemId, "workItemId", 160),
        birdieId: requireString(body.birdieId, "birdieId", 80),
        confirmation: requireExactConfirmation(
          body,
          INSTAGRAM_COMMENT_CONFIRMATIONS.createClaim
        ),
        source: "Birdie Agent"
      });
    },

    async markInstagramCommentWritten(eventId, input) {
      const body = requireObject(input);
      rejectClientControlledAmount(body);

      return post("coinMarkInstagramCommentWritten", {
        eventId: requireString(eventId, "eventId", 120),
        workItemId: requireString(body.workItemId, "workItemId", 160),
        birdieId: requireString(body.birdieId, "birdieId", 80),
        claimId: requireString(body.claimId, "claimId", 80),
        confirmation: requireExactConfirmation(
          body,
          INSTAGRAM_COMMENT_CONFIRMATIONS.markWritten
        ),
        source: "Birdie Agent"
      });
    },

    async awardBadge(birdieId, input) {
      const body = requireObject(input);
      const badgeCode = requireBadgeCode(body.badgeCode);
      const definition = BADGE_DEFINITIONS[badgeCode];

      if (definition.founderApprovalRequired && body.founderApproved !== true) {
        throw new CoinValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          `${definition.name} requires explicit founder approval`,
          403
        );
      }

      return post("coinAwardBadge", compact({
        birdieId: requireString(birdieId, "birdieId", 80),
        badgeCode,
        founderApproved: body.founderApproved === true,
        note: optionalString(body.note, "note", 1000),
        actor: optionalString(body.actor, "actor", 100) || "Birdie Agent",
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async createClaim(input) {
      const body = requireObject(input);
      rejectClientControlledAmount(body);
      const actionCode = requireActionCode(body.actionCode);

      if (actionCode === "IG_COMMENT") {
        throw new CoinValidationError(
          "DEDICATED_IG_COMMENT_ACTION_REQUIRED",
          "IG_COMMENT claims must be created from the canonical social event route"
        );
      }

      return post("coinCreateClaim", compact({
        birdieId: requireString(body.birdieId, "birdieId", 80),
        actionCode,
        sourceType: requireString(body.sourceType, "sourceType", 40).toUpperCase(),
        sourceReference: requireString(
          body.sourceReference,
          "sourceReference",
          500
        ),
        evidenceUrl: optionalString(body.evidenceUrl, "evidenceUrl", 1000),
        note: optionalString(body.note, "note", 1000),
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async decideClaim(claimId, input) {
      const body = requireObject(input);
      const decision = requireClaimDecision(body.decision);
      const approvedAmount = optionalPositiveInteger(body.approvedAmount, "approvedAmount");

      if (decision === "REJECT" && approvedAmount !== undefined) {
        throw new CoinValidationError(
          "AMOUNT_NOT_ALLOWED",
          "approvedAmount is not allowed for a rejected claim"
        );
      }

      return post("coinDecideClaim", compact({
        claimId: requireString(claimId, "claimId", 80),
        decision,
        approvedAmount,
        eventId: optionalString(body.eventId, "eventId", 120),
        workItemId: optionalString(body.workItemId, "workItemId", 160),
        birdieId: optionalString(body.birdieId, "birdieId", 80),
        confirmation: optionalString(body.confirmation, "confirmation", 80),
        reason: optionalString(body.reason, "reason", 1000),
        actor: optionalString(body.actor, "actor", 100) || "Birdie Agent",
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async listRewards(accountType) {
      return post("coinListRewards", compact({
        accountType: optionalAccountType(accountType)
      }));
    },

    async getAdminQueue() {
      return post("coinAdminQueue", { source: "Birdie Agent" });
    },

    async createRedemption(input) {
      const body = requireObject(input);
      rejectClientControlledAmount(body);

      return post("coinCreateRedemption", {
        birdieId: requireString(body.birdieId, "birdieId", 80),
        rewardId: requireString(body.rewardId, "rewardId", 100),
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      });
    },

    async decideRedemption(redemptionId, input) {
      const body = requireObject(input);

      return post("coinDecideRedemption", compact({
        redemptionId: requireString(redemptionId, "redemptionId", 100),
        decision: requireRedemptionDecision(body.decision),
        reason: optionalString(body.reason, "reason", 1000),
        actor: optionalString(body.actor, "actor", 100) || "Birdie Agent",
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async importOpeningBalance(input) {
      const body = requireObject(input);

      if (body.founderApproved !== true) {
        throw new CoinValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          "Opening balances require explicit founder approval",
          403
        );
      }

      return post("coinImportOpeningBalance", {
        birdieId: requireString(body.birdieId, "birdieId", 80),
        amount: requirePositiveInteger(body.amount, "amount"),
        sourceReference: requireString(
          body.sourceReference,
          "sourceReference",
          500
        ),
        founderApproved: true,
        actor: optionalString(body.actor, "actor", 100) || "Kevin Stroop",
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      });
    },

    getActionDefinition(actionCode) {
      return ACTION_DEFINITIONS[actionCode] || null;
    }
  };
}
