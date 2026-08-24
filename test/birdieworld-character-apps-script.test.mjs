import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../birdie-os/world-character-profile.gs", import.meta.url),
  "utf8"
);

const headers = [
  "birdieId", "displayName", "story", "style", "hair", "face", "outfit",
  "accessories", "color", "createdAt", "updatedAt", "schemaVersion", "characterId"
];

function createSheet(initialRows = []) {
  const rows = initialRows.map((row) => [...row]);
  const ensure = (row, column) => {
    while (rows.length < row) rows.push([]);
    while (rows[row - 1].length < column) rows[row - 1].push("");
  };
  const range = (row, column, rowCount = 1, columnCount = 1) => ({
    getValues() {
      return Array.from({ length: rowCount }, (_, rowOffset) =>
        Array.from({ length: columnCount }, (_, columnOffset) =>
          rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ""
        )
      );
    },
    setValues(values) {
      assert.equal(values.length, rowCount);
      for (let r = 0; r < rowCount; r += 1) {
        assert.equal(values[r].length, columnCount);
        for (let c = 0; c < columnCount; c += 1) {
          ensure(row + r, column + c);
          rows[row - 1 + r][column - 1 + c] = values[r][c];
        }
      }
    },
    getValue() {
      return rows[row - 1]?.[column - 1] ?? "";
    }
  });
  return {
    rows,
    getLastColumn() {
      return rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    },
    getLastRow() {
      return rows.length;
    },
    getRange: range,
    getDataRange() {
      return range(1, 1, rows.length, this.getLastColumn());
    },
    appendRow(row) {
      rows.push([...row]);
    }
  };
}

function harness(initialRows = []) {
  let sheet = initialRows.length ? createSheet(initialRows) : null;
  let lockWaits = 0;
  let lockReleases = 0;
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
      getActiveSpreadsheet() {
        return {
          getSheetByName() {
            return sheet;
          },
          insertSheet() {
            sheet = createSheet();
            return sheet;
          }
        };
      }
    },
    Utilities: {
      getUuid() {
        return "01234567-89ab-cdef-0123-456789abcdef";
      }
    }
  };
  runInNewContext(source, context);
  const authorized = (request) => context.handleBirdieWorldCharacterAuthorizedAction_({
    source: "Birdie Agent BirdieWorld V1",
    authSubject: "auth0|birdie-1",
    authBirdieId: "birdie-1",
    ...request
  });
  return {
    authorized,
    unverified(request) {
      return context.handleBirdieWorldCharacterAction_(request);
    },
    get sheet() {
      return sheet;
    },
    stats() {
      return { lockWaits, lockReleases };
    }
  };
}

test("BirdieOS creates and preserves one server-owned character ID", () => {
  const state = harness();
  const first = state.authorized({
    action: "worldSaveCharacter",
    character: {
      displayName: "Kevin",
      story: "STRATEGE",
      color: "MIDNIGHT",
      characterId: "f".repeat(32),
      birdieId: "attacker",
      coinBalance: 999
    }
  });
  assert.equal(first.success, true);
  assert.equal(first.data.birdieId, "birdie-1");
  assert.equal(first.data.characterId, "0123456789abcdef0123456789abcdef");
  assert.equal(Object.hasOwn(first.data, "coinBalance"), false);

  const second = state.authorized({
    action: "worldSaveCharacter",
    character: { displayName: "Kevin Zwei", story: "ENTDECKER" }
  });
  assert.equal(second.data.characterId, first.data.characterId);
  assert.deepEqual(state.stats(), { lockWaits: 2, lockReleases: 2 });

  const loaded = state.authorized({ action: "worldGetCharacter" });
  assert.equal(loaded.data.characterId, first.data.characterId);
  assert.equal(loaded.data.displayName, "Kevin Zwei");
  assert.deepEqual(state.stats(), { lockWaits: 3, lockReleases: 3 });
  assert.deepEqual(state.sheet.rows[0], headers);
});

