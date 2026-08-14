import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../birdie-os/community-meta.gs", import.meta.url),
  "utf8"
);

const SYNC_HEADERS = [
  "syncEventId", "sourceType", "sourceAccount", "sourceReference",
  "externalUserId", "birdieId", "eventType", "actionCode",
  "payloadSummary", "detectedAt", "syncStatus", "claimId",
  "processedAt", "processedBy", "idempotencyKey", "notes"
];
const WORK_HEADERS = [
  "workItemId", "syncEventId", "sourceType", "externalUserId", "eventType",
  "actionCode", "sourceReference", "payloadSummary", "detectedAt",
  "resolutionStatus", "matchedBirdieId", "decision", "agentNotes",
  "processedBy", "processedAt", "sourceSnapshotKey", "identityConfidence",
  "identityReason", "identityConflict", "identityDecisionMode"
];
const SOCIAL_HEADERS = [
  "eventId", "platform", "eventType", "instagramHandle", "birdieId", "points",
  "sourceReference", "verificationStatus", "coinWriteStatus", "createdAt",
  "verifiedAt", "processedAt", "idempotencyKey", "note"
];

const COMMENT_ID = "17930197359365940";

function commentEvent(overrides = {}) {
  return {
    syncEventId: `SCE-IG-COMMENT-${COMMENT_ID}`,
    workItemId: `WORK-IG-COMMENT-${COMMENT_ID}`,
    sourceSnapshotKey: `SSK-IG-COMMENT-${COMMENT_ID}`,
    sourceType: "INSTAGRAM",
    sourceAccount: "birdieandbreakfast",
    sourceReference: COMMENT_ID,
    externalUserId: "birdie.fan",
    eventType: "IG_COMMENT",
    actionCode: "IG_COMMENT",
    payloadSummary:
      `commentId=${COMMENT_ID} | scopedId=17841400123456789 | username=birdie.fan | mediaId=17900000000000000 | text=BIRDIE`,
    detectedAt: "2026-08-12T04:00:00.000Z",
    syncStatus: "PENDING",
    idempotencyKey: `ig:ig_comment:birdie.fan:${COMMENT_ID}`,
    notes:
      "Signed Meta comment webhook ingested. Identity and Coin writes remain pending governed processing.",
    ...overrides
  };
}

function makeSheet(headers, initialRows = []) {
  const rows = structuredClone(initialRows);
  return {
    rows,
    getLastRow() {
      return rows.length + 1;
    },
    getRange(startRow, startColumn, rowCount, columnCount) {
      return {
        getValues() {
          if (startRow === 1) {
            return [headers.slice(startColumn - 1, startColumn - 1 + columnCount)];
          }
          return rows
            .slice(startRow - 2, startRow - 2 + rowCount)
            .map((row) => row.slice(startColumn - 1, startColumn - 1 + columnCount));
        }
      };
    },
    appendRow(row) {
      rows.push(structuredClone(row));
    }
  };
}

function contextFor(initial = {}) {
  const sheets = {
    "COMMUNITY SYNC QUEUE": makeSheet(SYNC_HEADERS, initial.sync),
    "COMMUNITY WORK QUEUE": makeSheet(WORK_HEADERS, initial.work),
    SOCIAL_COIN_EVENTS: makeSheet(SOCIAL_HEADERS, initial.social)
  };
  let lockWaits = 0;
  let lockReleases = 0;
  let flushes = 0;
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
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: () => "" };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheetByName(name) {
            return sheets[name] ?? null;
          }
        };
      },
      openById() {
        throw new Error("unexpected openById");
      },
      flush() {
        flushes += 1;
      }
    }
  };
  runInNewContext(source, context);
  return {
    context,
    sheets,
    stats: () => ({ lockWaits, lockReleases, flushes })
  };
}

function objectAt(sheet, headers, index = 0) {
  return Object.fromEntries(headers.map((header, column) => [header, sheet.rows[index][column]]));
}

function appendComment(context, event = commentEvent()) {
  return context.handleMetaCommunityAction_({
    action: "appendCommunitySyncEvent",
    event
  });
}

