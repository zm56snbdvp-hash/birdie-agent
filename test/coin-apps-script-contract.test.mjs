import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../birdie-os/coin-system.gs", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

const profileHeaders = [
  "birdieId",
  "displayName",
  "email",
  "accountType",
  "instagramHandle",
  "publicWall",
  "status",
  "profileOrigin",
  "joinedAt",
  "createdAt",
  "updatedAt",
  "idempotencyKey"
];

function profile(overrides = {}) {
  return {
    birdieId: "BIRDIE-123",
    displayName: "Kevin",
    email: "kevin@example.com",
    accountType: "PRIVATE",
    instagramHandle: "",
    publicWall: true,
    status: "ACTIVE",
    profileOrigin: "ORGANIC",
    joinedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    idempotencyKey: "profile:BIRDIE-123",
    ...overrides
  };
}

function appsScriptHarness(
  initialProfiles,
  {
    afterFlush,
    auditFailures = 0,
    failCellFieldOnce,
    initialAudits = []
  } = {}
) {
  const profiles = structuredClone(initialProfiles);
  const auditRows = structuredClone(initialAudits);
  const cellWrites = [];
  const audits = [];
  let transactionWrites = 0;
  let auditAttempts = 0;
  let flushes = 0;
  let lockWaits = 0;
  let lockReleases = 0;
  let pendingCellFailure = failCellFieldOnce;
  const auditSheet = {};

  const profileSheet = {
    getLastColumn() {
      return profileHeaders.length;
    },
    getRange(rowNumber, columnNumber, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          if (rowNumber !== 1 || rowCount !== 1) {
            throw new Error("Unexpected harness read range");
          }
          return [profileHeaders.slice(columnNumber - 1, columnNumber - 1 + columnCount)];
        },
        setValue(value) {
          assert.equal(rowCount, 1);
          assert.equal(columnCount, 1);
          const field = profileHeaders[columnNumber - 1];
          if (pendingCellFailure === field) {
            pendingCellFailure = undefined;
            throw new Error(`PROFILE_FIELD_WRITE_FAILED:${field}`);
          }
          profiles[rowNumber - 2][field] = value;
          cellWrites.push({ rowNumber, field, value });
        }
      };
    }
  };

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
        afterFlush?.(profiles);
      }
    }
  };

  runInNewContext(source, context);
  context.birdieCoinSheet_ = (name) =>
    name === "AUDIT_EVENTS" ? auditSheet : profileSheet;
  context.birdieCoinFind_ = (requestedSheet, field, value) => {
    assert.equal(requestedSheet, profileSheet);
    const index = profiles.findIndex((entry) => String(entry[field]) === String(value));
    return index === -1
      ? null
      : { row: index + 2, object: structuredClone(profiles[index]) };
  };
  context.birdieCoinObjects_ = (requestedSheet) =>
    structuredClone(requestedSheet === auditSheet ? auditRows : profiles);
  context.birdieCoinNow_ = () => "2026-08-14T05:00:00.000Z";
  context.birdieCoinProfileView_ = (entry) => structuredClone(entry);
  context.birdieCoinAudit_ = (...args) => {
    auditAttempts += 1;
    if (auditAttempts <= auditFailures) throw new Error("AUDIT_WRITE_FAILED");
    const idempotencyKey = args[5];
    if (!audits.some((event) => event[5] === idempotencyKey)) audits.push(args);
  };
  context.birdieCoinAppendTransaction_ = () => {
    transactionWrites += 1;
  };

  return {
    profiles,
    cellWrites,
    audits,
    link(request = {}) {
      return context.birdieCoinLinkInstagramHandle_({
        birdieId: "BIRDIE-123",
        instagramHandle: " @Foo.Bar ",
        idempotencyKey: "profile-instagram:BIRDIE-123:foo.bar",
        source: "Birdie Agent",
        ...request
      });
    },
    stats() {
      return {
        transactionWrites,
        auditAttempts,
        flushes,
        lockWaits,
        lockReleases
      };
    }
  };
}

