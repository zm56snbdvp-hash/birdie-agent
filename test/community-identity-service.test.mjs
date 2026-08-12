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

test("service forwards provider evidence and governed Q:T metadata", async () => {
  const gets = [];
  const posts = [];
  const service = createCommunityIdentityService({
    birdieOSGet: async (action, params) => {
      gets.push({ action, params });
      if (action === "communityWorkItem") return { data: { workItem: baseWorkItem } };
      throw new Error(`unexpected GET ${action}`);
    },
    birdieOSPost: async (payload) => {
      posts.push(payload);
      return { data: { accepted: true } };
    }
  });

  const result = await service.resolveByWorkItemId("WORK-1", {
    candidates: [{ birdieId: "BIRDIE-92" }],
    candidateCount: 1,
    explicitLink: false,
    conflictingEvidence: false,
    confidence: 92,
    reason: "Provider deterministic score 92."
  });

  assert.equal(gets.length, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].write.identityConfidence, 92);
  assert.equal(posts[0].write.identityDecisionMode, "AUTO_HIGH_CONFIDENCE");
  assert.equal(posts[0].write.matchedBirdieId, "BIRDIE-92");
  assert.match(posts[0].idempotencyKey, /^IDENTITY\|WORK-1\|v1$/);
  assert.equal(result.birdieOS.accepted, true);
});

test("service falls back to read-only BIRDIE_PROFILES exact-link lookup", async () => {
  const posts = [];
  const service = createCommunityIdentityService({
    birdieOSGet: async (action) => {
      if (action === "communityWorkItem") {
        return { data: { workItem: { ...baseWorkItem, externalUserId: "known.handle" } } };
      }
      if (action === "birdieProfiles") {
        return {
          data: {
            profiles: [
              { birdieId: "BIRDIE-EXACT", instagramHandle: "known.handle", status: "ACTIVE" }
            ]
          }
        };
      }
      throw new Error(`unexpected GET ${action}`);
    },
    birdieOSPost: async (payload) => {
      posts.push(payload);
      return { data: { accepted: true } };
    }
  });

  await service.resolveByWorkItemId("WORK-1");
  assert.equal(posts[0].write.identityConfidence, 100);
  assert.equal(posts[0].write.identityDecisionMode, "AUTO_EXACT_LINK");
});
