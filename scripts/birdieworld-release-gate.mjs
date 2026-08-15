import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "release/birdieworld-v035-release.json"
);

export function loadReleaseManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function evaluatePreparation({
  root = REPOSITORY_ROOT,
  manifest = loadReleaseManifest()
} = {}) {
  const errors = [];

  if (manifest.version !== "0.3.5") errors.push("release version must be 0.3.5");
  if (manifest.targetBranch !== "main") errors.push("target branch must be main");
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceHead || "")) {
    errors.push("sourceHead must be an exact Git SHA");
  }

  for (const relativePath of manifest.requiredFiles || []) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      errors.push(`required release file is missing: ${relativePath}`);
    }
  }

  if (!manifest.requiredFiles?.includes(manifest.unityContract)) {
    errors.push("Unity handoff contract must be a required release file");
  }

  return { ok: errors.length === 0, errors };
}

function validateProductionDomain(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      hostname.length > 0 &&
      !hostname.includes("review") &&
      !hostname.includes("preview") &&
      !hostname.includes("localhost")
    );
  } catch {
    return false;
  }
}

export function evaluateProduction({
  env = process.env,
  root = REPOSITORY_ROOT,
  manifest = loadReleaseManifest()
} = {}) {
  const preparation = evaluatePreparation({ root, manifest });
  const errors = [...preparation.errors];
  const releaseSha = env.BIRDIEWORLD_RELEASE_SHA || "";

  if (env.BIRDIEWORLD_PRODUCTION_CONFIRMATION !== manifest.productionConfirmation) {
    errors.push("exact Founder production confirmation is missing");
  }
  if (env.BIRDIEWORLD_PHONE_REVIEW !== manifest.phoneReviewConfirmation) {
    errors.push("Founder phone review has not passed");
  }
  if (env.BIRDIEWORLD_MAIN_INTEGRATION !== manifest.mainIntegrationConfirmation) {
    errors.push("main integration CI has not passed");
  }
  if (!validateProductionDomain(env.BIRDIEWORLD_PRODUCTION_DOMAIN || "")) {
    errors.push("canonical HTTPS production domain is missing or still a review URL");
  }
  if (!/^prj_[A-Za-z0-9]+$/.test(env.BIRDIEWORLD_PRODUCTION_PROJECT_ID || "")) {
    errors.push("canonical Vercel production project is not pinned");
  }
  if (!/^team_[A-Za-z0-9]+$/.test(env.BIRDIEWORLD_PRODUCTION_TEAM_ID || "")) {
    errors.push("canonical Vercel team is not pinned");
  }
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    errors.push("release SHA must be an exact 40-character Git SHA");
  }
  if (!env.GITHUB_SHA || env.GITHUB_SHA !== releaseSha) {
    errors.push("release SHA does not match the checked-out GitHub SHA");
  }

  return { ok: errors.length === 0, errors };
}

function parseMode(argv) {
  const value = argv.find((argument) => argument.startsWith("--mode="));
  return value?.slice("--mode=".length) || "prepare";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = parseMode(process.argv.slice(2));
  const result = mode === "production"
    ? evaluateProduction()
    : mode === "prepare"
      ? evaluatePreparation()
      : { ok: false, errors: [`unsupported mode: ${mode}`] };

  if (!result.ok) {
    console.error(`BirdieWorld ${mode} gate: BLOCKED`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`BirdieWorld ${mode} gate: PASS`);
  }
}
