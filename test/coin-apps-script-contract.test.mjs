import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset)
      )
    );
  }

  setValues(values) {
    assert.equal(values.length, this.rowCount);
    values.forEach((row, rowOffset) => {
      assert.equal(row.length, this.columnCount);
      row.forEach((value, columnOffset) => {
        this.sheet.setValue(
          this.row + rowOffset,
          this.column + columnOffset,
          value
        );
      });
    });
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.frozenRows = 0;
  }

  appendRow(row) {
    this.rows.push([...row]);
    return this;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getDataRange() {
    return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    return this;
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  setValue(row, column, value) {
    while (this.rows.length < row) {
      this.rows.push([]);
    }
    while (this.rows[row - 1].length < column) {
      this.rows[row - 1].push("");
    }
    this.rows[row - 1][column - 1] = value;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = new Map();
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

async function loadCoinSystem() {
  const spreadsheet = new FakeSpreadsheet();
  let uuidSequence = 0;
  const source = await readFile(
    new URL("../birdie-os/coin-system.gs", import.meta.url),
    "utf8"
  );

  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties() {
        return { getProperty() { return null; } };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return spreadsheet;
      },
      openById() {
        return spreadsheet;
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {}
        };
      }
    },
    Utilities: {
      getUuid() {
        uuidSequence += 1;
        return uuidSequence.toString(16).padStart(32, "0");
      }
    }
  });

  vm.runInContext(source, context, { filename: "coin-system.gs" });
  return { context, spreadsheet };
}

function call(context, request) {
  return context.handleBirdieCoinAction_(request).data;
}

function rowCount(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName).getLastRow() - 1;
}

test("Apps Script creates the complete Birdie Coin schema and pilot catalog", async () => {
  const { context, spreadsheet } = await loadCoinSystem();

  const result = context.setupBirdieCoinSystem_();

  assert.equal(result.success, true);
  assert.deepEqual(
    [...spreadsheet.sheets.keys()].sort(),
    [
      "ACTION_CLAIMS",
      "AUDIT_EVENTS",
      "BIRDIE_PROFILES",
      "COIN_TRANSACTIONS",
      "REDEMPTIONS",
      "REWARDS",
      "SUPPORTER_AUTH_CHALLENGES",
      "SUPPORTER_SESSIONS",
      "USER_BADGES"
    ]
  );
  assert.equal(rowCount(spreadsheet, "REWARDS"), 6);

  context.setupBirdieCoinSystem_();
  assert.equal(rowCount(spreadsheet, "REWARDS"), 6);
});

test("founding score migration is exact and idempotent in the real Apps Script", async () => {
  const { context, spreadsheet } = await loadCoinSystem();

  const profile = call(context, {
    action: "coinCreateProfile",
    displayName: "Lee-Ann",
    email: "lee-ann@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:founding:lee-ann",
    source: "Contract Test"
  });

  assert.equal(profile.balances.confirmed, 0);
  assert.equal(rowCount(spreadsheet, "COIN_TRANSACTIONS"), 0);

  const firstImport = call(context, {
    action: "coinImportOpeningBalance",
    birdieId: profile.birdieId,
    amount: 14,
    sourceReference: "supporter-score-2026-08-10",
    founderApproved: true,
    actor: "Kevin Stroop",
    idempotencyKey: `opening:${profile.birdieId}:2026-08-10`
  });
  const retry = call(context, {
    action: "coinImportOpeningBalance",
    birdieId: profile.birdieId,
    amount: 14,
    sourceReference: "supporter-score-2026-08-10",
    founderApproved: true,
    actor: "Kevin Stroop",
    idempotencyKey: `opening:${profile.birdieId}:2026-08-10`
  });

  assert.equal(firstImport.transaction.transactionId, retry.transaction.transactionId);
  assert.equal(rowCount(spreadsheet, "COIN_TRANSACTIONS"), 1);

  const migrated = call(context, {
    action: "coinGetProfile",
    birdieId: profile.birdieId
  });
  assert.equal(migrated.balances.confirmed, 14);
  assert.equal(migrated.balances.available, 14);
  assert.equal(migrated.balances.lifetime, 14);
  assert.equal(migrated.balances.level.code, "FAIRWAY_FRIEND");
});

