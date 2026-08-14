import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInstagramHandle,
  resolveInstagramIdentity
} from "../src/community/identity-resolution.mjs";

const NOW = "2026-08-12T05:40:00+02:00";

function workItem(externalUserId) {
  return {
    workItemId: `WORK-${externalUserId}`,
    sourceType: "INSTAGRAM",
    externalUserId,
    resolutionStatus: "IDENTITY_PENDING",
    matchedBirdieId: ""
  };
}

test("normalizes handles exactly", () => {
  assert.equal(normalizeInstagramHandle("  @Schulli.Birdie  "), "schulli.birdie");
  assert.equal(normalizeInstagramHandle("@@double"), "@double");
});

test("IDRES-001 exact explicit identity link", () => {
  const result = resolveInstagramIdentity(workItem("known.handle"), {
    candidates: [{ birdieId: "BIRDIE-EXACT" }],
    candidateCount: 1,
    explicitLink: true,
    conflictingEvidence: false,
    confidence: 100,
    reason: "Verified explicit Instagram identity link."
  }, NOW);

  assert.equal(result.processed, true);
  assert.equal(result.write.identityConfidence, 100);
  assert.equal(result.write.identityDecisionMode, "AUTO_EXACT_LINK");
  assert.equal(result.write.resolutionStatus, "IDENTITY_RESOLVED");
  assert.equal(result.write.matchedBirdieId, "BIRDIE-EXACT");
  assert.equal(result.write.decision, "EXACT_IDENTITY_LINK");
  assert.equal(result.write.identityConflict, false);
});

test("IDRES-002 unique high-confidence candidate", () => {
  const result = resolveInstagramIdentity(workItem("high.confidence"), {
    candidates: [{ birdieId: "BIRDIE-HIGH" }],
    candidateCount: 1,
    explicitLink: false,
    conflictingEvidence: false,
    confidence: 92,
    reason: "Unique candidate scored 92 from deterministic provider evidence."
  }, NOW);

  assert.equal(result.write.identityConfidence, 92);
  assert.equal(result.write.identityDecisionMode, "AUTO_HIGH_CONFIDENCE");
  assert.equal(result.write.resolutionStatus, "IDENTITY_RESOLVED");
  assert.equal(result.write.matchedBirdieId, "BIRDIE-HIGH");
  assert.equal(result.write.decision, "HIGH_CONFIDENCE_MATCH");
  assert.equal(result.write.identityConflict, false);
});

test("IDRES-003 multiple candidates override high confidence", () => {
  const result = resolveInstagramIdentity(workItem("ambiguous.handle"), {
    candidates: [{ birdieId: "BIRDIE-A" }, { birdieId: "BIRDIE-B" }],
    candidateCount: 2,
    explicitLink: false,
    conflictingEvidence: false,
    confidence: 95,
    reason: "Two plausible candidates remain."
  }, NOW);

  assert.equal(result.write.identityConfidence, 95);
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_CONFLICT");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "FOUNDER_REVIEW_REQUIRED");
  assert.equal(result.write.identityConflict, true);
});

test("IDRES-004 contradictory evidence overrides high confidence", () => {
  const result = resolveInstagramIdentity(workItem("conflict.handle"), {
    candidates: [{ birdieId: "BIRDIE-CONFLICT" }],
    candidateCount: 1,
    explicitLink: false,
    conflictingEvidence: true,
    confidence: 97,
    reason: "Handle and email evidence contradict each other."
  }, NOW);

  assert.equal(result.write.identityConfidence, 97);
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_CONFLICT");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "FOUNDER_REVIEW_REQUIRED");
  assert.equal(result.write.identityConflict, true);
});

test("IDRES-005 no match stays pending", () => {
  const result = resolveInstagramIdentity(workItem("unknown.handle"), {
    candidates: [],
    candidateCount: 0,
    explicitLink: false,
    conflictingEvidence: false,
    confidence: 0,
    reason: "No candidate profile found."
  }, NOW);

  assert.equal(result.write.identityConfidence, 0);
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_LOW_CONFIDENCE");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "NO_PROFILE_MATCH");
  assert.equal(result.write.identityConflict, false);
});

test("BIRDIE_PROFILES exact handle is treated as an explicit identity link", () => {
  const result = resolveInstagramIdentity(workItem("@Kevin.Test"), [
    { birdieId: "BIRDIE-001", instagramHandle: " kevin.test ", status: "ACTIVE" }
  ], NOW);

  assert.equal(result.write.identityConfidence, 100);
  assert.equal(result.write.identityDecisionMode, "AUTO_EXACT_LINK");
  assert.equal(result.write.resolutionStatus, "IDENTITY_RESOLVED");
  assert.equal(result.write.matchedBirdieId, "BIRDIE-001");
});

test("duplicate ACTIVE exact handles fail closed as a conflict", () => {
  const result = resolveInstagramIdentity(workItem("duplicate.handle"), [
    { birdieId: "BIRDIE-A", instagramHandle: "duplicate.handle", status: "ACTIVE" },
    { birdieId: "BIRDIE-B", instagramHandle: "@Duplicate.Handle", status: "ACTIVE" }
  ], NOW);

  assert.equal(result.write.identityConfidence, 100);
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_CONFLICT");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
});

test("processing guard blocks resolved work items", () => {
  const result = resolveInstagramIdentity({
    ...workItem("known.handle"),
    resolutionStatus: "IDENTITY_RESOLVED"
  }, []);

  assert.deepEqual(result, {
    processed: false,
    reason: "WORK_ITEM_NOT_ELIGIBLE"
  });
});
