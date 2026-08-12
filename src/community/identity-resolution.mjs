export const IDENTITY_PROCESSOR = "ZAPIER_IDENTITY_RESOLVER";
export const IDENTITY_RESOLVER_VERSION = "v1";

const RESOLVABLE_STATUSES = new Set(["IDENTITY_PENDING", "PENDING_IDENTITY"]);

export function normalizeInstagramHandle(value) {
  let normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  return normalized;
}

function boundedConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function candidateBirdieId(candidate) {
  return String(candidate?.birdieId ?? candidate?.matchedBirdieId ?? "").trim();
}

function activeExactProfileEvidence(workItem, profiles) {
  const externalHandle = normalizeInstagramHandle(workItem?.externalUserId);
  const matches = (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    return (
      String(profile?.status ?? "").trim() === "ACTIVE" &&
      normalizeInstagramHandle(profile?.instagramHandle) === externalHandle &&
      externalHandle !== ""
    );
  });

  if (matches.length === 0) {
    return {
      candidates: [],
      candidateCount: 0,
      explicitLink: false,
      conflictingEvidence: false,
      confidence: 0,
      reason: "No explicit Instagram identity link matches an ACTIVE Birdie Profile."
    };
  }

  if (matches.length === 1) {
    return {
      candidates: matches,
      candidateCount: 1,
      explicitLink: true,
      conflictingEvidence: false,
      confidence: 100,
      reason: "Exactly one ACTIVE Birdie Profile has this explicit Instagram handle link."
    };
  }

  return {
    candidates: matches,
    candidateCount: matches.length,
    explicitLink: true,
    conflictingEvidence: true,
    confidence: 100,
    reason: "Multiple ACTIVE Birdie Profiles share the same explicit Instagram handle link."
  };
}

function normalizeEvidence(workItem, evidenceOrProfiles) {
  if (Array.isArray(evidenceOrProfiles)) {
    return activeExactProfileEvidence(workItem, evidenceOrProfiles);
  }

  const input = evidenceOrProfiles && typeof evidenceOrProfiles === "object"
    ? evidenceOrProfiles
    : {};
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const candidateCountRaw = Number(input.candidateCount);
  const candidateCount = Number.isInteger(candidateCountRaw) && candidateCountRaw >= 0
    ? candidateCountRaw
    : candidates.length;
  const explicitLink = input.explicitLink === true;
  const conflictingEvidence = input.conflictingEvidence === true;
  const confidence = explicitLink && candidateCount === 1 && !conflictingEvidence
    ? 100
    : boundedConfidence(input.confidence);
  const reason = String(input.reason ?? "").trim();

  return {
    candidates,
    candidateCount,
    explicitLink,
    conflictingEvidence,
    confidence,
    reason
  };
}

function standardReason(evidence, kind) {
  if (evidence.reason) return evidence.reason;

  switch (kind) {
    case "EXACT":
      return "Exactly one explicit external identity link matches this Birdie Profile.";
    case "HIGH":
      return `Exactly one candidate scored ${evidence.confidence} with no conflicting identity evidence.`;
    case "CONFLICT":
      return evidence.candidateCount > 1
        ? `Multiple plausible Birdie Profile candidates remain (${evidence.candidateCount}).`
        : "Contradictory identity evidence requires Founder review.";
    case "NO_MATCH":
      return "No usable Birdie Profile candidate or identity evidence is available.";
    default:
      return `Identity confidence ${evidence.confidence} is below the automatic resolution threshold of 90.`;
  }
}

function resolutionWrite({
  resolutionStatus,
  matchedBirdieId = "",
  decision,
  agentNotes,
  processedAt,
  identityConfidence,
  identityReason,
  identityConflict,
  identityDecisionMode
}) {
  return {
    resolutionStatus,
    matchedBirdieId,
    decision,
    agentNotes,
    processedBy: IDENTITY_PROCESSOR,
    processedAt,
    identityConfidence,
    identityReason,
    identityConflict,
    identityDecisionMode
  };
}

