import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import {
  normalizeInstagramHandle,
  resolveInstagramIdentity
} from "../src/community/identity-resolution.mjs";

const NOW = "2026-08-12T05:40:00+02:00";
const appsScriptSource = await readFile(
  new URL("../birdie-os/community-identity.gs", import.meta.url),
  "utf8"
);

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

test("IDRES-001 object-shaped evidence cannot impersonate a canonical exact link", () => {
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
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_LOW_CONFIDENCE");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "FOUNDER_REVIEW_REQUIRED");
  assert.equal(result.write.identityConflict, false);
});

test("IDRES-002 unique high-confidence provider candidate stays pending", () => {
  const result = resolveInstagramIdentity(workItem("high.confidence"), {
    candidates: [{ birdieId: "BIRDIE-HIGH" }],
    candidateCount: 1,
    explicitLink: false,
    conflictingEvidence: false,
    confidence: 92,
    reason: "Unique candidate scored 92 from deterministic provider evidence."
  }, NOW);

  assert.equal(result.write.identityConfidence, 92);
  assert.equal(result.write.identityDecisionMode, "FOUNDER_REVIEW_LOW_CONFIDENCE");
  assert.equal(result.write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "FOUNDER_REVIEW_REQUIRED");
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

test("only one normalized ACTIVE profile handle can auto-resolve", () => {
  const profiles = [
    { birdieId: "BIRDIE-INACTIVE", instagramHandle: "exact.owner", status: "INACTIVE" },
    { birdieId: "BIRDIE-NAME", displayName: "Exact Owner", status: "ACTIVE" },
    { birdieId: "BIRDIE-EMAIL", email: "exact.owner", status: "ACTIVE" },
    { birdieId: "BIRDIE-EXACT", instagramHandle: " @Exact.Owner ", status: "ACTIVE" }
  ];

  const result = resolveInstagramIdentity(workItem("exact.owner"), profiles, NOW);

  assert.equal(result.write.identityDecisionMode, "AUTO_EXACT_LINK");
  assert.equal(result.write.matchedBirdieId, "BIRDIE-EXACT");
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

test("Apps Script rejects AUTO_HIGH_CONFIDENCE and still verifies AUTO_EXACT_LINK", () => {
  const context = {};
  runInNewContext(appsScriptSource, context);
  context.birdieCommunityActiveExactMatches_ = () => [{ birdieId: "BIRDIE-EXACT" }];

  const common = {
    processedBy: "ZAPIER_IDENTITY_RESOLVER",
    resolutionStatus: "IDENTITY_RESOLVED",
    matchedBirdieId: "BIRDIE-EXACT",
    agentNotes: "test",
    identityConfidence: 100,
    identityReason: "test",
    identityConflict: false
  };

  assert.throws(
    () => context.birdieCommunityValidateIdentityWrite_({}, {
      ...common,
      decision: "HIGH_CONFIDENCE_MATCH",
      identityDecisionMode: "AUTO_HIGH_CONFIDENCE"
    }),
    /UNKNOWN_IDENTITY_DECISION_MODE/
  );

  const exact = context.birdieCommunityValidateIdentityWrite_({ externalUserId: "exact.owner" }, {
    ...common,
    decision: "EXACT_IDENTITY_LINK",
    identityDecisionMode: "AUTO_EXACT_LINK"
  });
  assert.equal(exact.matchedBirdieId, "BIRDIE-EXACT");

  const reviewOnly = context.birdieCommunityValidateIdentityWrite_({}, {
    ...common,
    resolutionStatus: "IDENTITY_PENDING",
    matchedBirdieId: "",
    decision: "FOUNDER_REVIEW_REQUIRED",
    identityDecisionMode: "FOUNDER_REVIEW_LOW_CONFIDENCE"
  });
  assert.equal(reviewOnly.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(reviewOnly.identityConfidence, 100);
});
