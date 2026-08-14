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
    const profiles = await getProfiles();
    const exactResolution = resolveInstagramIdentity(workItem, profiles);

    if (!exactResolution.processed) {
      return {
        workItemId: id,
        ...exactResolution
      };
    }

    const exactMode = exactResolution.write?.identityDecisionMode;
    const canonicalExactResult =
      exactMode === "AUTO_EXACT_LINK" ||
      exactMode === "FOUNDER_REVIEW_CONFLICT";
    let resolution = exactResolution;
    let evidenceMetadata = {};

    if (canonicalExactResult) {
      if (signedEvidence !== undefined && signedEvidence !== null) {
        const suppliedEvidence = verifyProviderEvidence(
          signedEvidence,
          evidenceSigningKey
        );
        if (suppliedEvidence.workItemId !== id) {
          throw new ProviderEvidenceError("PROVIDER_EVIDENCE_WORK_ITEM_MISMATCH");
        }

        evidenceMetadata = {
          evidenceVersion: suppliedEvidence.evidenceVersion,
          evidenceSource: suppliedEvidence.source
        };

        const exactBirdieId = String(
          exactResolution.write?.matchedBirdieId ?? ""
        ).trim();
        const evidenceCandidates = Array.isArray(suppliedEvidence.candidates)
          ? suppliedEvidence.candidates
          : [];
        const evidenceBirdieIds = evidenceCandidates
          .map((candidate) => String(candidate?.birdieId ?? "").trim())
          .filter(Boolean);
        const evidenceContradictsExact =
          exactMode === "AUTO_EXACT_LINK" &&
          (suppliedEvidence.conflictingEvidence === true ||
            Number(suppliedEvidence.candidateCount) > 1 ||
            evidenceBirdieIds.some((candidateId) => candidateId !== exactBirdieId));

        if (evidenceContradictsExact) {
          const candidatesById = new Map();
          candidatesById.set(exactBirdieId, { birdieId: exactBirdieId });
          for (const candidate of evidenceCandidates) {
            const candidateId = String(candidate?.birdieId ?? "").trim();
            if (candidateId) candidatesById.set(candidateId, candidate);
          }
          const candidates = [...candidatesById.values()];
          resolution = resolveInstagramIdentity(workItem, {
            candidates,
            candidateCount: candidates.length,
            explicitLink: true,
            conflictingEvidence: true,
            confidence: 100,
            reason: "Canonical exact profile link conflicts with signed provider evidence."
          });
        }
      }
    } else {
      const evidence = verifyProviderEvidence(signedEvidence, evidenceSigningKey);
      if (evidence.workItemId !== id) {
        throw new ProviderEvidenceError("PROVIDER_EVIDENCE_WORK_ITEM_MISMATCH");
      }

      resolution = resolveInstagramIdentity(workItem, evidence);
      evidenceMetadata = {
        evidenceVersion: evidence.evidenceVersion,
        evidenceSource: evidence.source
      };
    }

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
      ...evidenceMetadata,
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
