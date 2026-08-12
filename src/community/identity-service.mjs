import { resolveInstagramIdentity } from "./identity-resolution.mjs";
import {
  ProviderEvidenceError,
  deriveProviderEvidence,
  signProviderEvidence,
  verifyProviderEvidence
} from "./provider-evidence.mjs";

export function createCommunityIdentityService({
  birdieOSGet,
  birdieOSPost,
  evidenceSigningKey
}) {
  if (typeof birdieOSGet !== "function") throw new Error("birdieOSGet is required");
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");
  if (!String(evidenceSigningKey ?? "")) throw new Error("evidenceSigningKey is required");

  async function getWorkItem(workItemId) {
    const id = String(workItemId ?? "").trim();
    if (!id) throw new ProviderEvidenceError("WORK_ITEM_ID_REQUIRED");

    const queueResponse = await birdieOSGet("communityWorkItem", { workItemId: id });
    const workItem = queueResponse?.data?.workItem || queueResponse?.data;
    if (!workItem) throw new ProviderEvidenceError("WORK_ITEM_NOT_FOUND", 404);
    if (String(workItem.sourceType ?? "").trim().toUpperCase() !== "INSTAGRAM") {
      throw new ProviderEvidenceError("WORK_ITEM_NOT_INSTAGRAM");
    }
    return { id, workItem };
  }

  async function getProfiles() {
    const profilesResponse = await birdieOSGet("birdieProfiles");
    const profiles = Array.isArray(profilesResponse?.data?.profiles)
      ? profilesResponse.data.profiles
      : Array.isArray(profilesResponse?.data)
        ? profilesResponse.data
        : null;
    if (!profiles) throw new ProviderEvidenceError("INVALID_PROFILE_EVIDENCE_SOURCE", 502);
    return profiles;
  }

  async function produceEvidenceByWorkItemId(workItemId, providerIdentity) {
    const { id } = await getWorkItem(workItemId);
    const profiles = await getProfiles();
    const evidence = deriveProviderEvidence({
      workItemId: id,
      providerIdentity,
      profiles
    });

    return {
      ...evidence,
      integrityToken: signProviderEvidence(evidence, evidenceSigningKey)
    };
  }

  async function resolveByWorkItemId(workItemId, signedEvidence) {
    const { id, workItem } = await getWorkItem(workItemId);
    const evidence = verifyProviderEvidence(signedEvidence, evidenceSigningKey);
    if (evidence.workItemId !== id) {
      throw new ProviderEvidenceError("PROVIDER_EVIDENCE_WORK_ITEM_MISMATCH");
    }

    const resolution = resolveInstagramIdentity(workItem, evidence);

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
      evidenceVersion: evidence.evidenceVersion,
      evidenceSource: evidence.source,
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

  return {
    produceEvidenceByWorkItemId,
    resolveByWorkItemId
  };
}
