import assert from "node:assert/strict";
import test from "node:test";

import { getLevel } from "../src/coin/catalog.mjs";
import { createCoinService } from "../src/coin/service.mjs";

function serviceWithRecorder() {
  const calls = [];
  const service = createCoinService({
    async birdieOSPost(payload) {
      calls.push(payload);
      return { success: true, data: payload };
    }
  });

  return { service, calls };
}

test("levels are based on lifetime Birdies", () => {
  assert.equal(getLevel(0).code, "TEE_STARTER");
  assert.equal(getLevel(10).code, "FAIRWAY_FRIEND");
  assert.equal(getLevel(25).code, "CLUBHOUSE_BIRDIE");
  assert.equal(getLevel(50).code, "FLOCK_CAPTAIN");
  assert.equal(getLevel(100).code, "BIRDIE_LEGEND");
});

test("profile input is normalized before it reaches Birdie OS", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.createProfile({
    displayName: "  Lee-Ann  ",
    email: "LEE@example.com",
    accountType: "private",
    instagramHandle: "@lee",
    publicWall: true,
    idempotencyKey: "profile:lee"
  });

  assert.deepEqual(calls[0], {
    action: "coinCreateProfile",
    displayName: "Lee-Ann",
    email: "lee@example.com",
    accountType: "PRIVATE",
    instagramHandle: "lee",
    publicWall: true,
    migrationProfile: false,
    idempotencyKey: "profile:lee",
    source: "Birdie Agent"
  });
});

test("legacy supporter profiles require founder approval", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.createProfile({
      displayName: "Lee-Ann",
      email: "lee@example.com",
      accountType: "PRIVATE",
      migrationProfile: true,
      idempotencyKey: "profile:lee"
    }),
    { code: "FOUNDER_APPROVAL_REQUIRED", status: 403 }
  );
});

test("approved legacy supporter profile is marked for exact score migration", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.createProfile({
    displayName: "Lee-Ann",
    email: "lee@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:lee"
  });

  assert.equal(calls[0].migrationProfile, true);
  assert.equal(calls[0].founderApproved, true);
});

test("supporters cannot choose their own claim amount", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.createClaim({
      birdieId: "BIRDIE-1",
      actionCode: "STORY_SHARE_TAGGED",
      sourceType: "INSTAGRAM",
      sourceReference: "story:123",
      points: 999,
      idempotencyKey: "claim:story:123"
    }),
    { code: "CLIENT_AMOUNT_FORBIDDEN" }
  );
});

test("unknown action codes are rejected", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.createClaim({
      birdieId: "BIRDIE-1",
      actionCode: "FREE_COINS",
      sourceType: "ADMIN",
      sourceReference: "bad-action",
      idempotencyKey: "claim:bad-action"
    }),
    { code: "UNKNOWN_ACTION" }
  );
});

test("fixed-value claim approvals do not need a caller supplied amount", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.decideClaim("CLAIM-1", {
    decision: "APPROVE",
    idempotencyKey: "decision:claim-1"
  });

  assert.equal(calls[0].action, "coinDecideClaim");
  assert.equal(calls[0].approvedAmount, undefined);
});

test("opening balance requires founder approval", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.importOpeningBalance({
      birdieId: "BIRDIE-1",
      amount: 14,
      sourceReference: "supporter-score-2026-08-10",
      idempotencyKey: "opening:BIRDIE-1"
    }),
    { code: "FOUNDER_APPROVAL_REQUIRED", status: 403 }
  );
});

test("Founding Birdie badge requires founder approval", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.awardBadge("BIRDIE-1", {
      badgeCode: "FOUNDING_BIRDIE",
      idempotencyKey: "badge:BIRDIE-1:founding"
    }),
    { code: "FOUNDER_APPROVAL_REQUIRED", status: 403 }
  );
});

test("approved Founding Birdie badge is sent to Birdie OS", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.awardBadge("BIRDIE-1", {
    badgeCode: "FOUNDING_BIRDIE",
    founderApproved: true,
    idempotencyKey: "badge:BIRDIE-1:founding"
  });

  assert.equal(calls[0].action, "coinAwardBadge");
  assert.equal(calls[0].founderApproved, true);
});

test("approved opening balance is forwarded as an auditable migration", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.importOpeningBalance({
    birdieId: "BIRDIE-1",
    amount: 14,
    sourceReference: "supporter-score-2026-08-10",
    founderApproved: true,
    idempotencyKey: "opening:BIRDIE-1"
  });

  assert.equal(calls[0].action, "coinImportOpeningBalance");
  assert.equal(calls[0].amount, 14);
  assert.equal(calls[0].founderApproved, true);
});

test("reward price cannot be overridden by the client", async () => {
  const { service } = serviceWithRecorder();

  await assert.rejects(
    service.createRedemption({
      birdieId: "BIRDIE-1",
      rewardId: "RW-PRIVATE-WALLPAPER",
      amount: 1,
      idempotencyKey: "redeem:1"
    }),
    { code: "CLIENT_AMOUNT_FORBIDDEN" }
  );
});
