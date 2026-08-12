import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dnaSource = fs.readFileSync(new URL("../birdie-os/dna-system.gs", import.meta.url), "utf8");
const domainRouterSource = fs.readFileSync(
  new URL("../birdie-os/domain-router.gs", import.meta.url),
  "utf8"
);

test("Birdie DNA Apps Script sources parse as JavaScript", () => {
  assert.doesNotThrow(() => new Function(dnaSource));
  assert.doesNotThrow(() => new Function(domainRouterSource));
});

test("only ACTIVE evolution rules are scoring-authoritative", () => {
  assert.match(
    dnaSource,
    /String\(row\.status \|\| ""\)\.toUpperCase\(\) === "ACTIVE"/
  );
  assert.match(dnaSource, /preparedRulesDoNotScore: true/);
});

test("public passports default private and redact raw evidence URLs", () => {
  assert.match(dnaSource, /publicPassport: request\.publicPassport === true/);
  const historyStart = dnaSource.indexOf("history: events.map");
  const historyEnd = dnaSource.indexOf("function birdieDnaCreateEvent_", historyStart);
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  const publicHistoryBlock = dnaSource.slice(historyStart, historyEnd);
  assert.doesNotMatch(publicHistoryBlock, /evidenceUrl:/);
  assert.match(publicHistoryBlock, /hasEvidence:/);
  assert.match(publicHistoryBlock, /birdieDnaPublicDate_/);
});

test("accepted transfer retries run reconciliation before returning", () => {
  assert.match(dnaSource, /birdieDnaReconcileAcceptedTransfer_/);
  assert.match(dnaSource, /DNA_TRANSFER_STALE_OWNER/);
  assert.match(dnaSource, /OWNERSHIP_TRANSFER/);
});

test("DNA domain dispatcher does not replace the outer API auth layer", () => {
  assert.match(domainRouterSource, /existing API authentication\/validation layer/);
  assert.match(domainRouterSource, /action\.indexOf\("coin"\) === 0/);
  assert.match(domainRouterSource, /action\.indexOf\("dna"\) === 0/);
});