function audit(overrides = {}) {
  return {
    auditId: "AUDIT-1",
    eventType: "INSTAGRAM_HANDLE_LINKED",
    entityType: "PROFILE",
    entityId: "BIRDIE-123",
    actor: "Birdie Agent",
    createdAt: "2026-08-14T05:00:00.000Z",
    detailsJson: JSON.stringify({ instagramHandle: "foo.bar" }),
    idempotencyKey: "profile-instagram:BIRDIE-123:foo.bar",
    ...overrides
  };
}

function auditHarness(initialAudits = []) {
  const rows = structuredClone(initialAudits);
  let appends = 0;
  let flushes = 0;
  const sheet = {};
  const context = {
    SpreadsheetApp: {
      flush() {
        flushes += 1;
      }
    }
  };

  runInNewContext(source, context);
  context.birdieCoinSheet_ = () => sheet;
  context.birdieCoinObjects_ = (requestedSheet) => {
    assert.equal(requestedSheet, sheet);
    return structuredClone(rows);
  };
  context.birdieCoinAppendObject_ = (requestedSheet, row) => {
    assert.equal(requestedSheet, sheet);
    rows.push(structuredClone(row));
    appends += 1;
  };
  context.birdieCoinId_ = () => "AUDIT-NEW";
  context.birdieCoinNow_ = () => "2026-08-14T05:00:00.000Z";

  return {
    rows,
    appends() {
      return appends;
    },
    flushes() {
      return flushes;
    },
    write(overrides = {}) {
      return context.birdieCoinAudit_(
        overrides.eventType ?? "INSTAGRAM_HANDLE_LINKED",
        overrides.entityType ?? "PROFILE",
        overrides.entityId ?? "BIRDIE-123",
        overrides.actor ?? "Birdie Agent",
        overrides.details ?? { instagramHandle: "foo.bar" },
        overrides.idempotencyKey ??
          "profile-instagram:BIRDIE-123:foo.bar"
      );
    }
  };
}

function instagramClaim(overrides = {}) {
  return {
    claimId: "CLAIM-1",
    birdieId: "BIRDIE-123",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    evidenceUrl: "https://evidence.invalid/comment/17930197359365940",
    note: "Canonical Instagram comment",
    status: "PENDING",
    approvedAmount: "",
    submittedAt: "2026-08-14T05:00:00.000Z",
    decidedAt: "",
    decidedBy: "",
    decisionReason: "",
    idempotencyKey:
      "claim:ig:ig_comment:second.shot.kev:17930197359365940",
    ...overrides
  };
}

function assertInstagramClaimSource(claims, expectedClaimId = "") {
  const context = {};
  runInNewContext(source, context);
  context.birdieCoinObjects_ = () => structuredClone(claims);
  return context.birdieCoinRequireUniqueInstagramCommentClaimSource_(
    {},
    "17930197359365940",
    expectedClaimId
  );
}

function claimCreatedAuditDetails(claim) {
  const context = {};
  runInNewContext(source, context);
  return structuredClone(context.birdieCoinClaimCreatedAuditDetails_(claim));
}

test("Apps Script routes the narrow Instagram profile action", () => {
  assert.match(
    source,
    /case "coinLinkInstagramHandle": return birdieCoinLinkInstagramHandle_\(request\);/
  );
});

test("Apps Script Instagram link contract is guarded and economically inert", () => {
  const implementation = functionSource(
    "birdieCoinLinkInstagramHandle_",
    "birdieCoinGetLedger_"
  );

  assert.match(implementation, /LockService\.getScriptLock\(\)/);
  assert.match(implementation, /String\(target\.object\.status\) !== "ACTIVE"/);
  assert.match(implementation, /String\(profile\.status\) !== "ACTIVE"/);
  assert.match(implementation, /INSTAGRAM_HANDLE_ALREADY_LINKED/);
  assert.match(implementation, /INSTAGRAM_HANDLE_CHANGE_REQUIRES_REVIEW/);
  assert.match(implementation, /idempotent: true/);
  assert.match(implementation, /SpreadsheetApp\.flush\(\)/);
  assert.match(implementation, /INSTAGRAM_HANDLE_READBACK_MISMATCH/);
  assert.match(implementation, /"INSTAGRAM_HANDLE_LINKED"/);
  assert.match(implementation, /birdieCoinWriteInstagramHandle_/);
  assert.doesNotMatch(implementation, /birdieCoinWriteObject_/);
  assert.doesNotMatch(implementation, /birdieCoinAppendTransaction_/);
  assert.doesNotMatch(implementation, /birdieCoinCreateClaim_/);

  const audit = functionSource("birdieCoinAudit_", "birdieCoinSpreadsheet_");
  assert.match(audit, /birdieCoinPreflightAudit_/);
});

