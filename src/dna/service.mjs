import {
  DnaValidationError,
  compact,
  optionalObject,
  optionalString,
  requireEnum,
  requireObject,
  requireString
} from "./validation.mjs";

const OBJECT_TYPES = ["BALL", "COIN", "MARKER", "CARD", "OTHER"];
const PHYSICAL_IDENTITY_TYPES = ["QR", "NFC", "QR_NFC", "NONE"];
const EVENT_TYPES = [
  "ACTIVATED",
  "COURSE_VISIT",
  "FIRST_BIRDIE",
  "INSTAGRAM_TAG_VERIFIED",
  "COMMUNITY_EVENT"
];
const VERIFICATION_MODES = ["OWNER_SUBMITTED", "SYSTEM_VERIFIED", "FOUNDER_VERIFIED"];
const EVENT_DECISIONS = ["APPROVE", "REJECT"];
const TRANSFER_MODES = ["DIRECT", "RELEASE_TO_FLOCK"];

const EVOLUTION_TIERS = [
  { code: "COMMON_RARE", threshold: 0 },
  { code: "FLOCK_RARE", threshold: 30 },
  { code: "NIGHT_OWL_RARE", threshold: 75 },
  { code: "STAY_RARE", threshold: 150 },
  { code: "LEGACY_RARE", threshold: 300 }
];

const EVENT_RULES = {
  ACTIVATED: { points: 5, maxPerObject: 1 },
  COURSE_VISIT: { points: 10, distinctBy: "courseName" },
  FIRST_BIRDIE: { points: 20, maxPerObject: 1 },
  INSTAGRAM_TAG_VERIFIED: { points: 10, distinctBy: "sourceReference" },
  COMMUNITY_EVENT: { points: 25, distinctBy: "sourceReference" },
  OWNERSHIP_TRANSFER: { points: 15, maxPerObject: 10, systemOnly: true },
  RELEASED_TO_FLOCK: { points: 20, maxPerObject: 5, systemOnly: true }
};

function requireIdempotencyKey(body) {
  return requireString(body.idempotencyKey, "idempotencyKey", 180);
}

function rejectClientControlledEvolution(body) {
  const forbidden = ["evolutionTier", "evolutionScore", "evolutionPoints", "points"];
  for (const field of forbidden) {
    if (body[field] !== undefined) {
      throw new DnaValidationError(
        "CLIENT_EVOLUTION_FORBIDDEN",
        `${field} is derived from the authoritative Birdie DNA event ledger`
      );
    }
  }
}