test("comment append derives +1 and reads back exactly one row in all three sheets", () => {
  const harness = contextFor();
  const result = appendComment(harness.context);

  assert.equal(result.success, true);
  assert.equal(result.data.syncEventId, `SCE-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(result.data.workItemId, `WORK-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(result.data.socialEventId, result.data.syncEventId);
  assert.equal(result.data.idempotent, false);
  assert.equal(result.data.repaired, false);
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 1);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 1);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 1);

  const sync = objectAt(harness.sheets["COMMUNITY SYNC QUEUE"], SYNC_HEADERS);
  const work = objectAt(harness.sheets["COMMUNITY WORK QUEUE"], WORK_HEADERS);
  const social = objectAt(harness.sheets.SOCIAL_COIN_EVENTS, SOCIAL_HEADERS);
  assert.equal(sync.syncEventId, result.data.syncEventId);
  assert.equal(sync.birdieId, "");
  assert.equal(sync.claimId, "");
  assert.equal(work.workItemId, result.data.workItemId);
  assert.equal(work.resolutionStatus, "IDENTITY_PENDING");
  assert.equal(work.matchedBirdieId, "");
  assert.equal(work.sourceSnapshotKey, `SSK-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(social.eventId, result.data.socialEventId);
  assert.equal(social.points, 1);
  assert.equal(social.birdieId, "");
  assert.equal(social.verificationStatus, "IDENTITY_PENDING");
  assert.equal(social.coinWriteStatus, "NOT_WRITTEN");
  assert.equal(social.idempotencyKey, `ig:ig_comment:birdie.fan:${COMMENT_ID}`);
  assert.deepEqual(harness.stats(), { lockWaits: 1, lockReleases: 1, flushes: 1 });
});

test("exact replay returns the same IDs without appending any row", () => {
  const harness = contextFor();
  const first = appendComment(harness.context);
  const second = appendComment(harness.context);

  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.repaired, false);
  assert.equal(second.data.syncEventId, first.data.syncEventId);
  assert.equal(second.data.workItemId, first.data.workItemId);
  assert.equal(second.data.socialEventId, first.data.socialEventId);
  assert.deepEqual(Array.from(second.data.createdSheets), []);
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 1);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 1);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 1);
});

test("replay after governed identity and ledger progression stays idempotent", () => {
  const harness = contextFor();
  const first = appendComment(harness.context);
  const syncRow = harness.sheets["COMMUNITY SYNC QUEUE"].rows[0];
  const workRow = harness.sheets["COMMUNITY WORK QUEUE"].rows[0];
  const socialRow = harness.sheets.SOCIAL_COIN_EVENTS.rows[0];

  syncRow[SYNC_HEADERS.indexOf("birdieId")] = "BIRDIE-123";
  syncRow[SYNC_HEADERS.indexOf("syncStatus")] = "PROCESSED";
  syncRow[SYNC_HEADERS.indexOf("claimId")] = "CLAIM-123";
  workRow[WORK_HEADERS.indexOf("resolutionStatus")] = "IDENTITY_RESOLVED";
  workRow[WORK_HEADERS.indexOf("matchedBirdieId")] = "BIRDIE-123";
  workRow[WORK_HEADERS.indexOf("decision")] = "EXACT_IDENTITY_LINK";
  workRow[WORK_HEADERS.indexOf("identityConfidence")] = 100;
  workRow[WORK_HEADERS.indexOf("identityDecisionMode")] = "AUTO_EXACT_LINK";
  socialRow[SOCIAL_HEADERS.indexOf("birdieId")] = "BIRDIE-123";
  socialRow[SOCIAL_HEADERS.indexOf("verificationStatus")] = "IDENTITY_RESOLVED";
  socialRow[SOCIAL_HEADERS.indexOf("coinWriteStatus")] = "WRITTEN";
  socialRow[SOCIAL_HEADERS.indexOf("verifiedAt")] = "2026-08-12T05:00:00.000Z";
  socialRow[SOCIAL_HEADERS.indexOf("processedAt")] = "2026-08-12T06:00:00.000Z";

  const replay = appendComment(harness.context);

  assert.equal(replay.data.idempotent, true);
  assert.equal(replay.data.syncEventId, first.data.syncEventId);
  assert.equal(replay.data.workItemId, first.data.workItemId);
  assert.equal(replay.data.readback.socialCoinEvent.coinWriteStatus, "WRITTEN");
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 1);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 1);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 1);
});

test("partial exact state is repaired without duplicating the existing row", () => {
  const seed = contextFor();
  appendComment(seed.context);
  const exactSync = structuredClone(seed.sheets["COMMUNITY SYNC QUEUE"].rows[0]);
  const harness = contextFor({ sync: [exactSync] });

  const result = appendComment(harness.context);

  assert.equal(result.data.idempotent, false);
  assert.equal(result.data.repaired, true);
  assert.deepEqual(
    Array.from(result.data.createdSheets),
    ["COMMUNITY WORK QUEUE", "SOCIAL_COIN_EVENTS"]
  );
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 1);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 1);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 1);
  assert.equal(result.data.readback.communityWork.workItemId, `WORK-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(result.data.readback.socialCoinEvent.points, 1);
});

