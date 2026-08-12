import { FAMILY_ACCESS_POLICY, sanitizeFamilyData } from "./family-policy.mjs";

const RESOURCE_TO_ACTION = Object.freeze({
  health: "health",
  briefing: "briefing",
  nextTask: "nextTask"
});

function requiredResource(resource) {
  const value = String(resource ?? "").trim();
  if (!Object.hasOwn(RESOURCE_TO_ACTION, value)) {
    const error = new Error("Family resource is not allowlisted");
    error.code = "FAMILY_RESOURCE_DENIED";
    error.status = 403;
    throw error;
  }
  return value;
}

export function createFamilyReadService({ birdieOSGet }) {
  if (typeof birdieOSGet !== "function") throw new Error("birdieOSGet is required");

  async function read(resource) {
    const safeResource = requiredResource(resource);
    const action = RESOURCE_TO_ACTION[safeResource];
    const result = await birdieOSGet(action);
    return {
      role: FAMILY_ACCESS_POLICY.role,
      readOnly: true,
      source: "BIRDIE_OS",
      resource: safeResource,
      data: sanitizeFamilyData(result?.data ?? result)
    };
  }

  return {
    read,
    policy: () => FAMILY_ACCESS_POLICY,
    health: () => read("health"),
    briefing: () => read("briefing"),
    nextTask: () => read("nextTask")
  };
}
