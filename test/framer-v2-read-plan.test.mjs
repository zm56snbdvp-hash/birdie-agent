import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getFramerPlanPolicy } from "../src/framer-service.mjs";

const routerPath = fileURLToPath(new URL("../src/framer-router.mjs", import.meta.url));
const servicePath = fileURLToPath(new URL("../src/framer-service.mjs", import.meta.url));
const routerSource = fs.readFileSync(routerPath, "utf8");
const serviceSource = fs.readFileSync(servicePath, "utf8");

test("Framer V2 policy is read and plan only", () => {
  const policy = getFramerPlanPolicy();
  assert.equal(policy.mode, "READ_AND_PLAN_ONLY");
  assert.equal(policy.siteInventory, true);
  assert.equal(policy.cmsInventory, true);
  assert.equal(policy.textPlan, true);
  assert.equal(policy.cmsPlan, true);
  assert.equal(policy.writeSurfaceExposed, false);
});

test("Framer V2 read policy uses a shared serialized connection with bounded retries", () => {
  const policy = getFramerPlanPolicy();
  assert.equal(policy.connectionMode, "SHARED_LONG_LIVED_SERIALIZED");
  assert.equal(policy.retryAttempts, 4);
  assert.equal(policy.pageRefCache, true);
  assert.equal(policy.pageTextConcurrency, 4);
  assert.match(serviceSource, /sharedFramer/);
  assert.match(serviceSource, /serializeFramer/);
  assert.match(serviceSource, /FRAMER_UPSTREAM_UNAVAILABLE/);
});

test("Framer page lookup caches page IDs and can re-read them directly", () => {
  assert.match(serviceSource, /pageRefCache/);
  assert.match(serviceSource, /framer\.getNode\(cachedId\)/);
  assert.match(serviceSource, /framer\.getNode\(value\)/);
});

test("Framer page text reads are concurrency bounded instead of fully fan-out", () => {
  assert.match(serviceSource, /PAGE_TEXT_CONCURRENCY = 4/);
  assert.match(serviceSource, /nodes\.slice\(index, index \+ PAGE_TEXT_CONCURRENCY\)/);
  assert.match(serviceSource, /Promise\.all\(chunk\.map\(readTextNode\)\)/);
});

test("Framer V2 exposes inventory and plan routes", () => {
  for (const route of [
    "/framer/site/pages",
    "/framer/site/page",
    "/framer/site/text-plan",
    "/framer/cms/collections",
    "/framer/cms/collection",
    "/framer/cms/plan"
  ]) {
    assert.match(routerSource, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("Framer V2 does not expose CMS or text apply routes", () => {
  assert.doesNotMatch(routerSource, /\/framer\/cms\/apply/);
  assert.doesNotMatch(routerSource, /\/framer\/site\/text-apply/);
  assert.doesNotMatch(serviceSource, /\.setText\s*\(/);
  assert.doesNotMatch(serviceSource, /\.addItems\s*\(/);
});

test("preview and production remain separately founder gated", () => {
  assert.match(routerSource, /PUBLISH_FRAMER_PREVIEW/);
  assert.match(routerSource, /DEPLOY_FRAMER_PRODUCTION/);
});
