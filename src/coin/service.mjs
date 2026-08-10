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
  if (body.amount !== undefined || body.points !== undefined) {
    throw new CoinValidationError(
      "CLIENT_AMOUNT_FORBIDDEN",
      "Coin amounts are determined by the authoritative action or reward rule"
    );
  }
}

function requireIdempotencyKey(body) {
  return requireString(body.idempotencyKey, "idempotencyKey", 160);
}

function normalizeInstagramHandle(value) {
  const handle = optionalString(value, "instagramHandle", 80);
  return handle ? handle.replace(/^@+/, "") : undefined;
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

    async getLedger(birdieId) {
      return post("coinGetLedger", {
        birdieId: requireString(birdieId, "birdieId", 80)
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

      return post("coinCreateClaim", compact({
        birdieId: requireString(body.birdieId, "birdieId", 80),
        actionCode: requireActionCode(body.actionCode),
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
