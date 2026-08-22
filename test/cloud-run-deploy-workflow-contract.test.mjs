import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/deploy-cloud-run-no-traffic.yml",
  "utf8"
);

function extractRunBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^ {8}run: \|$/.test(lines[index])) continue;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === "") {
        block.push("");
        continue;
      }
      if (!line.startsWith("          ")) {
        index -= 1;
        break;
      }
      block.push(line.slice(10));
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

test("production workflow stays manual, protected, and WIF-compatible", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /test "\$GITHUB_EVENT_NAME" = "workflow_dispatch"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /test "\$REF_PROTECTED" = "true"/);
  assert.match(workflow, /test "\$RELEASE_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /DEPLOY_BIRDIE_COIN_SUPPORTER_PRODUCTION/);
  assert.match(workflow, /environment:\n      name: birdie-cloud-run-no-traffic/);
  assert.match(workflow, /EXPECTED_REPOSITORY_ID: "1329217661"/);
  assert.match(workflow, /EXPECTED_OWNER_ID: "315131667"/);
});

test("provider coordinates and user auth values are exact", () => {
  assert.match(workflow, /GCP_PROJECT_ID: gen-lang-client-0251788487/);
  assert.match(workflow, /GCP_REGION: europe-west3/);
  assert.match(workflow, /CLOUD_RUN_SERVICE: birdie-agent/);
  assert.match(workflow, /birdie-github-deployer@gen-lang-client-0251788487\.iam\.gserviceaccount\.com/);
  assert.match(workflow, /893591677320-compute@developer\.gserviceaccount\.com/);
  assert.match(workflow, /github-birdie-agent\/providers\/github-birdie-agent/);
  assert.match(workflow, /BIRDIE_APP_OAUTH_ISSUER: https:\/\/dev-dfveukr86fg3e8fr\.eu\.auth0\.com\//);
  assert.match(workflow, /BIRDIE_APP_OAUTH_AUDIENCE: https:\/\/birdie-agent-893591677320\.europe-west3\.run\.app/);
  assert.match(workflow, /BIRDIE_APP_BIRDIE_ID_CLAIM: https:\/\/birdieandbreakfast\.de\/birdie_id/);
  assert.match(workflow, /BIRDIE_APP_OAUTH_JWKS_URL: https:\/\/dev-dfveukr86fg3e8fr\.eu\.auth0\.com\/\.well-known\/jwks\.json/);
  assert.match(workflow, /EXPECTED_META_INSTAGRAM_ACCOUNT_ID: "17841440257520993"/);
  assert.match(workflow, /EXPECTED_META_INSTAGRAM_USERNAME: birdieandbreakfast/);
  assert.match(workflow, /EXPECTED_META_API_VERSION: v24\.0/);
});

test("candidate is zero traffic until security smoke and exact promotion", () => {
  assert.match(workflow, /--no-traffic/);
  assert.match(workflow, /--update-env-vars "BIRDIE_APP_OAUTH_ISSUER=/);
  assert.match(workflow, /META_INSTAGRAM_ACCOUNT_ID=\$EXPECTED_META_INSTAGRAM_ACCOUNT_ID/);
  assert.match(workflow, /--update-secrets "META_APP_SECRET=META_APP_SECRET:latest,META_WEBHOOK_VERIFY_TOKEN=META_WEBHOOK_VERIFY_TOKEN:latest,META_INSTAGRAM_ACCESS_TOKEN=META_INSTAGRAM_ACCESS_TOKEN:latest"/);
  assert.match(workflow, /meta-wrong-token\.txt/);
  assert.match(workflow, /live-meta-wrong-token\.txt/);
  assert.match(workflow, /test "\$meta_status" = "403"/);
  assert.match(workflow, /AUTHENTICATED_LEDGER_PROJECTION/);
  assert.match(workflow, /BIRDIE_APP_UNAUTHENTICATED/);
  assert.match(workflow, /birdieId=ATTACKER/);
  assert.match(workflow, /admin_status/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/iam-before-normalized\.json"/);
  assert.match(workflow, /--to-revisions "\$REVISION=100"/);
  assert.match(workflow, /PREVIOUS_REVISION=100/);
  assert.doesNotMatch(workflow, /--allow-unauthenticated/);
  assert.doesNotMatch(workflow, /credentials_json/);
});

test("all actions are immutable and all embedded shell blocks parse", () => {
  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 7);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
  }
  const blocks = extractRunBlocks(workflow);
  assert.ok(blocks.length >= 12);
  for (const [index, block] of blocks.entries()) {
    const parsed = spawnSync("bash", ["-n"], { encoding: "utf8", input: block });
    assert.equal(parsed.status, 0, `run block ${index + 1}: ${parsed.stderr}`);
  }
});
