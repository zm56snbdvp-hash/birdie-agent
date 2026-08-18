import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getFramerV4Policy } from "../src/framer-v4-service.mjs";

const routerPath = fileURLToPath(new URL("../src/framer-router.mjs", import.meta.url));
const servicePath = fileURLToPath(new URL("../src/framer-v4-service.mjs", import.meta.url));
const routerSource = fs.readFileSync(routerPath, "utf8");
const serviceSource = fs.readFileSync(servicePath, "utf8");

test("Framer V4 policy is isolated-branch preview only", () => {
  const policy = getFramerV4Policy();
  assert.equal(policy.mode, "APPLY_ON_ISOLATED_BRANCH_THEN_BRANCH_PREVIEW");
  assert.equal(policy.productionDeployExposed, false);
  assert.equal(policy.legacyPreviewDisabled, true);
  assert.equal(policy.branchRequired, true);
  assert.equal(policy.startsFromMainRequired, true);
  assert.equal(policy.readbackRequired, true);
  assert.equal(policy.publishTarget, "ACTIVE_CHILD_BRANCH_ONLY");
  assert.equal(policy.deployCalled, false);
});

test("legacy preview route is fail-closed and no longer invokes publishFramerPreview", () => {
  assert.match(routerSource, /FRAMER_UNSAFE_PREVIEW_DISABLED/);
  assert.match(routerSource, /url\.pathname === "\/framer\/preview"/);
  assert.doesNotMatch(routerSource, /publishFramerPreview/);
});

test("V4 exposes separate plan and apply-preview routes", () => {
  for (const route of [
    "/framer/v4/policy",
    "/framer/v4/site/text-plan",
    "/framer/v4/cms/plan",
    "/framer/v4/site/text-apply-preview",
    "/framer/v4/cms/apply-preview"
  ]) {
    assert.match(routerSource, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("V4 approval is cryptographically bound to the exact plan hash", () => {
  assert.match(serviceSource, /APPLY_FRAMER_V4_BRANCH_PREVIEW:\$\{planHash\}/);
  assert.match(serviceSource, /FRAMER_V4_PLAN_HASH_MISMATCH/);
  assert.match(serviceSource, /FOUNDER_CONFIRMATION_REQUIRED/);
  assert.match(serviceSource, /baseHash/);
  assert.match(serviceSource, /FRAMER_V4_STALE_PLAN/);
});

test("V4 requires branching runtime and starts from main", () => {
  for (const method of ["getActiveBranch", "getBranch", "createBranch", "publish"]) {
    assert.match(serviceSource, new RegExp(`"${method}"`));
  }
  assert.match(serviceSource, /getBranch\("main"\)/);
  assert.match(serviceSource, /active\.base !== null/);
  assert.match(serviceSource, /FRAMER_V4_MAIN_REQUIRED/);
  assert.match(serviceSource, /FRAMER_V4_BRANCH_ISOLATION_FAILED/);
  assert.match(serviceSource, /FRAMER_V4_PREVIEW_BRANCH_GUARD/);
});

test("V4 writes only after stale-plan check and verifies readback", () => {
  const textHashCheck = serviceSource.indexOf("textState(node.id, before) !== baseHash");
  const textWrite = serviceSource.indexOf("node.setText(normalized.text)");
  assert.ok(textHashCheck >= 0 && textWrite > textHashCheck);

  const cmsHashCheck = serviceSource.indexOf("cmsState(item) !== baseHash");
  const cmsWrite = serviceSource.indexOf("item.setAttributes");
  assert.ok(cmsHashCheck >= 0 && cmsWrite > cmsHashCheck);

  assert.match(serviceSource, /FRAMER_V4_READBACK_FAILED/);
});

test("V4 execution service never calls production deploy", () => {
  assert.doesNotMatch(serviceSource, /\.deploy\s*\(/);
  assert.match(serviceSource, /productionDeployed: false/);
});

test("V4 always attempts to restore main after branch work", () => {
  assert.match(serviceSource, /await main\.switch\(\)/);
  assert.match(serviceSource, /FRAMER_V4_MAIN_RESTORE_FAILED/);
});
