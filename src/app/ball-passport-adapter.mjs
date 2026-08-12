const CONTRACT_VERSION = "birdie-app-v1";

function clone(value) {
  return structuredClone(value);
}

function safeString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function privacySafeEvent(event) {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: String(event.eventId),
    objectId: String(event.objectId),
    eventType: String(event.eventType),
    occurredAt: String(event.occurredAt),
    roundId: safeString(event.roundId),
    holeNumber: Number.isInteger(event.holeNumber) ? event.holeNumber : null,
    privacyClass: ["PRIVATE", "COARSE", "PUBLIC"].includes(event.privacyClass)
      ? event.privacyClass
      : "PRIVATE",
    courseName: event.privacyClass === "PRIVATE" ? null : safeString(event.courseName),
    locationLabel: event.privacyClass === "PUBLIC" ? safeString(event.locationLabel) : null,
    ruleVersion: safeString(event.ruleVersion) || "birdie-dna-v1"
  };
}

export function createBallPassportProjectionAdapter({ objects = [], ownership = [], events = [] } = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    mode: "SANDBOX",

    getOwnedBallPassports(birdieId) {
      const ownedObjectIds = new Set(
        ownership
          .filter((row) => row.ownerBirdieId === birdieId && row.status === "ACTIVE")
          .map((row) => row.objectId)
      );

      return clone({
        contractVersion: CONTRACT_VERSION,
        birdieId,
        source: "BIRDIE_DNA_SANDBOX_PROJECTION",
        passports: objects
          .filter((object) => object.objectType === "BALL" && ownedObjectIds.has(object.objectId))
          .map((object) => buildPassport(object, birdieId, events))
      });
    },

    getBallPassport(objectId, birdieId) {
      const ownsObject = ownership.some(
        (row) => row.objectId === objectId && row.ownerBirdieId === birdieId && row.status === "ACTIVE"
      );
      if (!ownsObject) return null;

      const object = objects.find((item) => item.objectId === objectId && item.objectType === "BALL");
      if (!object) return null;
      return clone(buildPassport(object, birdieId, events));
    }
  };
}

function buildPassport(object, ownerBirdieId, events) {
  const journey = events
    .filter((event) => event.objectId === object.objectId)
    .map(privacySafeEvent)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const roundIds = new Set(journey.map((event) => event.roundId).filter(Boolean));
  const courseNames = new Set(journey.map((event) => event.courseName).filter(Boolean));
  const birdiesWitnessed = journey.filter((event) => event.eventType === "FIRST_BIRDIE").length;

  return {
    contractVersion: CONTRACT_VERSION,
    objectId: object.objectId,
    ownerBirdieId,
    displayName: safeString(object.displayName) || "Living Ball",
    editionId: safeString(object.editionCode),
    rarity: safeString(object.rarity),
    state: safeString(object.state) || "RESTING",
    privacySafeStats: {
      rounds: roundIds.size,
      holesSurvived: Number.isInteger(object.holesSurvived) ? object.holesSurvived : 0,
      courses: courseNames.size,
      birdiesWitnessed
    },
    journey
  };
}

export { CONTRACT_VERSION as BIRDIE_APP_CONTRACT_VERSION };
