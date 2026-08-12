import { createHash, randomBytes } from "node:crypto";
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

function newClaimToken() {
  return randomBytes(32).toString("base64url");
}

function hashClaimToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

function redactClaimTokenHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...value };
  delete copy.claimTokenHash;
  if (copy.transfer && typeof copy.transfer === "object") {
    copy.transfer = { ...copy.transfer };
    delete copy.transfer.claimTokenHash;
  }
  return copy;
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
    async getConfig() {
      return post("dnaGetConfig", { source: "Birdie Agent" });
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
        publicPassport: body.publicPassport === true,
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
      if (verificationMode === "SYSTEM_VERIFIED" && body.systemVerified !== true) {
        throw new DnaValidationError(
          "SYSTEM_VERIFICATION_REQUIRED",
          "System-verified Birdie DNA events require an explicit trusted-system assertion",
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
        systemVerified: verificationMode === "SYSTEM_VERIFIED" ? true : undefined,
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
      const fromBirdieId = requireString(body.fromBirdieId, "fromBirdieId", 80);
      const idempotencyKey = requireIdempotencyKey(body);
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

      if (transferMode === "DIRECT") {
        return redactClaimTokenHash(await post("dnaInitiateTransfer", compact({
          objectId: requireString(objectId, "objectId", 100),
          fromBirdieId,
          toBirdieId,
          transferMode,
          sourceReference: optionalString(body.sourceReference, "sourceReference", 500),
          actor: optionalString(body.actor, "actor", 100) || fromBirdieId,
          idempotencyKey,
          source: "Birdie Agent"
        })));
      }

      const claimToken = newClaimToken();
      const claimTokenHash = hashClaimToken(claimToken);
      let result = await post("dnaInitiateTransfer", compact({
        objectId: requireString(objectId, "objectId", 100),
        fromBirdieId,
        transferMode,
        sourceReference: optionalString(body.sourceReference, "sourceReference", 500),
        actor: optionalString(body.actor, "actor", 100) || fromBirdieId,
        claimTokenHash,
        idempotencyKey,
        source: "Birdie Agent"
      }));

      if (result.claimTokenHash && result.claimTokenHash !== claimTokenHash) {
        result = await post("dnaRotateReleaseClaimToken", {
          ownershipId: requireString(result.ownershipId, "ownershipId", 100),
          fromBirdieId,
          claimTokenHash,
          actor: optionalString(body.actor, "actor", 100) || fromBirdieId,
          idempotencyKey: `${idempotencyKey}:claim-token:${claimTokenHash.slice(0, 16)}`,
          source: "Birdie Agent"
        });
      }

      return {
        ...redactClaimTokenHash(result),
        claimToken,
        claimTokenOneTime: true
      };
    },

    async rotateReleaseClaimToken(ownershipId, input) {
      const body = requireObject(input);
      const claimToken = newClaimToken();
      const claimTokenHash = hashClaimToken(claimToken);
      const result = await post("dnaRotateReleaseClaimToken", {
        ownershipId: requireString(ownershipId, "ownershipId", 100),
        fromBirdieId: requireString(body.fromBirdieId, "fromBirdieId", 80),
        claimTokenHash,
        actor: optionalString(body.actor, "actor", 100) || body.fromBirdieId,
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      });
      return {
        ...redactClaimTokenHash(result),
        claimToken,
        claimTokenOneTime: true
      };
    },

    async acceptTransfer(ownershipId, input) {
      const body = requireObject(input);
      const claimToken = optionalString(body.claimToken, "claimToken", 200);
      return redactClaimTokenHash(await post("dnaAcceptTransfer", compact({
        ownershipId: requireString(ownershipId, "ownershipId", 100),
        toBirdieId: requireString(body.toBirdieId, "toBirdieId", 80),
        claimTokenHash: claimToken ? hashClaimToken(claimToken) : undefined,
        actor: optionalString(body.actor, "actor", 100) || body.toBirdieId,
        sourceReference: optionalString(body.sourceReference, "sourceReference", 500),
        idempotencyKey: requireIdempotencyKey(body),
        source: "Birdie Agent"
      })));
    }
  };
}
