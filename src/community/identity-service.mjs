import { resolveInstagramIdentity } from "./identity-resolution.mjs";

export function createCommunityIdentityService({ birdieOSGet, birdieOSPost }) {
  if (typeof birdieOSGet !== "function") throw new Error("birdieOSGet is required");
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");

  async function resolveByWorkItemId(workItemId, evidence = null) {
    const id = String(workItemId ?? "").trim();
    if (!id) throw new Error("workItemId is required");

    const queueResponse = await birdieOSGet(
      "communityWorkItem",
      { workItemId: id }
    );

    const workItem = queueResponse?.data?.workItem || queueResponse?.data;
    if (!workItem) throw new Error("WORK_ITEM_NOT_FOUND");

    let resolverInput = evidence;
    if (!resolverInput || typeof resolverInput !== "object" || Array.isArray(resolverInput)) {
      const profilesResponse = await birdieOSGet("birdieProfiles");
      resolverInput = Array.isArray(profilesResponse?.data?.profiles)
        ? profilesResponse.data.profiles
        : Array.isArray(profilesResponse?.data)
          ? profilesResponse.data
          : [];
    }

    const resolution = resolveInstagramIdentity(workItem, resolverInput);

    if (!resolution.processed) {
      return {
        workItemId: id,
        ...resolution
      };
    }

    const result = await birdieOSPost({
      action: "updateCommunityIdentityResolution",
      workItemId: id,
      write: resolution.write,
      resolverVersion: resolution.resolverVersion,
      idempotencyKey: resolution.idempotencyKey,
      source: "Birdie Agent"
    });

    return {
      workItemId: id,
      processed: true,
      resolverVersion: resolution.resolverVersion,
      idempotencyKey: resolution.idempotencyKey,
      resolution: resolution.write,
      birdieOS: result?.data ?? null
    };
  }

  return { resolveByWorkItemId };
}
