import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeInstagramHandle } from "./identity-resolution.mjs";

export const PROVIDER_EVIDENCE_SOURCE = "PROVIDER_EVIDENCE_V1";
export const PROVIDER_EVIDENCE_VERSION = "v1";

const INPUT_FIELDS = new Set([
  "provider",
  "providerUserId",
  "username",
  "verifiedEmail",
  "emailVerified",
  "sourceEventId",
  "observedAt"
]);

const DERIVED_FIELDS = new Set([
  "candidates",
  "candidateCount",
  "explicitLink",
  "conflictingEvidence",
  "confidence",
  "reason",
  "matchedBirdieId"
]);

const SIGNAL_SCORE = {
  STABLE_PROVIDER_ID: 100,
  INSTAGRAM_HANDLE: 60
};

export class ProviderEvidenceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ProviderEvidenceError";
    this.code = code;
    this.status = status;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderEvidenceError(`INVALID_PROVIDER_EVIDENCE_INPUT:${field}`);
  }
  return value.trim();
}

function normalizeProviderIdentity(value) {
  if (!plainObject(value)) {
    throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_INPUT:providerIdentity");
  }

  for (const key of Object.keys(value)) {
    if (DERIVED_FIELDS.has(key)) {
      throw new ProviderEvidenceError(`DERIVED_PROVIDER_EVIDENCE_NOT_ALLOWED:${key}`);
    }
    if (!INPUT_FIELDS.has(key)) {
      throw new ProviderEvidenceError(`INVALID_PROVIDER_EVIDENCE_INPUT:${key}`);
    }
  }

  if (String(value.provider ?? "").trim().toUpperCase() !== "INSTAGRAM") {
    throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_INPUT:provider");
  }

  if (value.emailVerified !== undefined && typeof value.emailVerified !== "boolean") {
    throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_INPUT:emailVerified");
  }

  const observedAt = optionalText(value.observedAt, "observedAt");
  if (observedAt && Number.isNaN(Date.parse(observedAt))) {
    throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_INPUT:observedAt");
  }

  return {
    provider: "INSTAGRAM",
    providerUserId: optionalText(value.providerUserId, "providerUserId"),
    username: optionalText(value.username, "username"),
    verifiedEmail: optionalText(value.verifiedEmail, "verifiedEmail"),
    emailVerified: value.emailVerified === true,
    sourceEventId: optionalText(value.sourceEventId, "sourceEventId"),
    observedAt
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signingKey(value) {
  const key = String(value ?? "");
  if (!key) throw new ProviderEvidenceError("PROVIDER_EVIDENCE_SIGNING_KEY_MISSING", 500);
  return key;
}

export function signProviderEvidence(evidence, secret) {
  const unsigned = { ...evidence };
  delete unsigned.integrityToken;
  return createHmac("sha256", signingKey(secret))
    .update(stableStringify(unsigned))
    .digest("base64url");
}

export function verifyProviderEvidence(evidence, secret) {
  if (!plainObject(evidence) || typeof evidence.integrityToken !== "string") {
    throw new ProviderEvidenceError("SIGNED_PROVIDER_EVIDENCE_REQUIRED", 400);
  }
  if (evidence.source !== PROVIDER_EVIDENCE_SOURCE || evidence.evidenceVersion !== PROVIDER_EVIDENCE_VERSION) {
    throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_VERSION", 400);
  }
  const expected = signProviderEvidence(evidence, secret);
  const actual = evidence.integrityToken;
  const valid = actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  if (!valid) throw new ProviderEvidenceError("INVALID_PROVIDER_EVIDENCE_SIGNATURE", 400);
  const verified = { ...evidence };
  delete verified.integrityToken;
  return verified;
}

export function deriveProviderEvidence({ workItemId, providerIdentity, profiles }) {
  const id = String(workItemId ?? "").trim();
  if (!id) throw new ProviderEvidenceError("WORK_ITEM_ID_REQUIRED");
  if (!Array.isArray(profiles)) throw new ProviderEvidenceError("INVALID_PROFILE_EVIDENCE_SOURCE", 502);

  const identity = normalizeProviderIdentity(providerIdentity);
  const providerUserId = String(identity.providerUserId ?? "");
  const username = normalizeInstagramHandle(identity.username);
  const candidatesById = new Map();

  for (const profile of profiles) {
    if (String(profile?.status ?? "").trim().toUpperCase() !== "ACTIVE") continue;
    const birdieId = String(profile?.birdieId ?? "").trim();
    if (!birdieId) continue;

    const matchedSignals = [];
    if (providerUserId && String(profile?.instagramUserId ?? "").trim() === providerUserId) {
      matchedSignals.push("STABLE_PROVIDER_ID");
    }
    if (username && normalizeInstagramHandle(profile?.instagramHandle) === username) {
      matchedSignals.push("INSTAGRAM_HANDLE");
    }
    if (!matchedSignals.length) continue;

    const score = Math.max(...matchedSignals.map((signal) => SIGNAL_SCORE[signal]));
    const existing = candidatesById.get(birdieId);
    if (existing) {
      const merged = [...new Set([...existing.matchedSignals, ...matchedSignals])];
      existing.matchedSignals = merged.sort((a, b) => SIGNAL_SCORE[b] - SIGNAL_SCORE[a]);
      existing.score = Math.max(existing.score, score);
    } else {
      candidatesById.set(birdieId, {
        birdieId,
        score,
        matchedSignals: matchedSignals.sort((a, b) => SIGNAL_SCORE[b] - SIGNAL_SCORE[a])
      });
    }
  }

  const candidates = [...candidatesById.values()].sort((a, b) => b.score - a.score || a.birdieId.localeCompare(b.birdieId));
  const confidence = candidates[0]?.score ?? 0;
  const winners = candidates.filter((candidate) => candidate.score === confidence);
  const strongCandidates = candidates.filter((candidate) => candidate.matchedSignals.some((signal) => signal !== "INSTAGRAM_HANDLE"));
  const stableCandidates = candidates.filter((candidate) => candidate.matchedSignals.includes("STABLE_PROVIDER_ID"));

  const stableContradiction = Boolean(providerUserId) && candidates.some((candidate) => {
    if (candidate.matchedSignals.includes("STABLE_PROVIDER_ID")) return false;
    const profile = profiles.find((item) => String(item?.birdieId ?? "").trim() === candidate.birdieId);
    const linkedId = String(profile?.instagramUserId ?? "").trim();
    return Boolean(linkedId) && linkedId !== providerUserId;
  });

  const conflictingEvidence =
    winners.length > 1 ||
    new Set(strongCandidates.map((candidate) => candidate.birdieId)).size > 1 ||
    (stableCandidates.length === 1 && candidates.some((candidate) => candidate.birdieId !== stableCandidates[0].birdieId)) ||
    stableContradiction;

  // Provider payload fields are advisory evidence only. In particular,
  // `emailVerified` is supplied by the caller of this boundary and cannot be
  // promoted into canonical ownership proof. The resolver's only explicit
  // link is a unique normalized work-item handle on an ACTIVE profile.
  const explicitLink = false;
  let reason = "No attributable provider evidence matched an ACTIVE Birdie Profile.";
  if (conflictingEvidence) reason = "Provider identity evidence is ambiguous or conflicting.";
  else if (stableCandidates.length === 1) reason = "Stable provider ID matched one ACTIVE candidate, but provider evidence is review-only.";
  else if (confidence === 60) reason = "Unique ACTIVE candidate matched normalized Instagram handle only.";

  const rawFieldsPresent = [
    identity.providerUserId && "providerUserId",
    identity.username && "username",
    identity.verifiedEmail && "verifiedEmail",
    identity.emailVerified && "emailVerified",
    identity.sourceEventId && "sourceEventId",
    identity.observedAt && "observedAt"
  ].filter(Boolean);

  return {
    source: PROVIDER_EVIDENCE_SOURCE,
    workItemId: id,
    evidenceVersion: PROVIDER_EVIDENCE_VERSION,
    candidates,
    candidateCount: candidates.length,
    explicitLink,
    conflictingEvidence,
    confidence,
    reason,
    provenance: {
      provider: identity.provider,
      ...(identity.sourceEventId ? { sourceEventId: identity.sourceEventId } : {}),
      ...(identity.observedAt ? { observedAt: identity.observedAt } : {}),
      rawFieldsPresent
    }
  };
}