export function resolveInstagramIdentity(
  workItem,
  evidenceOrProfiles,
  processedAt = new Date().toISOString()
) {
  const matchedBirdieId = String(workItem?.matchedBirdieId ?? "").trim();
  const resolutionStatus = String(workItem?.resolutionStatus ?? "").trim();
  const workItemId = String(workItem?.workItemId ?? "").trim();

  const eligible =
    String(workItem?.sourceType ?? "").trim() === "INSTAGRAM" &&
    RESOLVABLE_STATUSES.has(resolutionStatus) &&
    matchedBirdieId === "" &&
    normalizeInstagramHandle(workItem?.externalUserId) !== "";

  if (!eligible) {
    return {
      processed: false,
      reason: "WORK_ITEM_NOT_ELIGIBLE"
    };
  }

  const evidence = normalizeEvidence(workItem, evidenceOrProfiles);
  const candidates = evidence.candidates;
  const firstCandidateBirdieId = candidateBirdieId(candidates[0]);
  const idempotencyKey = `IDENTITY|${workItemId || "UNKNOWN"}|${IDENTITY_RESOLVER_VERSION}`;

  if (
    evidence.explicitLink &&
    evidence.candidateCount === 1 &&
    !evidence.conflictingEvidence &&
    firstCandidateBirdieId
  ) {
    const identityReason = standardReason(evidence, "EXACT");
    return {
      processed: true,
      resolverVersion: IDENTITY_RESOLVER_VERSION,
      idempotencyKey,
      write: resolutionWrite({
        resolutionStatus: "IDENTITY_RESOLVED",
        matchedBirdieId: firstCandidateBirdieId,
        decision: "EXACT_IDENTITY_LINK",
        agentNotes: "Instagram identity resolved automatically from an exact explicit identity link.",
        processedAt,
        identityConfidence: 100,
        identityReason,
        identityConflict: false,
        identityDecisionMode: "AUTO_EXACT_LINK"
      })
    };
  }

  if (evidence.candidateCount > 1 || evidence.conflictingEvidence) {
    const identityReason = standardReason(evidence, "CONFLICT");
    return {
      processed: true,
      resolverVersion: IDENTITY_RESOLVER_VERSION,
      idempotencyKey,
      write: resolutionWrite({
        resolutionStatus: "IDENTITY_PENDING",
        decision: "FOUNDER_REVIEW_REQUIRED",
        agentNotes: "Identity evidence is ambiguous or conflicting. Founder review required.",
        processedAt,
        identityConfidence: evidence.confidence,
        identityReason,
        identityConflict: true,
        identityDecisionMode: "FOUNDER_REVIEW_CONFLICT"
      })
    };
  }

  if (
    evidence.candidateCount === 1 &&
    evidence.confidence >= 90 &&
    firstCandidateBirdieId
  ) {
    const identityReason = standardReason(evidence, "HIGH");
    return {
      processed: true,
      resolverVersion: IDENTITY_RESOLVER_VERSION,
      idempotencyKey,
      write: resolutionWrite({
        resolutionStatus: "IDENTITY_RESOLVED",
        matchedBirdieId: firstCandidateBirdieId,
        decision: "HIGH_CONFIDENCE_MATCH",
        agentNotes: "Instagram identity resolved automatically from one unique high-confidence candidate.",
        processedAt,
        identityConfidence: evidence.confidence,
        identityReason,
        identityConflict: false,
        identityDecisionMode: "AUTO_HIGH_CONFIDENCE"
      })
    };
  }

  if (evidence.candidateCount === 0) {
    const identityReason = standardReason(evidence, "NO_MATCH");
    return {
      processed: true,
      resolverVersion: IDENTITY_RESOLVER_VERSION,
      idempotencyKey,
      write: resolutionWrite({
        resolutionStatus: "IDENTITY_PENDING",
        decision: "NO_PROFILE_MATCH",
        agentNotes: "Instagram identity not yet linked to a Birdie Profile.",
        processedAt,
        identityConfidence: 0,
        identityReason,
        identityConflict: false,
        identityDecisionMode: "FOUNDER_REVIEW_LOW_CONFIDENCE"
      })
    };
  }

  const identityReason = standardReason(evidence, "LOW");
  return {
    processed: true,
    resolverVersion: IDENTITY_RESOLVER_VERSION,
    idempotencyKey,
    write: resolutionWrite({
      resolutionStatus: "IDENTITY_PENDING",
      decision: "FOUNDER_REVIEW_REQUIRED",
      agentNotes: "Identity confidence is below the automatic resolution threshold. Founder review required.",
      processedAt,
      identityConfidence: evidence.confidence,
      identityReason,
      identityConflict: false,
      identityDecisionMode: "FOUNDER_REVIEW_LOW_CONFIDENCE"
    })
  };
}
