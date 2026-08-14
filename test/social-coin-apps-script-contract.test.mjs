import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const coinSource = await readFile(
  new URL("../birdie-os/coin-system.gs", import.meta.url),
  "utf8"
);
const socialSource = await readFile(
  new URL("../birdie-os/social-coin-events.gs", import.meta.url),
  "utf8"
);

function event(overrides = {}) {
  const coinWriteStatus = overrides.coinWriteStatus ?? "NOT_WRITTEN";
  return {
    eventId: "SCE-20260814-0138-TANJA",
    platform: "Instagram",
    eventType: "IG_COMMENT",
    instagramHandle: "tanjastroop",
    birdieId: "BIRDIE-123",
    points: 1,
    sourceReference: "17930197359365940",
    verificationStatus: "IDENTITY_RESOLVED",
    coinWriteStatus,
    createdAt: "2026-08-14T01:38:00.000Z",
    verifiedAt: "2026-08-14T10:30:00.000Z",
    processedAt:
      coinWriteStatus === "WRITTEN"
        ? "2026-08-14T10:45:00.000Z"
        : "",
    idempotencyKey:
      "ig:ig_comment:tanjastroop:17930197359365940",
    note: "Canonical authenticated Instagram comment",
    ...overrides
  };
}

function workItem(overrides = {}) {
  return {
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    syncEventId: "SCE-20260814-0138-TANJA",
    sourceType: "INSTAGRAM",
    externalUserId: "tanjastroop",
    eventType: "IG_COMMENT",
    actionCode: "IG_COMMENT",
    sourceReference: "17930197359365940",
    resolutionStatus: "IDENTITY_RESOLVED",
    matchedBirdieId: "BIRDIE-123",
    decision: "EXACT_IDENTITY_LINK",
    identityConfidence: 100,
    identityConflict: false,
    identityDecisionMode: "AUTO_EXACT_LINK",
    sourceSnapshotKey: "PROVIDER-SNAPSHOT-IG-COMMENT-1",
    ...overrides
  };
}