test("duplicate exact source rows fail closed before missing rows are appended", () => {
  const seed = contextFor();
  appendComment(seed.context);
  const exactSync = structuredClone(seed.sheets["COMMUNITY SYNC QUEUE"].rows[0]);
  const harness = contextFor({ sync: [exactSync, exactSync] });

  assert.throws(
    () => appendComment(harness.context),
    /META_COMMUNITY_SYNC_DUPLICATE/
  );
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 0);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 0);
  assert.deepEqual(harness.stats(), { lockWaits: 1, lockReleases: 1, flushes: 0 });
});

test("a sourceReference replay with mismatching identity fails closed", () => {
  const seed = contextFor();
  appendComment(seed.context);
  const mismatchingSync = structuredClone(seed.sheets["COMMUNITY SYNC QUEUE"].rows[0]);
  mismatchingSync[SYNC_HEADERS.indexOf("externalUserId")] = "different.handle";
  const harness = contextFor({ sync: [mismatchingSync] });

  assert.throws(
    () => appendComment(harness.context),
    /META_COMMUNITY_SYNC_MISMATCH/
  );
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 0);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 0);
});

test("caller-supplied Birdie identity or points are rejected before acquiring the lock", () => {
  for (const override of [{ birdieId: "BIRDIE-FORGED" }, { points: 99 }]) {
    const harness = contextFor();
    assert.throws(
      () => appendComment(harness.context, commentEvent(override)),
      /CALLER_AUTHORITY_FORBIDDEN/
    );
    assert.deepEqual(harness.stats(), { lockWaits: 0, lockReleases: 0, flushes: 0 });
  }
});

test("non-numeric comment sourceReference is rejected with no writes", () => {
  const harness = contextFor();
  assert.throws(
    () => appendComment(harness.context, commentEvent({ sourceReference: "comment-123" })),
    /META_COMMENT_SOURCE_REFERENCE_INVALID/
  );
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 0);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 0);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 0);
});

test("DM append is queue-only and never touches work or social Coin sheets", () => {
  const harness = contextFor();
  const event = {
    syncEventId: "SCE-IG-DM-m_1.abc",
    sourceType: "INSTAGRAM",
    sourceAccount: "birdieandbreakfast",
    sourceReference: "m_1.abc",
    externalUserId: "17841400000000001",
    eventType: "DM_RECEIVED",
    actionCode: "INSTAGRAM_DM",
    payloadSummary: "messageId=m_1.abc | senderScopedId=17841400000000001 | text=Hi",
    detectedAt: "2026-08-12T04:00:00.000Z",
    syncStatus: "PENDING",
    idempotencyKey: "ig:dm:17841400000000001:m_1.abc",
    notes: "Signed Meta DM webhook ingested queue-only; no Coin event is created."
  };

  const first = harness.context.handleMetaCommunityAction_({
    action: "appendCommunitySyncEvent",
    event
  });
  const replay = harness.context.handleMetaCommunityAction_({
    action: "appendCommunitySyncEvent",
    event
  });

  assert.equal(first.data.queueOnly, true);
  assert.equal(first.data.idempotent, false);
  assert.equal(replay.data.idempotent, true);
  assert.equal(harness.sheets["COMMUNITY SYNC QUEUE"].rows.length, 1);
  assert.equal(harness.sheets["COMMUNITY WORK QUEUE"].rows.length, 0);
  assert.equal(harness.sheets.SOCIAL_COIN_EVENTS.rows.length, 0);
});
