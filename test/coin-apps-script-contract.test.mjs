import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(implementation, /birdieCoinWriteObject_\(sheet, target\.row, target\.object\)/);
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
