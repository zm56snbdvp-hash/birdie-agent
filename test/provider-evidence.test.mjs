import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveProviderEvidence,
  signProviderEvidence,
  verifyProviderEvidence
} from "../src/community/provider-evidence.mjs";

const workItemId = "WORK-IDPE";

function identity(overrides = {}) {
  return {
    provider: "INSTAGRAM",
    sourceEventId: "IG-EVENT-1",
    observedAt: "2026-08-12T14:00:00Z",
    ...overrides
  };
}

function derive(providerIdentity, profiles) {
  return deriveProviderEvidence({ workItemId, providerIdentity, profiles });
}

test("IDPE-001 stable Instagram provider ID is advisory and never an explicit link", () => {
  const result = derive(identity({ providerUserId: "IG-100" }), [
    { birdieId: "BIRDIE-100", status: "ACTIVE", instagramUserId: "IG-100" }
  ]);

  assert.equal(result.confidence, 100);
  assert.equal(result.explicitLink, false);
  assert.equal(result.conflictingEvidence, false);
  assert.deepEqual(result.candidates[0].matchedSignals, ["STABLE_PROVIDER_ID"]);
});

test("IDPE-002 caller-supplied emailVerified cannot create a profile candidate", () => {
  const result = derive(identity({
    verifiedEmail: " Kevin@Example.com ",
    emailVerified: true
  }), [
    { birdieId: "BIRDIE-90", status: "ACTIVE", email: "kevin@example.com" }
  ]);

  assert.equal(result.confidence, 0);
  assert.equal(result.explicitLink, false);
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.provenance.rawFieldsPresent, [
    "verifiedEmail",
    "emailVerified",
    "sourceEventId",
    "observedAt"
  ]);
});

test("IDPE-003 username-only match remains advisory", () => {
  const result = derive(identity({ username: " @Known.Handle " }), [
    { birdieId: "BIRDIE-60", status: "ACTIVE", instagramHandle: "known.handle" }
  ]);

  assert.equal(result.confidence, 60);
  assert.equal(result.explicitLink, false);
  assert.equal(result.conflictingEvidence, false);
});

test("IDPE-004 shared email does not create candidates or a conflict", () => {
  const result = derive(identity({ verifiedEmail: "shared@example.com", emailVerified: true }), [
    { birdieId: "BIRDIE-B", status: "ACTIVE", email: "shared@example.com" },
    { birdieId: "BIRDIE-A", status: "ACTIVE", email: "shared@example.com" }
  ]);

  assert.equal(result.confidence, 0);
  assert.equal(result.conflictingEvidence, false);
  assert.deepEqual(result.candidates, []);
});

test("IDPE-005 untrusted email cannot conflict with stable provider-ID evidence", () => {
  const result = derive(identity({
    providerUserId: "IG-STABLE",
    verifiedEmail: "other@example.com",
    emailVerified: true
  }), [
    { birdieId: "BIRDIE-ID", status: "ACTIVE", instagramUserId: "IG-STABLE" },
    { birdieId: "BIRDIE-EMAIL", status: "ACTIVE", email: "other@example.com" }
  ]);

  assert.equal(result.confidence, 100);
  assert.equal(result.conflictingEvidence, false);
  assert.equal(result.explicitLink, false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.birdieId), ["BIRDIE-ID"]);
});

test("IDPE-006 missing attributable signals remains a zero no-match", () => {
  const result = derive(identity(), [
    { birdieId: "BIRDIE-1", status: "ACTIVE", instagramHandle: "unused" }
  ]);

  assert.equal(result.confidence, 0);
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.candidates, []);
});

test("IDPE-007 inactive profiles are ignored", () => {
  const result = derive(identity({ providerUserId: "IG-INACTIVE" }), [
    { birdieId: "BIRDIE-INACTIVE", status: "INACTIVE", instagramUserId: "IG-INACTIVE" }
  ]);

  assert.equal(result.confidence, 0);
  assert.equal(result.candidateCount, 0);
});

test("derived evidence fields are rejected at the raw-input boundary", () => {
  assert.throws(
    () => derive(identity({ confidence: 100 }), []),
    /DERIVED_PROVIDER_EVIDENCE_NOT_ALLOWED:confidence/
  );
});

test("signed evidence rejects tampering", () => {
  const evidence = derive(identity({ username: "known.handle" }), [
    { birdieId: "BIRDIE-60", status: "ACTIVE", instagramHandle: "known.handle" }
  ]);
  const signed = {
    ...evidence,
    integrityToken: signProviderEvidence(evidence, "test-secret")
  };

  assert.equal(verifyProviderEvidence(signed, "test-secret").confidence, 60);
  assert.throws(
    () => verifyProviderEvidence({ ...signed, confidence: 100 }, "test-secret"),
    /INVALID_PROVIDER_EVIDENCE_SIGNATURE/
  );
});