export function createDnaService({ birdieOSPost }) {
  if (typeof birdieOSPost !== "function") {
    throw new Error("birdieOSPost dependency is required");
  }

  async function post(action, payload = {}) {
    const result = await birdieOSPost({ action, ...payload });
    return result.data;
  }

  return {
    getConfig() {
      return {
        objectTypes: OBJECT_TYPES,
        physicalIdentityTypes: PHYSICAL_IDENTITY_TYPES,
        eventRules: EVENT_RULES,
        evolutionTiers: EVOLUTION_TIERS,
        transferModes: TRANSFER_MODES,
        principles: {
          eventLedgerAuthoritative: true,
          clientControlledEvolution: false,
          directCoinWrites: false,
          productionObjectIssuanceRequiresFounderApproval: true
        }
      };
    },

    async createObject(input) {
      const body = requireObject(input);
      rejectClientControlledEvolution(body);
      if (body.founderApproved !== true) {
        throw new DnaValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          "Physical Birdie DNA object issuance requires explicit founder approval",
          403
        );
      }

      return post("dnaCreateObject", compact({
        objectType: requireEnum(body.objectType, "objectType", OBJECT_TYPES),
        editionCode: optionalString(body.editionCode, "editionCode", 100),
        serialNumber: requireString(body.serialNumber, "serialNumber", 120),
        displayName: requireString(body.displayName, "displayName", 160),
        ownerBirdieId: optionalString(body.ownerBirdieId, "ownerBirdieId", 80),
        physicalIdentityType: requireEnum(
          body.physicalIdentityType || "NONE",
          "physicalIdentityType",
          PHYSICAL_IDENTITY_TYPES
        ),
        physicalIdentityRef: optionalString(
          body.physicalIdentityRef,
          "physicalIdentityRef",
          300
        ),
        publicPassport: body.publicPassport !== false,
        founderApproved: true,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async getObject(objectId) {
      return post("dnaGetObject", {
        objectId: requireString(objectId, "objectId", 100)
      });
    },

    async getPassport(objectId) {
      return post("dnaGetPassport", {
        objectId: requireString(objectId, "objectId", 100)
      });
    },

    async createEvent(objectId, input) {
      const body = requireObject(input);
      rejectClientControlledEvolution(body);
      const eventType = requireEnum(body.eventType, "eventType", EVENT_TYPES);
      const verificationMode = requireEnum(
        body.verificationMode || "OWNER_SUBMITTED",
        "verificationMode",
        VERIFICATION_MODES
      );

      if (verificationMode === "FOUNDER_VERIFIED" && body.founderApproved !== true) {
        throw new DnaValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          "Founder-verified Birdie DNA events require explicit founder approval",
          403
        );
      }

      return post("dnaCreateEvent", compact({
        objectId: requireString(objectId, "objectId", 100),
        eventType,
        birdieId: requireString(body.birdieId, "birdieId", 80),
        sourceType: requireString(body.sourceType, "sourceType", 50).toUpperCase(),
        sourceReference: requireString(body.sourceReference, "sourceReference", 500),
        courseName: optionalString(body.courseName, "courseName", 200),
        locationLabel: optionalString(body.locationLabel, "locationLabel", 200),
        eventAt: optionalString(body.eventAt, "eventAt", 80),
        evidenceUrl: optionalString(body.evidenceUrl, "evidenceUrl", 1000),
        metadata: optionalObject(body.metadata, "metadata"),
        verificationMode,
        founderApproved: verificationMode === "FOUNDER_VERIFIED" ? true : undefined,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async decideEvent(eventId, input) {
      const body = requireObject(input);
      if (body.founderApproved !== true) {
        throw new DnaValidationError(
          "FOUNDER_APPROVAL_REQUIRED",
          "Birdie DNA event decisions require explicit founder approval",
          403
        );
      }

      return post("dnaDecideEvent", compact({
        eventId: requireString(eventId, "eventId", 100),
        decision: requireEnum(body.decision, "decision", EVENT_DECISIONS),
        reason: optionalString(body.reason, "reason", 1000),
        actor: optionalString(body.actor, "actor", 100) || "Kevin Stroop",
        founderApproved: true,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async initiateTransfer(objectId, input) {
      const body = requireObject(input);
      const transferMode = requireEnum(body.transferMode, "transferMode", TRANSFER_MODES);
      const toBirdieId = optionalString(body.toBirdieId, "toBirdieId", 80);
      if (transferMode === "DIRECT" && !toBirdieId) {
        throw new DnaValidationError(
          "RECIPIENT_REQUIRED",
          "Direct ownership transfers require toBirdieId"
        );
      }
      if (transferMode === "RELEASE_TO_FLOCK" && toBirdieId) {
        throw new DnaValidationError(
          "RECIPIENT_NOT_ALLOWED",
          "Release Into the Flock must not preselect a recipient"
        );
      }

      return post("dnaInitiateTransfer", compact({
        objectId: requireString(objectId, "objectId", 100),
        fromBirdieId: requireString(body.fromBirdieId, "fromBirdieId", 80),
        toBirdieId,
        transferMode,
        sourceReference: optionalString(body.sourceReference, "sourceReference", 500),
        actor: optionalString(body.actor, "actor", 100) || body.fromBirdieId,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    },

    async acceptTransfer(ownershipId, input) {
      const body = requireObject(input);
      return post("dnaAcceptTransfer", compact({
        ownershipId: requireString(ownershipId, "ownershipId", 100),
        toBirdieId: requireString(body.toBirdieId, "toBirdieId", 80),
        actor: optionalString(body.actor, "actor", 100) || body.toBirdieId,
        sourceReference: optionalString(body.sourceReference, "sourceReference", 500),
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      }));
    }
  };
}