test("Apps Script audit retries require one exact matching payload", () => {
  const exact = auditHarness([audit()]);
  const returned = exact.write();
  assert.equal(returned.auditId, "AUDIT-1");
  assert.equal(exact.appends(), 0);
  assert.equal(exact.flushes(), 0);

  for (const collision of [
    { eventType: "PROFILE_CREATED" },
    { entityType: "CLAIM" },
    { entityId: "BIRDIE-OTHER" },
    { actor: "Different Actor" },
    { details: { instagramHandle: "different.handle" } }
  ]) {
    const harness = auditHarness([audit()]);
    assert.throws(
      () => harness.write(collision),
      /AUDIT_IDEMPOTENCY_CONFLICT/
    );
    assert.equal(harness.appends(), 0);
  }
});

test("Apps Script audit duplicate keys fail closed and new writes read back", () => {
  const duplicate = auditHarness([
    audit({ auditId: "AUDIT-1" }),
    audit({ auditId: "AUDIT-2" })
  ]);
  assert.throws(
    () => duplicate.write(),
    /AUDIT_IDEMPOTENCY_CONFLICT/
  );
  assert.equal(duplicate.appends(), 0);

  const fresh = auditHarness();
  const returned = fresh.write();
  assert.equal(returned.auditId, "AUDIT-NEW");
  assert.equal(returned.detailsJson, JSON.stringify({ instagramHandle: "foo.bar" }));
  assert.equal(fresh.rows.length, 1);
  assert.equal(fresh.appends(), 1);
  assert.equal(fresh.flushes(), 1);
});

test("CLAIM_CREATED audit payload stays canonical after claim approval", () => {
  const pending = instagramClaim();
  const approved = instagramClaim({
    status: "APPROVED",
    approvedAmount: 1,
    decidedAt: "2026-08-14T05:10:00.000Z",
    decidedBy: "Birdie Agent",
    decisionReason: "Founder-approved controlled E2E"
  });
  const pendingDetails = claimCreatedAuditDetails(pending);
  const approvedRetryDetails = claimCreatedAuditDetails(approved);

  assert.deepEqual(approvedRetryDetails, pendingDetails);
  assert.equal(pendingDetails.creationStatus, "PENDING");
  assert.equal(Object.hasOwn(pendingDetails, "approvedAmount"), false);
  assert.equal(Object.hasOwn(pendingDetails, "decidedAt"), false);

  const harness = auditHarness();
  const idempotencyKey = pending.idempotencyKey;
  const first = harness.write({
    eventType: "CLAIM_CREATED",
    entityType: "CLAIM",
    entityId: pending.claimId,
    details: pendingDetails,
    idempotencyKey
  });
  const retry = harness.write({
    eventType: "CLAIM_CREATED",
    entityType: "CLAIM",
    entityId: approved.claimId,
    details: approvedRetryDetails,
    idempotencyKey
  });

  assert.equal(first.auditId, "AUDIT-NEW");
  assert.equal(retry.auditId, "AUDIT-NEW");
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.appends(), 1);
});

test("Apps Script IG_COMMENT claim source uniqueness is global and status-agnostic", () => {
  assert.equal(assertInstagramClaimSource([], ""), null);
  assert.equal(
    assertInstagramClaimSource([instagramClaim()], "CLAIM-1").claimId,
    "CLAIM-1"
  );

  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    assert.throws(
      () => assertInstagramClaimSource([
        instagramClaim({
          claimId: `CLAIM-FOREIGN-${status}`,
          birdieId: "BIRDIE-OTHER",
          status
        })
      ]),
      /IG_COMMENT_CLAIM_SOURCE_CONFLICT/
    );
  }

  assert.throws(
    () => assertInstagramClaimSource([
      instagramClaim(),
      instagramClaim({
        claimId: "CLAIM-2",
        birdieId: "BIRDIE-OTHER",
        status: "REJECTED"
      })
    ], "CLAIM-1"),
    /IG_COMMENT_CLAIM_SOURCE_CONFLICT/
  );
});

