import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getBirdieBrandPreviewPolicy } from "../src/framer-brand-preview.mjs";

const servicePath = fileURLToPath(new URL("../src/framer-brand-preview.mjs", import.meta.url));
const source = fs.readFileSync(servicePath, "utf8");

test("Birdie brand preview is isolated and cannot deploy production", () => {
  const policy = getBirdieBrandPreviewPolicy();
  assert.equal(policy.mode, "ISOLATED_BRANCH_PREVIEW_ONLY");
  assert.equal(policy.productionDeployed, false);
  assert.equal(policy.productionDeployAllowed, false);
  assert.equal(policy.replacesLiveHome, false);
  assert.equal(policy.coinShopIncluded, false);
  assert.equal(policy.path, "/new-birdie");
});

test("Birdie brand preview uses the new four-pillar positioning", () => {
  const policy = getBirdieBrandPreviewPolicy();
  assert.deepEqual(policy.primaryPillars, ["Art", "Fashion", "Wellbeing", "Community"]);
  assert.match(policy.commerceTarget, /^https:\/\/shop\.birdieandbreakfast\.de/);
});

test("Birdie brand preview never calls Framer production deploy", () => {
  assert.doesNotMatch(source, /\.deploy\s*\(/);
  assert.match(source, /createBranch/);
  assert.match(source, /await framer\.publish\(\)/);
  assert.match(source, /await main\.switch\(\)/);
});

test("Birdie brand preview creates a dedicated page and code component", () => {
  assert.match(source, /createWebPage\(PREVIEW_PATH\)/);
  assert.match(source, /createCodeFile\("BirdieBrandHome\.tsx"/);
  assert.match(source, /addComponentInstance/);
  assert.match(source, /BirdieBrandHome/);
});

test("Birdie brand preview contains no Coin Shop navigation", () => {
  assert.doesNotMatch(source, />Coin Shop</);
  assert.match(source, /Fashion/);
  assert.match(source, /Wall Art/);
  assert.match(source, /Community/);
  assert.match(source, /Wohlgefühl/);
});
