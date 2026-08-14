import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_DEFINITIONS, getLevel } from "../src/coin/catalog.mjs";
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

test("IG_COMMENT is a fixed private manual-approval action", () => {
  assert.deepEqual(ACTION_DEFINITIONS.IG_COMMENT, {
    accountTypes: ["PRIVATE"],
    points: 1,
    sourceTypes: ["INSTAGRAM"],
    approvalMode: "MANUAL_APPROVAL",
    frequencyRule: "PER_DISTINCT_COMMENT",
    version: "V1",
    status: "ACTIVE",
    rolloutMode: "CONTROLLED_E2E"
  });
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

test("existing profile Instagram handle is normalized and narrowly forwarded", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.linkInstagramHandle("BIRDIE-123", {
    instagramHandle: " @Second.Shot.Kev ",
    idempotencyKey: "profile-instagram:BIRDIE-123:second.shot.kev",
    displayName: "must not pass",
    email: "must-not-pass@example.com",
    accountType: "B2B",
    publicWall: true,
    status: "INACTIVE",
    amount: 999
  });

  assert.deepEqual(calls[0], {
    action: "coinLinkInstagramHandle",
    birdieId: "BIRDIE-123",
    instagramHandle: "second.shot.kev",
    idempotencyKey: "profile-instagram:BIRDIE-123:second.shot.kev",
    source: "Birdie Agent"
  });
});

test("invalid existing-profile Instagram handles are rejected", async () => {
  const invalidHandles = [
    "https://instagram.com/foo",
    "foo/bar",
    "",
    "   ",
    "foo bar",
    "@@foo"
  ];

  for (const instagramHandle of invalidHandles) {
    const { service, calls } = serviceWithRecorder();
    await assert.rejects(
      service.linkInstagramHandle("BIRDIE-123", {
        instagramHandle,
        idempotencyKey: "profile-instagram:BIRDIE-123:invalid"
      }),
      (error) => ["INVALID_INSTAGRAM_HANDLE", "MISSING_FIELD"].includes(error.code)
    );
    assert.equal(calls.length, 0);
  }
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

test("generic claims cannot bypass the dedicated Instagram comment action", async () => {
  const { service, calls } = serviceWithRecorder();

  await assert.rejects(
    service.createClaim({
      birdieId: "BIRDIE-1",
      actionCode: "IG_COMMENT",
      sourceType: "INSTAGRAM",
      sourceReference: "17930197359365940",
      idempotencyKey: "claim:ig:ig_comment:tanjastroop:17930197359365940"
    }),
    { code: "DEDICATED_IG_COMMENT_ACTION_REQUIRED" }
  );
  assert.equal(calls.length, 0);
});

test("dedicated Instagram comment flow forwards identifiers but no economic fields", async () => {
  const { service, calls } = serviceWithRecorder();
  const eventId = "SCE-20260814-0138-TANJA";

  await service.bindInstagramCommentIdentity(eventId, {
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-1",
    confirmation: "BIND_IG_COMMENT_IDENTITY",
    actionCode: "STORY_SHARE_TAGGED",
    sourceReference: "caller-controlled",
    idempotencyKey: "caller-controlled"
  });
  await service.createInstagramCommentClaim(eventId, {
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-1",
    confirmation: "CREATE_IG_COMMENT_CLAIM",
    actionCode: "STORY_SHARE_TAGGED",
    sourceType: "ADMIN",
    sourceReference: "caller-controlled",
    idempotencyKey: "caller-controlled"
  });
  await service.markInstagramCommentWritten(eventId, {
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-1",
    claimId: "CLAIM-1",
    confirmation: "MARK_IG_COMMENT_WRITTEN",
    transactionId: "caller-controlled",
    amount: undefined
  });

  assert.deepEqual(calls, [
    {
      action: "coinBindInstagramCommentIdentity",
      eventId,
      workItemId: "WORK-IG-COMMENT-17930197359365940",
      birdieId: "BIRDIE-1",
      confirmation: "BIND_IG_COMMENT_IDENTITY",
      source: "Birdie Agent"
    },
    {
      action: "coinCreateInstagramCommentClaim",
      eventId,
      workItemId: "WORK-IG-COMMENT-17930197359365940",
      birdieId: "BIRDIE-1",
      confirmation: "CREATE_IG_COMMENT_CLAIM",
      source: "Birdie Agent"
    },
    {
      action: "coinMarkInstagramCommentWritten",
      eventId,
      workItemId: "WORK-IG-COMMENT-17930197359365940",
      birdieId: "BIRDIE-1",
      claimId: "CLAIM-1",
      confirmation: "MARK_IG_COMMENT_WRITTEN",
      source: "Birdie Agent"
    }
  ]);
});

test("Instagram comment controls reject a wrong confirmation and caller amount", async () => {
  const { service, calls } = serviceWithRecorder();

  await assert.rejects(
    service.createInstagramCommentClaim("SCE-1", {
      workItemId: "WORK-1",
      birdieId: "BIRDIE-1",
      confirmation: "GO"
    }),
    { code: "INVALID_CONFIRMATION" }
  );
  await assert.rejects(
    service.markInstagramCommentWritten("SCE-1", {
      birdieId: "BIRDIE-1",
      claimId: "CLAIM-1",
      confirmation: "MARK_IG_COMMENT_WRITTEN",
      points: 1
    }),
    { code: "CLIENT_AMOUNT_FORBIDDEN" }
  );
  assert.equal(calls.length, 0);
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

test("manual Instagram comment approval confirmation reaches Birdie OS", async () => {
  const { service, calls } = serviceWithRecorder();

  await service.decideClaim("CLAIM-IG-1", {
    decision: "APPROVE",
    eventId: "SCE-IG-1",
    workItemId: "WORK-IG-1",
    birdieId: "BIRDIE-1",
    confirmation: "APPROVE_IG_COMMENT_CLAIM",
    idempotencyKey: "decision:claim-ig-1"
  });

  assert.equal(calls[0].action, "coinDecideClaim");
  assert.equal(calls[0].eventId, "SCE-IG-1");
  assert.equal(calls[0].workItemId, "WORK-IG-1");
  assert.equal(calls[0].birdieId, "BIRDIE-1");
  assert.equal(calls[0].confirmation, "APPROVE_IG_COMMENT_CLAIM");
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
