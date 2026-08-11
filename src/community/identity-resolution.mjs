export const IDENTITY_PROCESSOR = "ZAPIER_IDENTITY_RESOLVER";

export function normalizeInstagramHandle(value) {
  let normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  return normalized;
}

export function resolveInstagramIdentity(workItem, profiles, processedAt = new Date().toISOString()) {
  const matchedBirdieId = String(workItem?.matchedBirdieId ?? "").trim();

  const eligible =
    String(workItem?.sourceType ?? "").trim() === "INSTAGRAM" &&
    String(workItem?.resolutionStatus ?? "").trim() === "PENDING_IDENTITY" &&
    matchedBirdieId === "";

  if (!eligible) {
    return {
      processed: false,
      reason: "WORK_ITEM_NOT_ELIGIBLE"
    };
  }

  const externalHandle = normalizeInstagramHandle(workItem.externalUserId);

  const matches = (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    return (
      String(profile?.status ?? "").trim() === "ACTIVE" &&
      normalizeInstagramHandle(profile?.instagramHandle) === externalHandle
    );
  });

  if (matches.length === 0) {
    return {
      processed: true,
      write: {
        resolutionStatus: "IDENTITY_PENDING",
        matchedBirdieId: "",
        decision: "NO_PROFILE_MATCH",
        agentNotes: "Instagram identity not yet linked to a Birdie Profile.",
        processedBy: IDENTITY_PROCESSOR,
        processedAt
      }
    };
  }

  if (matches.length === 1) {
    return {
      processed: true,
      write: {
        resolutionStatus: "IDENTITY_RESOLVED",
        matchedBirdieId: String(matches[0].birdieId ?? "").trim(),
        decision: "MATCHED_EXISTING_PROFILE",
        agentNotes: "Instagram identity resolved automatically by exact handle match.",
        processedBy: IDENTITY_PROCESSOR,
        processedAt
      }
    };
  }

  return {
    processed: true,
    write: {
      resolutionStatus: "IDENTITY_CONFLICT",
      matchedBirdieId: "",
      decision: "MULTIPLE_PROFILE_MATCHES",
      agentNotes: "Multiple Birdie Profiles match this Instagram handle. Manual resolution required.",
      processedBy: IDENTITY_PROCESSOR,
      processedAt
    }
  };
}
