import { resolveInstagramIdentity } from "./identity-resolution.mjs";

export function createCommunityIdentityService({ birdieOSGet, birdieOSPost }) {
  if (typeof birdieOSGet !== "function") throw new Error("birdieOSGet is required");
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");

  async function resolveByWorkItemId(workItemId) {
    const id = String(workItemId ?? "").trim();
    if (!id) throw new Error("workItemId is required");

    const queueResponse = await birdieOSGet(
      `communityWorkItem&workItemId=${encodeURIComponent(id)}`
    );

    const workItem = queueResponse?.data?.workItem || queueResponse?.data;
    if (!workItem) throw new Error("WORK_ITEM_NOT_FOUND");

    const profilesResponse = await birdieOSGet("birdieProfiles");
    const profiles = Array.isArray(profilesResponse?.data?.profiles)
      ? profilesResponse.data.profiles
      : Array.isArray(profilesResponse?.data)
        ? profilesResponse.data
        : [];

    const resolution = resolveInstagramIdentity(workItem, profiles);

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
      source: "Birdie Agent"
    });

    return {
      workItemId: id,
      processed: true,
      resolution: resolution.write,
      birdieOS: result?.data ?? null
    };
  }

  return { resolveByWorkItemId };
}
