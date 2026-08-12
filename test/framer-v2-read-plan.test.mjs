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
