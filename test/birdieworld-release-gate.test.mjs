import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePreparation,
  evaluateProduction,
  loadReleaseManifest
} from "../scripts/birdieworld-release-gate.mjs";

test("BirdieWorld V0.3.5 release preparation is complete", () => {
  assert.deepEqual(evaluatePreparation(), { ok: true, errors: [] });
});

test("production release fails closed without Founder, phone, domain and SHA gates", () => {
  const result = evaluateProduction({ env: {} });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 7);
});

test("production release accepts only the exact fully pinned release", () => {
  const manifest = loadReleaseManifest();
  const sha = "a".repeat(40);
  const result = evaluateProduction({
    manifest,
    env: {
      BIRDIEWORLD_PRODUCTION_CONFIRMATION: manifest.productionConfirmation,
      BIRDIEWORLD_PHONE_REVIEW: manifest.phoneReviewConfirmation,
      BIRDIEWORLD_MAIN_INTEGRATION: manifest.mainIntegrationConfirmation,
      BIRDIEWORLD_PRODUCTION_DOMAIN: "https://world.birdieandbreakfast.com",
      BIRDIEWORLD_PRODUCTION_PROJECT_ID: "prj_BirdieWorldProduction",
      BIRDIEWORLD_PRODUCTION_TEAM_ID: "team_BirdieAndBreakfast",
      BIRDIEWORLD_RELEASE_SHA: sha,
      GITHUB_SHA: sha
    }
  });

  assert.deepEqual(result, { ok: true, errors: [] });
});
