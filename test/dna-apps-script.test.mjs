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

test("release claims store only hash metadata and expose a rotation action", () => {
  assert.match(dnaSource, /"claimTokenHash", "claimTokenIssuedAt", "claimTokenUsedAt"/);
  assert.match(dnaSource, /case "dnaRotateReleaseClaimToken"/);
  assert.match(dnaSource, /birdieDnaRequireClaimTokenHash_/);
  assert.match(dnaSource, /\^\[a-f0-9\]\{64\}\$/);
  assert.doesNotMatch(dnaSource, /"claimToken"\s*,\s*"claimTokenHash"/);
});

test("release acceptance validates and consumes the one-time claim hash", () => {
  assert.match(dnaSource, /DNA_RELEASE_CLAIM_TOKEN_MISSING/);
  assert.match(dnaSource, /DNA_RELEASE_CLAIM_TOKEN_ALREADY_USED/);
  assert.match(dnaSource, /DNA_RELEASE_CLAIM_TOKEN_INVALID/);
  assert.match(dnaSource, /ownership\.claimTokenUsedAt = now/);
});

test("claim-token hashes are not written into transfer audit details", () => {
  const initiationStart = dnaSource.indexOf("function birdieDnaInitiateTransfer_");
  const rotationStart = dnaSource.indexOf("function birdieDnaRotateReleaseClaimToken_", initiationStart);
  const acceptStart = dnaSource.indexOf("function birdieDnaAcceptTransfer_", rotationStart);
  assert.ok(initiationStart >= 0 && rotationStart > initiationStart && acceptStart > rotationStart);

  const initiationBlock = dnaSource.slice(initiationStart, rotationStart);
  const rotationBlock = dnaSource.slice(rotationStart, acceptStart);
  assert.doesNotMatch(initiationBlock, /birdieCoinAudit_\([^\n]+ownership, key\)/);
  assert.match(initiationBlock, /claimTokenIssued: Boolean\(ownership\.claimTokenHash\)/);
  assert.match(rotationBlock, /claimTokenRotated: true/);
  assert.doesNotMatch(rotationBlock, /claimTokenHash:\s*ownership\.claimTokenHash/);
});

test("DNA domain dispatcher does not replace the outer API auth layer", () => {
  assert.match(domainRouterSource, /existing API authentication\/validation layer/);
  assert.match(domainRouterSource, /action\.indexOf\("coin"\) === 0/);
  assert.match(domainRouterSource, /action\.indexOf\("dna"\) === 0/);
});