function contextFor(initialEvent, options = {}) {
  const currentEvent = structuredClone(initialEvent);
  const writes = [];
  const claimWrites = [];
  const transactionAppends = [];
  const audits = [];
  let flushes = 0;
  let lockWaits = 0;
  let lockReleases = 0;
  let claimCalls = [];

  const claim = {
    claimId: "CLAIM-1",
    birdieId: "BIRDIE-123",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    approvedAmount: 1,
    idempotencyKey:
      "claim:ig:ig_comment:tanjastroop:17930197359365940"
  };
  const transaction = {
    transactionId: "TX-1",
    approvedAt: "2026-08-14T10:40:00.000Z",
    birdieId: "BIRDIE-123",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    idempotencyKey: "claim:CLAIM-1"
  };
  const transactions = options.transactions === undefined
    ? [transaction]
    : structuredClone(options.transactions);

  const context = {
    LockService: {
      getScriptLock() {
        return {
          waitLock(milliseconds) {
            assert.equal(milliseconds, 20000);
            lockWaits += 1;
          },
          releaseLock() {
            lockReleases += 1;
          }
        };
      }
    },
    SpreadsheetApp: {
      flush() {
        flushes += 1;
      }
    }
  };
  runInNewContext(`${coinSource}\n${socialSource}`, context);

  context.birdieSocialFindEvent_ = () => ({
    row: 2,
    object: structuredClone(currentEvent),
    sheet: { kind: "events" }
  });
  context.birdieSocialRequireEventBySourceReference_ = () => ({
    row: 2,
    object: structuredClone(currentEvent),
    sheet: { kind: "events" }
  });
  context.birdieSocialRequireWorkItem_ = () =>
    structuredClone(options.workItem || workItem());
  context.birdieSocialRequireResolvedWorkItemForEvent_ = (
    targetEvent,
    birdieId,
    expectedWorkItemId
  ) => {
    const candidate = structuredClone(options.workItem || workItem());
    if (
      expectedWorkItemId &&
      candidate.workItemId !== expectedWorkItemId
    ) {
      throw new Error("IG_COMMENT_WORK_ITEM_MISMATCH");
    }
    return context.birdieSocialValidateResolvedWorkItem_(
      candidate,
      targetEvent,
      birdieId
    );
  };
  context.birdieSocialRequireUniqueInstagramComment_ = () => {};
  context.birdieSocialRequireApprovedInstagramCommentRule_ = () => ({
    actionCode: "IG_COMMENT",
    status: "ACTIVE"
  });
  context.birdieCoinRequireProfile_ = () => ({
    birdieId: "BIRDIE-123",
    accountType: "PRIVATE",
    instagramHandle: "tanjastroop",
    status: "ACTIVE"
  });
  context.birdieSocialWriteField_ = (_sheet, _row, _headers, field, value) => {
    currentEvent[field] = value;
    writes.push({ field, value });
  };
  context.birdieCoinNow_ = () => "2026-08-14T11:00:00.000Z";
  context.birdieCoinAudit_ = (...args) => {
    if (!audits.some((audit) => audit[6] === args[6])) audits.push(args);
  };
  context.birdieCoinSheet_ = (name) => ({ name });
  context.birdieCoinFind_ = (sheet, field, value) => {
    if (sheet.name === "ACTION_CLAIMS" && field === "claimId") {
      return value === "CLAIM-1"
        ? { row: 2, object: structuredClone(options.claim || claim) }
        : null;
    }
    if (sheet.name === "COIN_TRANSACTIONS" && field === "idempotencyKey") {
      const found = transactions.find(
        (entry) => String(entry[field]) === String(value)
      );
      return found ? { row: 2, object: structuredClone(found) } : null;
    }
    return null;
  };
  context.birdieCoinObjects_ = (sheet) =>
    sheet.name === "COIN_TRANSACTIONS" ? structuredClone(transactions) : [];
  context.birdieCoinWriteObject_ = (...args) => claimWrites.push(args);
  context.birdieCoinAppendObject_ = (sheet, object) => {
    if (sheet.name !== "COIN_TRANSACTIONS") {
      throw new Error("UNEXPECTED_APPEND");
    }
    const appended = structuredClone(object);
    transactions.push(appended);
    transactionAppends.push(appended);
  };
  context.birdieCoinCreateClaim_ = (...args) => {
    claimCalls.push(args);
    return { success: true, data: { claimId: "CLAIM-PENDING" } };
  };

  return {
    context,
    currentEvent,
    writes,
    claimWrites,
    transactionAppends,
    audits,
    claimCalls: () => claimCalls,
    stats: () => ({ flushes, lockWaits, lockReleases })
  };
}

function claimCreationHarness({
  duplicate,
  eventStatus = "WRITTEN",
  ledgerValid = true
} = {}) {
  const appended = [];
  const audits = [];
  const context = {
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {}
        };
      }
    }
  };
  runInNewContext(`${coinSource}\n${socialSource}`, context);
  context.birdieCoinRequireProfile_ = () => ({
    birdieId: "BIRDIE-123",
    accountType: "PRIVATE",
    instagramHandle: "tanjastroop",
    status: "ACTIVE"
  });
  context.birdieSocialValidateInstagramCommentClaim_ = () =>
    event({ coinWriteStatus: eventStatus });
  context.birdieSocialRequireInstagramCommentLedgerProof_ = () => {
    if (!ledgerValid) throw new Error("IG_COMMENT_LEDGER_PROOF_MISSING");
    return { transactionId: "TX-1" };
  };
  context.birdieCoinSheet_ = (name) => ({ name });
  context.birdieCoinFind_ = (sheet, field, value) => {
    if (
      sheet.name === "ACTION_CLAIMS" &&
      field === "idempotencyKey" &&
      value === "claim:ig:ig_comment:tanjastroop:17930197359365940" &&
      duplicate
    ) {
      return { row: 2, object: structuredClone(duplicate) };
    }
    return null;
  };
  context.birdieCoinObjects_ = () => [];
  context.birdieCoinAppendObject_ = (_sheet, object) => appended.push(object);
  context.birdieCoinAudit_ = (...args) => audits.push(args);
  context.birdieCoinId_ = () => "CLAIM-NEW";
  context.birdieCoinNow_ = () => "2026-08-14T11:00:00.000Z";

  return {
    appended,
    audits,
    create(overrides = {}) {
      return context.birdieCoinCreateClaim_(
        {
          eventId: "SCE-20260814-0138-TANJA",
          workItemId: "WORK-IG-COMMENT-17930197359365940",
          birdieId: "BIRDIE-123",
          actionCode: "IG_COMMENT",
          sourceType: "INSTAGRAM",
          sourceReference: "17930197359365940",
          idempotencyKey:
            "claim:ig:ig_comment:tanjastroop:17930197359365940",
          confirmation: "CREATE_IG_COMMENT_CLAIM",
          ...overrides
        },
        "IG_COMMENT"
      );
    }
  };
}