test("BirdieOS migrates the old append-only header and backfills identity on first read", () => {
  const oldHeaders = headers.slice(0, -1);
  const oldRow = [
    "birdie-1", "Kevin", "ENTDECKER", "CLASSIC", "DEFAULT", "DEFAULT", "TRAVEL",
    "NONE", "FOREST", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z",
    "birdieworld-character/v1"
  ];
  const state = harness([oldHeaders, oldRow]);
  const loaded = state.authorized({ action: "worldGetCharacter" });
  assert.deepEqual(state.sheet.rows[0], headers);
  assert.equal(loaded.data.characterId, "0123456789abcdef0123456789abcdef");
  const saved = state.authorized({
    action: "worldSaveCharacter",
    character: { displayName: "Kevin", story: "ENTDECKER" }
  });
  assert.equal(saved.data.createdAt, oldRow[9]);
  assert.equal(saved.data.characterId, loaded.data.characterId);
});

test("BirdieOS requires the verified action-bound character scope", () => {
  const state = harness();
  assert.throws(
    () => state.unverified({ action: "worldGetCharacter", authBirdieId: "birdie-1" }),
    /BIRDIE_WORLD_CHARACTER_AUTH_UNVERIFIED/
  );
  assert.throws(
    () => state.authorized({ action: "worldGetCharacter", authSubject: "" }),
    /INVALID_BIRDIE_WORLD_AUTH_SUBJECT/
  );
  assert.throws(
    () => state.authorized({ action: "worldGetCharacter", source: "caller" }),
    /BIRDIE_WORLD_TRUSTED_SOURCE_REQUIRED/
  );
});

test("BirdieOS rejects malformed or duplicate stored character identity", () => {
  const baseRow = [
    "birdie-1", "Kevin", "ENTDECKER", "CLASSIC", "DEFAULT", "DEFAULT", "TRAVEL",
    "NONE", "FOREST", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z",
    "birdieworld-character/v1", "malformed"
  ];
  const malformed = harness([headers, baseRow]);
  assert.throws(
    () => malformed.authorized({ action: "worldGetCharacter" }),
    /INVALID_STORED_CHARACTER_ID/
  );
  assert.equal(malformed.sheet.rows[1][12], "malformed");

  const sharedId = "a".repeat(32);
  const otherRow = [...baseRow];
  baseRow[12] = sharedId;
  otherRow[0] = "birdie-2";
  otherRow[12] = sharedId;
  const duplicateId = harness([headers, baseRow, otherRow]);
  assert.throws(
    () => duplicateId.authorized({ action: "worldGetCharacter" }),
    /DUPLICATE_BIRDIE_WORLD_CHARACTER_ID/
  );
});

test("BirdieOS rejects formula names, duplicate profiles and schema drift", () => {
  const formula = harness();
  assert.throws(
    () => formula.authorized({ action: "worldSaveCharacter", character: { displayName: "=IMPORTXML()" } }),
    /INVALID_CHARACTER_NAME/
  );
  assert.deepEqual(formula.stats(), { lockWaits: 1, lockReleases: 1 });

  const row = [
    "birdie-1", "Kevin", "ENTDECKER", "CLASSIC", "DEFAULT", "DEFAULT", "TRAVEL",
    "NONE", "FOREST", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z",
    "birdieworld-character/v1", "a".repeat(32)
  ];
  const duplicate = harness([headers, row, row]);
  assert.throws(
    () => duplicate.authorized({ action: "worldGetCharacter" }),
    /DUPLICATE_BIRDIE_WORLD_CHARACTER/
  );

  const drifted = harness([[...headers, "unexpected"], [...row, "value"]]);
  assert.throws(
    () => drifted.authorized({ action: "worldGetCharacter" }),
    /BIRDIE_WORLD_CHARACTER_HEADER_MISMATCH/
  );
});
