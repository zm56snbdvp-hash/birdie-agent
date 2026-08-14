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
  { afterFlush, auditFailures = 0, failCellFieldOnce } = {}
) {
  const profiles = structuredClone(initialProfiles);
  const cellWrites = [];
  const audits = [];
  let transactionWrites = 0;
  let auditAttempts = 0;
  let flushes = 0;
  let lockWaits = 0;
  let lockReleases = 0;
  let pendingCellFailure = failCellFieldOnce;

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
  context.birdieCoinSheet_ = () => profileSheet;
  context.birdieCoinFind_ = (_sheet, field, value) => {
    const index = profiles.findIndex((entry) => String(entry[field]) === String(value));
    return index === -1
      ? null
      : { row: index + 2, object: structuredClone(profiles[index]) };
  };
  context.birdieCoinObjects_ = () => structuredClone(profiles);
  context.birdieCoinNow_ = () => "2026-08-14T05:00:00.000Z";
  context.birdieCoinProfileView_ = (entry) => structuredClone(entry);
  context.birdieCoinAudit_ = (...args) => {
    auditAttempts += 1;
    if (auditAttempts <= auditFailures) throw new Error("AUDIT_WRITE_FAILED");
    const idempotencyKey = args[6];
    if (!audits.some((event) => event[6] === idempotencyKey)) audits.push(args);
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