test("Apps Script exposes only dedicated governed IG_COMMENT actions", () => {
  assert.match(
    coinSource,
    /IG_COMMENT:[\s\S]*accountTypes: \["PRIVATE"\][\s\S]*points: 1[\s\S]*MANUAL_APPROVAL[\s\S]*PER_DISTINCT_COMMENT/
  );
  for (const action of [
    "coinGetSocialEvent",
    "coinBindInstagramCommentIdentity",
    "coinCreateInstagramCommentClaim",
    "coinMarkInstagramCommentWritten"
  ]) {
    assert.match(coinSource, new RegExp(`case "${action}"`));
  }
  assert.match(coinSource, /DEDICATED_IG_COMMENT_ACTION_REQUIRED/);
  assert.match(socialSource, /"claim:" \+ String\(event\.idempotencyKey\)/);
  assert.match(socialSource, /String\(request\.actionCode\) !== "IG_COMMENT"/);
  assert.match(socialSource, /String\(request\.sourceType\) !== "INSTAGRAM"/);
  assert.match(socialSource, /Number\(event\.points\) !== 1/);
  assert.match(socialSource, /matchingTransactions\.length !== 1/);
  assert.match(socialSource, /IG_COMMENT_CATALOG_RULE_NOT_ACTIVE/);
  assert.match(socialSource, /IG_COMMENT_SOURCE_REFERENCE_NOT_TEXT/);
  assert.match(
    socialSource,
    /String\(workItem\.syncEventId\) !== String\(event\.eventId\)/
  );
  assert.match(coinSource, /BIRDIE_SOCIAL_CONFIRMATIONS_\.APPROVE_CLAIM/);
  assert.match(socialSource, /APPROVE_IG_COMMENT_CLAIM/);
  assert.match(
    socialSource,
    /INVALID_IG_COMMENT_APPROVAL_CONTEXT/
  );
});

test("large Instagram comment IDs must remain exact text", () => {
  const harness = contextFor(event());

  assert.doesNotThrow(() =>
    harness.context.birdieSocialValidateInstagramCommentEvent_(
      event({ sourceReference: "17930197359365940" }),
      { requireResolvedIdentity: true }
    )
  );
  assert.throws(
    () =>
      harness.context.birdieSocialValidateInstagramCommentEvent_(
        event({
          sourceReference: 17930197359365940,
          idempotencyKey:
            "ig:ig_comment:tanjastroop:17930197359365940"
        }),
        { requireResolvedIdentity: true }
      ),
    /IG_COMMENT_SOURCE_REFERENCE_NOT_TEXT/
  );
});

test("resolved and written events require complete state timestamps", () => {
  const harness = contextFor(event());

  assert.throws(
    () =>
      harness.context.birdieSocialValidateInstagramCommentEvent_(
        event({ verifiedAt: "" }),
        { requireResolvedIdentity: true }
      ),
    /IG_COMMENT_RESOLVED_IDENTITY_INCOMPLETE/
  );
  assert.throws(
    () =>
      harness.context.birdieSocialValidateInstagramCommentEvent_(
        event({ coinWriteStatus: "WRITTEN", processedAt: "" }),
        { requireResolvedIdentity: true, allowWritten: true }
      ),
    /IG_COMMENT_WRITTEN_STATE_INCOMPLETE/
  );
});