test("Apps Script checks global IG_COMMENT claim uniqueness on creation and approval", () => {
  const createClaim = functionSource(
    "birdieCoinCreateClaim_",
    "birdieCoinDecideClaim_"
  );
  const decideClaim = functionSource(
    "birdieCoinDecideClaim_",
    "birdieCoinListRewards_"
  );
  assert.ok(
    [...createClaim.matchAll(/birdieCoinRequireUniqueInstagramCommentClaimSource_/g)]
      .length >= 3
  );
  assert.match(decideClaim, /birdieCoinRequireUniqueInstagramCommentClaimSource_/);
});

test("Apps Script enforces the canonical Instagram syntax", () => {
  const normalization = functionSource(
    "birdieCoinNormalizeInstagramHandle_",
    "birdieCoinPositiveInteger_"
  );

  assert.match(normalization, /\.toLowerCase\(\)/);
  assert.match(normalization, /\.replace\(\/\^@\//);
  assert.match(normalization, /\^\[a-z0-9\._\]\{1,30\}\$/);
  assert.match(normalization, /INVALID_INSTAGRAM_HANDLE/);
});

test("Apps Script links a blank handle and preserves every unrelated profile field", () => {
  const original = profile();
  const harness = appsScriptHarness([original]);

  const result = harness.link();

  assert.equal(result.success, true);
  assert.equal(result.data.idempotent, false);
  assert.equal(result.data.profile.instagramHandle, "foo.bar");
  assert.deepEqual(
    harness.cellWrites.map(({ field }) => field),
    ["updatedAt", "instagramHandle"]
  );
  for (const field of profileHeaders) {
    if (field === "instagramHandle" || field === "updatedAt") continue;
    assert.equal(harness.profiles[0][field], original[field], field);
  }
  assert.deepEqual(harness.audits[0].slice(0, 4), [
    "INSTAGRAM_HANDLE_LINKED",
    "PROFILE",
    "BIRDIE-123",
    "Birdie Agent"
  ]);
  assert.deepEqual(harness.stats(), {
    transactionWrites: 0,
    auditAttempts: 1,
    flushes: 1,
    lockWaits: 1,
    lockReleases: 1
  });
});

test("Apps Script same-handle retry is idempotent and creates no duplicate write", () => {
  const harness = appsScriptHarness([profile()]);

  const first = harness.link();
  const second = harness.link();

  assert.equal(first.data.idempotent, false);
  assert.equal(second.data.idempotent, true);
  assert.equal(harness.cellWrites.length, 2);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.stats().auditAttempts, 2);
  assert.equal(harness.stats().transactionWrites, 0);
});

test("Apps Script retry repairs a missing audit without rewriting the profile", () => {
  const harness = appsScriptHarness([profile()], { auditFailures: 1 });

  assert.throws(() => harness.link(), /AUDIT_WRITE_FAILED/);
  assert.equal(harness.profiles[0].instagramHandle, "foo.bar");
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.stats().lockReleases, 1);

  const retry = harness.link();
  assert.equal(retry.data.idempotent, true);
  assert.equal(harness.cellWrites.length, 2);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.stats().auditAttempts, 2);
  assert.equal(harness.stats().transactionWrites, 0);
});

