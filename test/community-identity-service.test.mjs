import test from "node:test";
import assert from "node:assert/strict";
import { createCommunityIdentityService } from "../src/community/identity-service.mjs";

const baseWorkItem = {
  workItemId: "WORK-1",
  sourceType: "INSTAGRAM",
  externalUserId: "high.confidence",
  resolutionStatus: "IDENTITY_PENDING",
  matchedBirdieId: ""
};

function fixture(profiles) {
  const gets = [];
  const posts = [];
  const service = createCommunityIdentityService({
    birdieOSGet: async (action, params) => {
      gets.push({ action, params });
      if (action === "communityWorkItem") return { data: { workItem: baseWorkItem } };
      if (action === "birdieProfiles") return { data: { profiles } };
      throw new Error(`unexpected GET ${action}`);
    },
    birdieOSPost: async (payload) => {
      posts.push(payload);
      return { data: { accepted: true } };
    },
    evidenceSigningKey: "test-signing-key"
  });
  return { service, gets, posts };
}

test("IDPE-008 evidence production performs zero writes", async () => {
  const { service, gets, posts } = fixture([
    { birdieId: "BIRDIE-90", status: "ACTIVE", email: "kevin@example.com" }
  ]);

  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    verifiedEmail: "kevin@example.com",
    emailVerified: true,
    sourceEventId: "IG-EVENT-90",
    observedAt: "2026-08-12T14:00:00Z"
  });

  assert.equal(gets.length, 2);
  assert.equal(posts.length, 0);
  assert.equal(evidence.confidence, 90);
  assert.equal(evidence.candidates[0].birdieId, "BIRDIE-90");
  assert.ok(evidence.integrityToken);
});

test("dry run forwards signed producer evidence into governed Q:T metadata", async () => {
  const { service, posts } = fixture([
    { birdieId: "BIRDIE-90", status: "ACTIVE", email: "kevin@example.com" }
  ]);

  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    verifiedEmail: "kevin@example.com",
    emailVerified: true
  });
  const result = await service.resolveByWorkItemId("WORK-1", evidence);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].write.identityConfidence, 90);
  assert.equal(posts[0].write.identityDecisionMode, "AUTO_HIGH_CONFIDENCE");
  assert.equal(posts[0].write.matchedBirdieId, "BIRDIE-90");
  assert.equal(posts[0].evidenceSource, "PROVIDER_EVIDENCE_V1");
  assert.match(posts[0].idempotencyKey, /^IDENTITY\|WORK-1\|v1$/);
  assert.equal(result.birdieOS.accepted, true);
});

test("resolver rejects caller-authored unsigned evidence", async () => {
  const { service, posts } = fixture([]);

  await assert.rejects(
    service.resolveByWorkItemId("WORK-1", {
      source: "PROVIDER_EVIDENCE_V1",
      evidenceVersion: "v1",
      workItemId: "WORK-1",
      candidates: [{ birdieId: "BIRDIE-FORGED" }],
      candidateCount: 1,
      explicitLink: true,
      conflictingEvidence: false,
      confidence: 100
    }),
    /SIGNED_PROVIDER_EVIDENCE_REQUIRED/
  );
  assert.equal(posts.length, 0);
});

test("normalized handle-only producer evidence cannot auto-resolve", async () => {
  const { service, posts } = fixture([
    { birdieId: "BIRDIE-HANDLE", status: "ACTIVE", instagramHandle: "high.confidence" }
  ]);

  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    username: "high.confidence"
  });
  await service.resolveByWorkItemId("WORK-1", evidence);

  assert.equal(posts[0].write.identityConfidence, 60);
  assert.equal(posts[0].write.identityDecisionMode, "FOUNDER_REVIEW_LOW_CONFIDENCE");
  assert.equal(posts[0].write.resolutionStatus, "IDENTITY_PENDING");
});