test("economic mutation requires the exact active V1 catalog rule", () => {
  const context = {};
  runInNewContext(`${coinSource}\n${socialSource}`, context);
  context.birdieSocialSheet_ = () => ({ kind: "catalog" });
  const activeRule = {
    actionCode: "IG_COMMENT",
    defaultCoins: 1,
    accountType: "PRIVATE",
    sourceTypes: "INSTAGRAM",
    approvalMode: "MANUAL_APPROVAL",
    frequencyRule: "PER_DISTINCT_COMMENT",
    status: "ACTIVE"
  };
  context.birdieSocialObjects_ = () => [structuredClone(activeRule)];

  assert.equal(
    context.birdieSocialRequireApprovedInstagramCommentRule_().actionCode,
    "IG_COMMENT"
  );

  context.birdieSocialObjects_ = () => [
    { ...structuredClone(activeRule), status: "DRAFT" }
  ];
  assert.throws(
    () => context.birdieSocialRequireApprovedInstagramCommentRule_(),
    /IG_COMMENT_CATALOG_RULE_NOT_ACTIVE/
  );

  context.birdieSocialObjects_ = () => [structuredClone(activeRule)];
  context.BIRDIE_COIN_ACTIONS_.IG_COMMENT.points = 2;
  assert.throws(
    () => context.birdieSocialRequireApprovedInstagramCommentRule_(),
    /IG_COMMENT_SOURCE_RULE_NOT_APPROVED/
  );
});

test("identity binding is owner-controlled, exact, and idempotent", () => {
  const harness = contextFor(
    event({
      birdieId: "",
      verificationStatus: "IDENTITY_PENDING",
      verifiedAt: ""
    })
  );

  const first = harness.context.birdieSocialBindInstagramCommentIdentity_({
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    confirmation: "BIND_IG_COMMENT_IDENTITY",
    source: "Birdie Agent"
  });
  const second = harness.context.birdieSocialBindInstagramCommentIdentity_({
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    confirmation: "BIND_IG_COMMENT_IDENTITY",
    source: "Birdie Agent"
  });

  assert.equal(first.data.idempotent, false);
  assert.equal(second.data.idempotent, true);
  assert.deepEqual(
    harness.writes.map(({ field }) => field),
    ["birdieId", "verifiedAt", "verificationStatus"]
  );
  assert.equal(harness.currentEvent.birdieId, "BIRDIE-123");
  assert.equal(harness.currentEvent.verificationStatus, "IDENTITY_RESOLVED");
  assert.equal(harness.audits.length, 1);
  assert.deepEqual(harness.stats(), {
    flushes: 1,
    lockWaits: 2,
    lockReleases: 2
  });
});