test("Apps Script preflights the Instagram-link audit before profile writes", () => {
  const wrongPayload = appsScriptHarness([profile()], {
    initialAudits: [audit({ actor: "Different Actor" })]
  });
  assert.throws(
    () => wrongPayload.link(),
    /AUDIT_IDEMPOTENCY_CONFLICT/
  );
  assert.equal(wrongPayload.cellWrites.length, 0);

  const duplicateKey = appsScriptHarness([profile()], {
    initialAudits: [
      audit({ auditId: "AUDIT-1" }),
      audit({ auditId: "AUDIT-2" })
    ]
  });
  assert.throws(
    () => duplicateKey.link(),
    /AUDIT_IDEMPOTENCY_CONFLICT/
  );
  assert.equal(duplicateKey.cellWrites.length, 0);

  const impossibleState = appsScriptHarness([profile()], {
    initialAudits: [audit()]
  });
  assert.throws(
    () => impossibleState.link(),
    /INSTAGRAM_HANDLE_AUDIT_STATE_CONFLICT/
  );
  assert.equal(impossibleState.cellWrites.length, 0);
});

test("Apps Script retry completes safely after the final profile-cell write fails", () => {
  const harness = appsScriptHarness([profile()], {
    failCellFieldOnce: "instagramHandle"
  });

  assert.throws(
    () => harness.link(),
    /PROFILE_FIELD_WRITE_FAILED:instagramHandle/
  );
  assert.equal(harness.profiles[0].instagramHandle, "");
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.stats().flushes, 0);
  assert.equal(harness.stats().lockReleases, 1);

  const retry = harness.link();
  assert.equal(retry.data.idempotent, false);
  assert.equal(harness.profiles[0].instagramHandle, "foo.bar");
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.stats().transactionWrites, 0);
});

test("Apps Script blocks a silent change and a duplicate ACTIVE-profile handle", () => {
  const changed = appsScriptHarness([
    profile({ instagramHandle: "existing.handle" })
  ]);
  assert.throws(
    () => changed.link(),
    /INSTAGRAM_HANDLE_CHANGE_REQUIRES_REVIEW/
  );
  assert.equal(changed.cellWrites.length, 0);

  const duplicate = appsScriptHarness([
    profile(),
    profile({
      birdieId: "BIRDIE-OTHER",
      email: "other@example.com",
      instagramHandle: "@FOO.BAR",
      idempotencyKey: "profile:BIRDIE-OTHER"
    })
  ]);
  assert.throws(() => duplicate.link(), /INSTAGRAM_HANDLE_ALREADY_LINKED/);
  assert.equal(duplicate.cellWrites.length, 0);
});

test("Apps Script blocks inactive targets and invalid syntax", () => {
  const inactive = appsScriptHarness([profile({ status: "INACTIVE" })]);
  assert.throws(() => inactive.link(), /BIRDIE_PROFILE_NOT_ACTIVE/);

  const missingKey = appsScriptHarness([profile()]);
  assert.throws(
    () => missingKey.link({ idempotencyKey: " " }),
    /MISSING_FIELD:idempotencyKey/
  );

  for (const instagramHandle of ["", "   ", "https://instagram.com/foo", "foo/bar"]) {
    const invalid = appsScriptHarness([profile()]);
    assert.throws(
      () => invalid.link({ instagramHandle }),
      /MISSING_FIELD:instagramHandle|INVALID_INSTAGRAM_HANDLE/
    );
    assert.equal(invalid.cellWrites.length, 0);
    assert.equal(invalid.stats().transactionWrites, 0);
  }
});

test("Apps Script ignores an inactive profile when checking handle ownership", () => {
  const harness = appsScriptHarness([
    profile(),
    profile({
      birdieId: "BIRDIE-INACTIVE-OTHER",
      email: "inactive@example.com",
      instagramHandle: "foo.bar",
      status: "INACTIVE",
      idempotencyKey: "profile:BIRDIE-INACTIVE-OTHER"
    })
  ]);

  assert.equal(harness.link().data.idempotent, false);
  assert.equal(harness.profiles[0].instagramHandle, "foo.bar");
  assert.equal(harness.stats().transactionWrites, 0);
});

test("Apps Script fails closed when the post-write profile readback mismatches", () => {
  const harness = appsScriptHarness([profile()], {
    afterFlush(profiles) {
      profiles[0].status = "INACTIVE";
    }
  });

  assert.throws(() => harness.link(), /INSTAGRAM_HANDLE_READBACK_MISMATCH/);
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.stats().transactionWrites, 0);
  assert.equal(harness.stats().lockReleases, 1);
});