test("reward reservation, approval and cancellation preserve the ledger balance", async () => {
  const { context, spreadsheet } = await loadCoinSystem();
  const profile = call(context, {
    action: "coinCreateProfile",
    displayName: "Pilot Supporter",
    email: "pilot@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:pilot",
    source: "Contract Test"
  });

  call(context, {
    action: "coinImportOpeningBalance",
    birdieId: profile.birdieId,
    amount: 14,
    sourceReference: "contract-opening",
    founderApproved: true,
    actor: "Kevin Stroop",
    idempotencyKey: "opening:pilot"
  });

  const requested = call(context, {
    action: "coinCreateRedemption",
    birdieId: profile.birdieId,
    rewardId: "RW-PRIVATE-WALLPAPER",
    idempotencyKey: "redemption:pilot:wallpaper",
    source: "Contract Test"
  });
  assert.equal(requested.balances.confirmed, 14);
  assert.equal(requested.balances.reserved, 5);
  assert.equal(requested.balances.available, 9);

  call(context, {
    action: "coinCreateRedemption",
    birdieId: profile.birdieId,
    rewardId: "RW-PRIVATE-WALLPAPER",
    idempotencyKey: "redemption:pilot:wallpaper",
    source: "Contract Test"
  });
  assert.equal(rowCount(spreadsheet, "REDEMPTIONS"), 1);
  assert.equal(rowCount(spreadsheet, "COIN_TRANSACTIONS"), 2);

  const approved = call(context, {
    action: "coinDecideRedemption",
    redemptionId: requested.redemption.redemptionId,
    decision: "APPROVE",
    actor: "Kevin Stroop",
    idempotencyKey: "redemption-decision:pilot:approve"
  });
  assert.equal(approved.balances.confirmed, 9);
  assert.equal(approved.balances.reserved, 0);
  assert.equal(approved.balances.available, 9);

  const cancelled = call(context, {
    action: "coinDecideRedemption",
    redemptionId: requested.redemption.redemptionId,
    decision: "CANCEL",
    actor: "Kevin Stroop",
    reason: "Contract reversal",
    idempotencyKey: "redemption-decision:pilot:cancel"
  });
  assert.equal(cancelled.balances.confirmed, 14);
  assert.equal(cancelled.balances.reserved, 0);
  assert.equal(cancelled.balances.available, 14);
  assert.equal(cancelled.balances.lifetime, 14);
  assert.equal(rowCount(spreadsheet, "COIN_TRANSACTIONS"), 3);
});

test("supporter login hashes credentials and consumes a challenge exactly once", async () => {
  const { context, spreadsheet } = await loadCoinSystem();
  const profile = call(context, {
    action: "coinCreateProfile",
    displayName: "Founding Birdie",
    email: "founder@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:auth-pilot",
    source: "Contract Test"
  });
  const codeHash = "a".repeat(64);
  const tokenHash = "b".repeat(64);

  const challenge = call(context, {
    action: "coinCreateLoginChallenge",
    challengeId: "LOGIN-CONTRACT-01",
    email: "FOUNDER@example.com",
    emailBucketHash: "e".repeat(64),
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    idempotencyKey: "login-challenge:contract-01",
    source: "Contract Test"
  });

  assert.equal(challenge.deliverable, true);
  assert.equal(challenge.deliveryEmail, "founder@example.com");
  assert.equal(challenge.displayName, "Founding Birdie");

  const verified = call(context, {
    action: "coinVerifyLoginChallenge",
    challengeId: challenge.challengeId,
    codeHash,
    source: "Contract Test"
  });
  assert.equal(verified.birdieId, profile.birdieId);

  const session = call(context, {
    action: "coinCreateSupporterSession",
    sessionId: "SESSION-CONTRACT-01",
    challengeId: challenge.challengeId,
    birdieId: profile.birdieId,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    idempotencyKey: "supporter-session:contract-01",
    source: "Contract Test"
  });
  assert.equal(session.profile.birdieId, profile.birdieId);

  const authorized = call(context, {
    action: "coinAuthorizeSupporterSession",
    tokenHash,
    source: "Contract Test"
  });
  assert.equal(authorized.profile.birdieId, profile.birdieId);

  assert.throws(
    () => call(context, {
      action: "coinVerifyLoginChallenge",
      challengeId: challenge.challengeId,
      codeHash,
      source: "Contract Test"
    }),
    /INVALID_LOGIN_CODE/
  );

  call(context, {
    action: "coinRevokeSupporterSession",
    tokenHash,
    source: "Contract Test"
  });
  assert.throws(
    () => call(context, {
      action: "coinAuthorizeSupporterSession",
      tokenHash,
      source: "Contract Test"
    }),
    /SESSION_REVOKED/
  );

  const challengeRows = spreadsheet.getSheetByName("SUPPORTER_AUTH_CHALLENGES").rows;
  const sessionRows = spreadsheet.getSheetByName("SUPPORTER_SESSIONS").rows;
  assert.equal(challengeRows[1][challengeRows[0].indexOf("codeHash")], codeHash);
  assert.equal(challengeRows[1][challengeRows[0].indexOf("status")], "CONSUMED");
  assert.equal(sessionRows[1][sessionRows[0].indexOf("tokenHash")], tokenHash);
  assert.equal(sessionRows[1][sessionRows[0].indexOf("status")], "REVOKED");

  const auditDetails = spreadsheet
    .getSheetByName("AUDIT_EVENTS")
    .rows
    .slice(1)
    .filter((row) => /^(LOGIN_|SUPPORTER_SESSION_)/.test(String(row[1] || "")))
    .map((row) => String(row[6] || ""))
    .join("\n");
  assert.doesNotMatch(auditDetails, new RegExp(codeHash));
  assert.doesNotMatch(auditDetails, new RegExp(tokenHash));
  assert.doesNotMatch(auditDetails, /founder@example\.com/i);
});

