import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getBirdieBrandPreviewPolicy } from "../src/framer-brand-preview.mjs";

const servicePath = fileURLToPath(new URL("../src/framer-brand-preview.mjs", import.meta.url));
const routerPath = fileURLToPath(new URL("../src/framer-router.mjs", import.meta.url));
const source = fs.readFileSync(servicePath, "utf8");
const routerSource = fs.readFileSync(routerPath, "utf8");

test("Birdie brand preview cannot deploy production", () => {
  const policy = getBirdieBrandPreviewPolicy();
  assert.equal(policy.mode, "PREVIEW_ONLY_NO_PRODUCTION_DEPLOY");
  assert.equal(policy.preferredIsolation, "FRAMER_BRANCH");
  assert.equal(policy.fallbackIsolation, "DEDICATED_MAIN_PAGE");
  assert.equal(policy.productionDeployed, false);
  assert.equal(policy.productionDeployAllowed, false);
  assert.equal(policy.replacesLiveHome, false);
  assert.equal(policy.coinShopIncluded, false);
  assert.equal(policy.path, "/new-birdie");
});

test("Birdie brand preview follows the current Shopify Art & Wear positioning", () => {
  const policy = getBirdieBrandPreviewPolicy();
  assert.equal(policy.version, "BIRDIE_BRAND_PREVIEW_V2_SHOPIFY_SYNC");
  assert.deepEqual(policy.primaryPillars, ["Art", "Wear", "World", "Community"]);
  assert.match(policy.commerceTarget, /^https:\/\/shop\.birdieandbreakfast\.de/);
});

test("Birdie brand preview never calls Framer production deploy", () => {
  assert.doesNotMatch(source, /\.deploy\s*\(/);
  assert.match(source, /createBranch/);
  assert.match(source, /Branching is not available/);
  assert.match(source, /DEDICATED_MAIN_PAGE_PREVIEW/);
  assert.match(source, /await framer\.publish\(\)/);
  assert.match(source, /await main\.switch\(\)/);
});

test("Birdie brand preview builds on a clean page and mounts inside its breakpoint", () => {
  assert.match(source, /createWebPage\(PREVIEW_PATH\)/);
  assert.doesNotMatch(source, /home\.clone\(/);
  assert.match(source, /createCodeFile\("BirdieBrandHome\.tsx"/);
  assert.match(source, /getNodesWithType\("FrameNode"\)/);
  assert.match(source, /frame\?\.isBreakpoint/);
  assert.match(source, /frame\?\.isPrimaryBreakpoint/);
  assert.match(source, /parentId:\s*primary\.id/);
  assert.match(source, /primary\.getChildren\(\)/);
  assert.match(source, /FRAMER_CLEAN_PAGE_NOT_EMPTY/);
  assert.match(source, /FRAMER_FOREIGN_INSTANCE_STILL_PRESENT/);
  assert.match(source, /FRAMER_BRAND_PARENT_READBACK_FAILED/);
  assert.match(source, /BirdieBrandHome/);
});

test("Birdie brand preview contains no Coin Shop and uses Shopify draft language", () => {
  assert.doesNotMatch(source, />Coin Shop</);
  assert.match(source, /Art for a Brighter World/);
  assert.match(source, /One art\.<br\/>Two canvases\./);
  assert.match(source, /The original canvas/);
  assert.match(source, /The second canvas/);
  assert.match(source, /A brighter world<br\/>through art\./);
  assert.match(source, /Join our world/);
});

test("Birdie brand preview route is founder-gated", () => {
  assert.match(routerSource, /\/framer\/v5\/brand-preview/);
  assert.match(routerSource, /BUILD_BIRDIE_FRAMER_BRAND_PREVIEW/);
  assert.match(routerSource, /\/framer\/v5\/brand-policy/);
});

test("Birdie brand preview uses the exact current Shopify draft hero and tiles", () => {
  assert.match(source, /birdieworld-hero-lounge-artwear\.png/);
  assert.match(source, /birdieworld-art-tile-light-gold\.png/);
  assert.match(source, /birdieworld-wear-tile-blue-green\.png/);
  assert.match(source, /hero-art-main" src="\$\{SHOPIFY_DRAFT_HERO\}"/);
  assert.match(source, /src="\$\{SHOPIFY_ART_TILE\}"/);
  assert.match(source, /src="\$\{SHOPIFY_WEAR_TILE\}"/);
  assert.match(source, /Playfair Display/);
  assert.match(source, /#0d1b2a/);
  assert.match(source, /#102e24/);
  assert.match(source, /#f5f2eb/);
  assert.match(source, /#b99a5d/);
  assert.doesNotMatch(source, /border-radius:999px;background:var\(--ivory\)/);
});


test("Birdie brand component declares responsive Framer sizing", () => {
  assert.match(source, /@framerSupportedLayoutWidth fixed/);
  assert.match(source, /@framerSupportedLayoutHeight auto/);
  assert.match(source, /width:\s*"1fr"/);
  assert.match(source, /height:\s*"fit-content"/);
});

test("Birdie brand preview checks code-component runtime errors before publish", () => {
  assert.match(source, /getRuntimeError/);
  assert.match(source, /FRAMER_BRAND_RUNTIME_ERROR/);
});


test("new Birdie preview hides the legacy full-screen Framer bridge", () => {
  assert.match(source, /#birdieworld-framer-bridge\{display:none!important/);
  assert.match(source, /visibility:hidden!important/);
  assert.match(source, /pointer-events:none!important/);
});

test("Shopify-synced preview keeps square editorial controls and clean anchors", () => {
  assert.match(source, /border-radius:0/);
  assert.match(source, /id="world"/);
  assert.match(source, /id="wear-story"/);
  assert.match(source, /id="art-story"/);
  assert.doesNotMatch(source, /<section className="fashion" id="fashion">/);
  assert.doesNotMatch(source, /<section className="art-section" id="art">/);
});
