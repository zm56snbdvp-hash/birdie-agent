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

function fixture(profiles, workItem = baseWorkItem) {
  const gets = [];
  const posts = [];
  const service = createCommunityIdentityService({
    birdieOSGet: async (action, params) => {
      gets.push({ action, params });
      if (action === "communityWorkItem") return { data: { workItem } };
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

test("canonical exact profile link resolves without caller-supplied evidence", async () => {
  const { service, gets, posts } = fixture([
    {
      birdieId: "BIRDIE-EXACT",
      status: "ACTIVE",
      instagramHandle: " @High.Confidence "
    }
  ]);

  const result = await service.resolveByWorkItemId("WORK-1");

  assert.deepEqual(gets.map(({ action }) => action), [
    "communityWorkItem",
    "birdieProfiles"
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].write.identityConfidence, 100);
  assert.equal(posts[0].write.identityDecisionMode, "AUTO_EXACT_LINK");
  assert.equal(posts[0].write.matchedBirdieId, "BIRDIE-EXACT");
  assert.equal(posts[0].evidenceSource, undefined);
  assert.equal(posts[0].evidenceVersion, undefined);
  assert.equal(result.resolution.resolutionStatus, "IDENTITY_RESOLVED");
});

test("canonical exact rerun is a zero-write no-op without evidence", async () => {
  const { service, posts } = fixture([
    {
      birdieId: "BIRDIE-EXACT",
      status: "ACTIVE",
      instagramHandle: "high.confidence"
    }
  ], {
    ...baseWorkItem,
    resolutionStatus: "IDENTITY_RESOLVED",
    matchedBirdieId: "BIRDIE-EXACT"
  });

  const result = await service.resolveByWorkItemId("WORK-1");

  assert.equal(result.processed, false);
  assert.equal(result.reason, "WORK_ITEM_NOT_ELIGIBLE");
  assert.equal(posts.length, 0);
});

test("canonical duplicate-handle conflict overrides unique high provider evidence", async () => {
  const workItem = {
    ...baseWorkItem,
    externalUserId: "duplicate.handle"
  };
  const { service, posts } = fixture([
    {
      birdieId: "BIRDIE-A",
      status: "ACTIVE",
      instagramHandle: "duplicate.handle",
      email: "a@example.com"
    },
    {
      birdieId: "BIRDIE-B",
      status: "ACTIVE",
      instagramHandle: "@Duplicate.Handle",
      email: "b@example.com"
    }
  ], workItem);
  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    verifiedEmail: "a@example.com",
    emailVerified: true
  });
  assert.equal(evidence.confidence, 90);
  assert.equal(evidence.conflictingEvidence, false);

  await service.resolveByWorkItemId("WORK-1", evidence);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].write.identityDecisionMode, "FOUNDER_REVIEW_CONFLICT");
  assert.equal(posts[0].write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(posts[0].write.matchedBirdieId, "");
});

test("signed provider evidence cannot override a different canonical exact profile", async () => {
  const { service, posts } = fixture([
    {
      birdieId: "BIRDIE-EXACT",
      status: "ACTIVE",
      instagramHandle: "high.confidence"
    },
    {
      birdieId: "BIRDIE-PROVIDER",
      status: "ACTIVE",
      instagramUserId: "IG-STABLE-OTHER"
    }
  ]);
  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    providerUserId: "IG-STABLE-OTHER"
  });

  await service.resolveByWorkItemId("WORK-1", evidence);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].write.identityDecisionMode, "FOUNDER_REVIEW_CONFLICT");
  assert.equal(posts[0].write.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(posts[0].write.matchedBirdieId, "");
  assert.equal(posts[0].evidenceSource, "PROVIDER_EVIDENCE_V1");
});

test("canonical exact path rejects supplied unsigned evidence", async () => {
  const { service, posts } = fixture([
    {
      birdieId: "BIRDIE-EXACT",
      status: "ACTIVE",
      instagramHandle: "high.confidence"
    }
  ]);

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

test("provider username alone cannot auto-resolve a different canonical work-item handle", async () => {
  const { service, posts } = fixture([
    { birdieId: "BIRDIE-HANDLE", status: "ACTIVE", instagramHandle: "high.confidence" }
  ], {
    ...baseWorkItem,
    externalUserId: "different.handle"
  });

  const evidence = await service.produceEvidenceByWorkItemId("WORK-1", {
    provider: "INSTAGRAM",
    username: "high.confidence"
  });
  await service.resolveByWorkItemId("WORK-1", evidence);

  assert.equal(posts[0].write.identityConfidence, 60);
  assert.equal(posts[0].write.identityDecisionMode, "FOUNDER_REVIEW_LOW_CONFIDENCE");
  assert.equal(posts[0].write.resolutionStatus, "IDENTITY_PENDING");
});