test("supporter login locks a challenge after five failed code attempts", async () => {
  const { context } = await loadCoinSystem();
  call(context, {
    action: "coinCreateProfile",
    displayName: "Attempt Pilot",
    email: "attempts@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:attempt-pilot",
    source: "Contract Test"
  });
  call(context, {
    action: "coinCreateLoginChallenge",
    challengeId: "LOGIN-ATTEMPTS-01",
    email: "attempts@example.com",
    emailBucketHash: "f".repeat(64),
    codeHash: "c".repeat(64),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    idempotencyKey: "login-challenge:attempts-01",
    source: "Contract Test"
  });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.throws(
      () => call(context, {
        action: "coinVerifyLoginChallenge",
        challengeId: "LOGIN-ATTEMPTS-01",
        codeHash: "d".repeat(64),
        source: "Contract Test"
      }),
      /INVALID_LOGIN_CODE/
    );
  }
  assert.throws(
    () => call(context, {
      action: "coinVerifyLoginChallenge",
      challengeId: "LOGIN-ATTEMPTS-01",
      codeHash: "d".repeat(64),
      source: "Contract Test"
    }),
    /LOGIN_CHALLENGE_LOCKED/
  );
  assert.throws(
    () => call(context, {
      action: "coinVerifyLoginChallenge",
      challengeId: "LOGIN-ATTEMPTS-01",
      codeHash: "c".repeat(64),
      source: "Contract Test"
    }),
    /LOGIN_CHALLENGE_LOCKED/
  );
});

test("new login codes supersede prior codes without storing unknown email addresses", async () => {
  const { context, spreadsheet } = await loadCoinSystem();
  call(context, {
    action: "coinCreateProfile",
    displayName: "Known Pilot",
    email: "known@example.com",
    accountType: "PRIVATE",
    migrationProfile: true,
    founderApproved: true,
    idempotencyKey: "profile:known-pilot",
    source: "Contract Test"
  });
  const bucket = "1".repeat(64);
  const first = call(context, {
    action: "coinCreateLoginChallenge",
    challengeId: "LOGIN-SUPERSEDE-01",
    email: "known@example.com",
    emailBucketHash: bucket,
    codeHash: "2".repeat(64),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    idempotencyKey: "login-challenge:supersede-01",
    source: "Contract Test"
  });
  assert.equal(first.deliverable, true);

  const sheet = spreadsheet.getSheetByName("SUPPORTER_AUTH_CHALLENGES");
  const createdAtColumn = sheet.rows[0].indexOf("createdAt");
  sheet.rows[1][createdAtColumn] = new Date(Date.now() - 61 * 1000).toISOString();

  const second = call(context, {
    action: "coinCreateLoginChallenge",
    challengeId: "LOGIN-SUPERSEDE-02",
    email: "known@example.com",
    emailBucketHash: bucket,
    codeHash: "3".repeat(64),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    idempotencyKey: "login-challenge:supersede-02",
    source: "Contract Test"
  });
  assert.equal(second.challengeId, "LOGIN-SUPERSEDE-02");
  const statusColumn = sheet.rows[0].indexOf("status");
  assert.equal(sheet.rows[1][statusColumn], "SUPERSEDED");
  assert.equal(sheet.rows[2][statusColumn], "ISSUED");

  const unknown = call(context, {
    action: "coinCreateLoginChallenge",
    challengeId: "LOGIN-UNKNOWN-01",
    email: "unknown@example.com",
    emailBucketHash: "4".repeat(64),
    codeHash: "5".repeat(64),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    idempotencyKey: "login-challenge:unknown-01",
    source: "Contract Test"
  });
  assert.equal(unknown.deliverable, false);
  const emailColumn = sheet.rows[0].indexOf("email");
  const unknownRow = sheet.rows.find((row) => row[0] === "LOGIN-UNKNOWN-01");
  assert.equal(unknownRow[emailColumn], "");
  assert.equal(unknownRow[statusColumn], "UNDELIVERABLE");
});
