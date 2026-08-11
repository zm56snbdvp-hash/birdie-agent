import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInstagramHandle,
  resolveInstagramIdentity
} from "../src/community/identity-resolution.mjs";

test("normalizes handles exactly", () => {
  assert.equal(normalizeInstagramHandle("  @Schulli.Birdie  "), "schulli.birdie");
  assert.equal(normalizeInstagramHandle("@@double"), "@double");
});

test("schulli.birdie returns NO_PROFILE_MATCH when no ACTIVE exact match exists", () => {
  const result = resolveInstagramIdentity(
    {
      sourceType: "INSTAGRAM",
      externalUserId: "schulli.birdie",
      resolutionStatus: "PENDING_IDENTITY",
      matchedBirdieId: ""
    },
    [],
    "2026-08-11T22:50:00+02:00"
  );

  assert.equal(result.processed, true);
  assert.deepEqual(result.write, {
    resolutionStatus: "IDENTITY_PENDING",
    matchedBirdieId: "",
    decision: "NO_PROFILE_MATCH",
    agentNotes: "Instagram identity not yet linked to a Birdie Profile.",
    processedBy: "ZAPIER_IDENTITY_RESOLVER",
    processedAt: "2026-08-11T22:50:00+02:00"
  });
});

test("exact ACTIVE handle resolves one profile", () => {
  const result = resolveInstagramIdentity(
    {
      sourceType: "INSTAGRAM",
      externalUserId: "@Kevin.Test",
      resolutionStatus: "PENDING_IDENTITY",
      matchedBirdieId: ""
    },
    [
      {
        birdieId: "BIRDIE-001",
        instagramHandle: " kevin.test ",
        status: "ACTIVE"
      }
    ]
  );

  assert.equal(result.write.resolutionStatus, "IDENTITY_RESOLVED");
  assert.equal(result.write.matchedBirdieId, "BIRDIE-001");
  assert.equal(result.write.decision, "MATCHED_EXISTING_PROFILE");
});

test("multiple ACTIVE exact matches create conflict", () => {
  const result = resolveInstagramIdentity(
    {
      sourceType: "INSTAGRAM",
      externalUserId: "same.handle",
      resolutionStatus: "PENDING_IDENTITY",
      matchedBirdieId: ""
    },
    [
      { birdieId: "B1", instagramHandle: "same.handle", status: "ACTIVE" },
      { birdieId: "B2", instagramHandle: "@SAME.HANDLE", status: "ACTIVE" }
    ]
  );

  assert.equal(result.write.resolutionStatus, "IDENTITY_CONFLICT");
  assert.equal(result.write.matchedBirdieId, "");
  assert.equal(result.write.decision, "MULTIPLE_PROFILE_MATCHES");
});

test("processing guard blocks non-eligible work items", () => {
  const result = resolveInstagramIdentity(
    {
      sourceType: "INSTAGRAM",
      externalUserId: "schulli.birdie",
      resolutionStatus: "IDENTITY_PENDING",
      matchedBirdieId: ""
    },
    []
  );

  assert.deepEqual(result, {
    processed: false,
    reason: "WORK_ITEM_NOT_ELIGIBLE"
  });
});