test("identity binding fails closed on a non-exact work item", () => {
  const harness = contextFor(
    event({
      birdieId: "",
      verificationStatus: "IDENTITY_PENDING"
    }),
    { workItem: workItem({ identityConfidence: 99 }) }
  );

  assert.throws(
    () =>
      harness.context.birdieSocialBindInstagramCommentIdentity_({
        eventId: "SCE-20260814-0138-TANJA",
        workItemId: "WORK-IG-COMMENT-17930197359365940",
        birdieId: "BIRDIE-123",
        confirmation: "BIND_IG_COMMENT_IDENTITY"
      }),
    /WORK_ITEM_NOT_EXACT_IG_COMMENT_IDENTITY/
  );
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("WRITTEN event cannot receive a late identity transition", () => {
  const harness = contextFor(
    event({
      birdieId: "",
      verificationStatus: "IDENTITY_PENDING",
      coinWriteStatus: "WRITTEN"
    })
  );

  assert.throws(
    () =>
      harness.context.birdieSocialBindInstagramCommentIdentity_({
        eventId: "SCE-20260814-0138-TANJA",
        workItemId: "WORK-IG-COMMENT-17930197359365940",
        birdieId: "BIRDIE-123",
        confirmation: "BIND_IG_COMMENT_IDENTITY"
      }),
    /WRITTEN_SOCIAL_EVENT_IDENTITY_MISMATCH/
  );
  assert.equal(harness.writes.length, 0);
});

test("claim action derives the immutable economic fields from the event", () => {
  const harness = contextFor(event());

  harness.context.birdieSocialCreateInstagramCommentClaim_({
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    confirmation: "CREATE_IG_COMMENT_CLAIM",
    actionCode: "STORY_SHARE_TAGGED",
    sourceType: "ADMIN",
    sourceReference: "caller-controlled",
    points: 999,
    idempotencyKey: "caller-controlled"
  });

  const [request, dedicatedAction] = harness.claimCalls()[0];
  assert.equal(dedicatedAction, "IG_COMMENT");
  assert.deepEqual(
    {
      eventId: request.eventId,
      workItemId: request.workItemId,
      birdieId: request.birdieId,
      actionCode: request.actionCode,
      sourceType: request.sourceType,
      sourceReference: request.sourceReference,
      idempotencyKey: request.idempotencyKey
    },
    {
      eventId: "SCE-20260814-0138-TANJA",
      workItemId: "WORK-IG-COMMENT-17930197359365940",
      birdieId: "BIRDIE-123",
      actionCode: "IG_COMMENT",
      sourceType: "INSTAGRAM",
      sourceReference: "17930197359365940",
      idempotencyKey:
        "claim:ig:ig_comment:tanjastroop:17930197359365940"
    }
  );
  assert.equal(request.points, undefined);
  assert.equal(request.amount, undefined);
});

test("completed claim rerun returns only the same exact claim", () => {
  const exactClaim = {
    claimId: "CLAIM-1",
    birdieId: "BIRDIE-123",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    approvedAmount: 1,
    idempotencyKey:
      "claim:ig:ig_comment:tanjastroop:17930197359365940"
  };
  const exact = claimCreationHarness({ duplicate: exactClaim });
  assert.equal(exact.create().data.claimId, "CLAIM-1");
  assert.equal(exact.appended.length, 0);
  assert.equal(exact.audits.length, 1);
  assert.equal(exact.audits[0][0], "CLAIM_CREATED");

  const collision = claimCreationHarness({
    duplicate: { ...exactClaim, sourceReference: "DIFFERENT" }
  });
  assert.throws(() => collision.create(), /CLAIM_IDEMPOTENCY_CONFLICT/);
  assert.equal(collision.appended.length, 0);

  const missing = claimCreationHarness();
  assert.throws(() => missing.create(), /IG_COMMENT_EVENT_ALREADY_WRITTEN/);
  assert.equal(missing.appended.length, 0);

  const pendingDuplicate = claimCreationHarness({
    duplicate: {
      ...exactClaim,
      status: "PENDING",
      approvedAmount: ""
    }
  });
  assert.throws(
    () => pendingDuplicate.create(),
    /WRITTEN_EVENT_REQUIRES_APPROVED_CLAIM/
  );

  const approvedWithoutLedger = claimCreationHarness({
    duplicate: exactClaim,
    ledgerValid: false
  });
  assert.throws(
    () => approvedWithoutLedger.create(),
    /IG_COMMENT_LEDGER_PROOF_MISSING/
  );

  const callerAmount = claimCreationHarness({ duplicate: exactClaim });
  assert.throws(
    () => callerAmount.create({ approvedAmount: 1 }),
    /CLIENT_AMOUNT_FORBIDDEN/
  );
});

test("approved claim rerun validates confirmation, context, and ledger first", () => {
  const request = {
    claimId: "CLAIM-1",
    decision: "APPROVE",
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    confirmation: "APPROVE_IG_COMMENT_CLAIM",
    idempotencyKey: "decision:CLAIM-1:approve"
  };
  const valid = contextFor(event({ coinWriteStatus: "WRITTEN" }));
  assert.equal(
    valid.context.birdieCoinDecideClaim_(request).data.claimId,
    "CLAIM-1"
  );
  assert.equal(valid.writes.length, 0);
  assert.equal(valid.audits.length, 1);
  assert.equal(valid.audits[0][0], "CLAIM_APPROVED");

  const wrongConfirmation = contextFor(
    event({ coinWriteStatus: "WRITTEN" })
  );
  assert.throws(
    () =>
      wrongConfirmation.context.birdieCoinDecideClaim_({
        ...request,
        confirmation: "GO"
      }),
    /INVALID_CONFIRMATION/
  );

  const missingLedger = contextFor(
    event({ coinWriteStatus: "WRITTEN" }),
    { transactions: [] }
  );
  assert.throws(
    () => missingLedger.context.birdieCoinDecideClaim_(request),
    /IG_COMMENT_LEDGER_PROOF_MISSING/
  );

  const pendingAfterWritten = contextFor(
    event({ coinWriteStatus: "WRITTEN" }),
    {
      claim: {
        claimId: "CLAIM-1",
        birdieId: "BIRDIE-123",
        actionCode: "IG_COMMENT",
        sourceType: "INSTAGRAM",
        sourceReference: "17930197359365940",
        status: "PENDING",
        approvedAmount: "",
        idempotencyKey:
          "claim:ig:ig_comment:tanjastroop:17930197359365940"
      }
    }
  );
  assert.throws(
    () => pendingAfterWritten.context.birdieCoinDecideClaim_(request),
    /WRITTEN_EVENT_REQUIRES_APPROVED_CLAIM/
  );
});

test("pending approval rejects ledger collisions and repairs a prior exact append", () => {
  const pendingClaim = {
    claimId: "CLAIM-1",
    birdieId: "BIRDIE-123",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "PENDING",
    approvedAmount: "",
    idempotencyKey:
      "claim:ig:ig_comment:tanjastroop:17930197359365940"
  };
  const request = {
    claimId: "CLAIM-1",
    decision: "APPROVE",
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    confirmation: "APPROVE_IG_COMMENT_CLAIM",
    idempotencyKey: "decision:CLAIM-1:approve"
  };
  const wrongLedger = contextFor(event(), {
    claim: pendingClaim,
    transactions: [
      {
        transactionId: "TX-WRONG",
        approvedAt: "2026-08-14T10:40:00.000Z",
        birdieId: "BIRDIE-123",
        amount: 2,
        transactionType: "EARN",
        actionCode: "IG_COMMENT",
        sourceType: "INSTAGRAM",
        sourceReference: "17930197359365940",
        status: "APPROVED",
        idempotencyKey: "claim:CLAIM-1"
      }
    ]
  });
  assert.throws(
    () => wrongLedger.context.birdieCoinDecideClaim_(request),
    /IG_COMMENT_LEDGER_SOURCE_CONFLICT/
  );
  assert.equal(wrongLedger.transactionAppends.length, 0);
  assert.equal(wrongLedger.claimWrites.length, 0);

  const foreignKeySameSource = contextFor(event(), {
    claim: pendingClaim,
    transactions: [
      {
        transactionId: "TX-FOREIGN",
        approvedAt: "2026-08-14T10:39:00.000Z",
        birdieId: "BIRDIE-123",
        amount: 1,
        transactionType: "EARN",
        actionCode: "IG_COMMENT",
        sourceType: "INSTAGRAM",
        sourceReference: "17930197359365940",
        status: "APPROVED",
        idempotencyKey: "claim:CLAIM-FOREIGN"
      }
    ]
  });
  assert.throws(
    () => foreignKeySameSource.context.birdieCoinDecideClaim_(request),
    /IG_COMMENT_LEDGER_SOURCE_CONFLICT/
  );
  assert.equal(foreignKeySameSource.transactionAppends.length, 0);
  assert.equal(foreignKeySameSource.claimWrites.length, 0);

  const exactLedger = contextFor(event(), { claim: pendingClaim });
  const repaired = exactLedger.context.birdieCoinDecideClaim_(request);
  assert.equal(repaired.data.claim.status, "APPROVED");
  assert.equal(exactLedger.claimWrites.length, 1);

  const rejectAfterAppend = contextFor(event(), { claim: pendingClaim });
  assert.throws(
    () =>
      rejectAfterAppend.context.birdieCoinDecideClaim_({
        claimId: "CLAIM-1",
        decision: "REJECT",
        idempotencyKey: "decision:CLAIM-1:reject"
      }),
    /IG_COMMENT_REQUIRES_APPROVAL_REPAIR/
  );
  assert.equal(rejectAfterAppend.claimWrites.length, 0);
});

test("WRITTEN happens only after one exact approved ledger proof and retries safely", () => {
  const harness = contextFor(event());
  const request = {
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    claimId: "CLAIM-1",
    confirmation: "MARK_IG_COMMENT_WRITTEN",
    source: "Birdie Agent"
  };

  const first = harness.context.birdieSocialMarkInstagramCommentWritten_(request);
  const second = harness.context.birdieSocialMarkInstagramCommentWritten_(request);

  assert.equal(first.data.idempotent, false);
  assert.equal(second.data.idempotent, true);
  assert.deepEqual(
    harness.writes.map(({ field }) => field),
    ["processedAt", "coinWriteStatus"]
  );
  assert.equal(harness.currentEvent.coinWriteStatus, "WRITTEN");
  assert.equal(first.data.transaction.transactionId, "TX-1");
  assert.equal(harness.audits.length, 1);
  assert.deepEqual(harness.stats(), {
    flushes: 1,
    lockWaits: 2,
    lockReleases: 2
  });
});

test("WRITTEN rejects a missing, mismatched, or duplicate ledger proof", () => {
  const valid = {
    transactionId: "TX-1",
    approvedAt: "2026-08-14T10:40:00.000Z",
    birdieId: "BIRDIE-123",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    idempotencyKey: "claim:CLAIM-1"
  };
  const request = {
    eventId: "SCE-20260814-0138-TANJA",
    workItemId: "WORK-IG-COMMENT-17930197359365940",
    birdieId: "BIRDIE-123",
    claimId: "CLAIM-1",
    confirmation: "MARK_IG_COMMENT_WRITTEN"
  };

  const missing = contextFor(event(), { transactions: [] });
  assert.throws(
    () => missing.context.birdieSocialMarkInstagramCommentWritten_(request),
    /IG_COMMENT_LEDGER_PROOF_MISSING/
  );
  assert.equal(missing.writes.length, 0);

  const mismatch = contextFor(event(), {
    transactions: [{ ...valid, amount: 2 }]
  });
  assert.throws(
    () => mismatch.context.birdieSocialMarkInstagramCommentWritten_(request),
    /IG_COMMENT_LEDGER_PROOF_MISMATCH/
  );
  assert.equal(mismatch.writes.length, 0);

  const incompleteApproval = contextFor(event(), {
    transactions: [{ ...valid, approvedAt: "" }]
  });
  assert.throws(
    () =>
      incompleteApproval.context.birdieSocialMarkInstagramCommentWritten_(
        request
      ),
    /IG_COMMENT_LEDGER_PROOF_MISMATCH/
  );
  assert.equal(incompleteApproval.writes.length, 0);

  const duplicate = contextFor(event(), {
    transactions: [
      valid,
      {
        ...valid,
        transactionId: "TX-2",
        idempotencyKey: "claim:CLAIM-OTHER"
      }
    ]
  });
  assert.throws(
    () => duplicate.context.birdieSocialMarkInstagramCommentWritten_(request),
    /IG_COMMENT_LEDGER_PROOF_NOT_UNIQUE/
  );
  assert.equal(duplicate.writes.length, 0);
});
