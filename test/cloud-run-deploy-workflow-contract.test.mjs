import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/deploy-cloud-run-no-traffic.yml",
  "utf8"
);
const prWorkflow = readFileSync(".github/workflows/pr-tests.yml", "utf8");
const runbook = readFileSync(
  "docs/github-oidc-cloud-run-no-traffic.md",
  "utf8"
);
const gitignore = readFileSync(".gitignore", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");
const gcloudignore = readFileSync(".gcloudignore", "utf8");
const readme = readFileSync("README.md", "utf8");

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

test("deployment workflow is manual, immutable, and repository-bound", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /RELEASE_SHA: eeaf5d7e33451ed6ea9338d6cf5022be95db9277/);
  assert.match(workflow, /EXPECTED_VERSION: 2\.9\.0/);
  assert.match(workflow, /EXPECTED_REPOSITORY_ID: "1329217661"/);
  assert.match(workflow, /EXPECTED_OWNER_ID: "315131667"/);
  assert.match(workflow, /GCP_PROJECT_ID: gen-lang-client-0251788487/);
  assert.match(workflow, /GCP_REGION: europe-west3/);
  assert.match(workflow, /CLOUD_RUN_SERVICE: birdie-agent/);
  assert.match(
    workflow,
    /test "\$CONFIRMATION" = "DEPLOY_BIRDIE_AGENT_STAGE_A_NO_TRAFFIC_EEAF5D7"/
  );
  assert.match(workflow, /test "\$RELEASE_SHA_INPUT" = "\$RELEASE_SHA"/);
  assert.doesNotMatch(workflow, /apps_script_(?:version|receipt_sha256)/);
  assert.doesNotMatch(workflow, /APPS_SCRIPT_(?:VERSION|RECEIPT_SHA256)/);
  assert.doesNotMatch(workflow, /appsScriptReceiptSha256/);
  assert.match(workflow, /sha256sum --check <<'APPS_SCRIPT_HASHES'/);
  assert.match(workflow, /test "\$REF_PROTECTED" = "true"/);
  assert.match(workflow, /test "\$GITHUB_EVENT_NAME" = "workflow_dispatch"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_SHA" HEAD/);
  assert.match(workflow, /git archive "\$RELEASE_SHA" \| tar -x/);
});

test("required PR check runs on main with immutable actions", () => {
  assert.match(prWorkflow, /^name: PR Tests$/m);
  assert.match(prWorkflow, /pull_request:\n    branches: \[main\]/);
  assert.match(prWorkflow, /push:\n    branches: \[main\]/);
  assert.doesNotMatch(prWorkflow, /feature\/birdie-os-mcp-v1/);
  const uses = [...prWorkflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(
    (match) => match[1]
  );
  assert.equal(uses.length, 2);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
  }
});

test("every embedded deployment shell block parses as Bash", () => {
  const blocks = extractRunBlocks(workflow);
  assert.equal(blocks.length, 12);
  for (const [index, block] of blocks.entries()) {
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: block
    });
    assert.equal(result.status, 0, `run block ${index + 1}: ${result.stderr}`);
  }
});

test("operator entrypoint points at the 2.9.0 governed lane", () => {
  assert.match(readme, /Current service version: \*\*2\.9\.0\*\*/);
  assert.match(readme, /github-oidc-cloud-run-no-traffic\.md/);
  assert.match(readme, /Stage-A absent-bundle lane/);
  assert.match(readme, /may precede Apps Script but does not activate/);
  assert.match(readme, /later configured, separately approved provider deployment/);
  assert.match(readme, /not after\n+the Stage-A absent-bundle run/);
  assert.match(readme, /historical TASK-038 runbook must not drive this release/);
  assert.match(readme, /BirdieWorld V1 uses its own user OAuth boundary/);
});

test("deployment job requires protected OIDC environment and pinned actions", () => {
  assert.match(workflow, /environment:\n      name: birdie-cloud-run-no-traffic/);
  assert.match(workflow, /permissions:\n      actions: read\n      contents: read\n      id-token: write/);
  assert.equal((workflow.match(/id-token: write/g) || []).length, 1);
  assert.match(workflow, /workload_identity_provider:/);
  assert.match(workflow, /service_account:/);
  assert.match(workflow, /token_format: access_token/);
  assert.match(workflow, /BIRDIE_NO_TRAFFIC_ENVIRONMENT_GUARD/);
  assert.match(workflow, /BIRDIE_NO_TRAFFIC_PROTECTED_V1/);
  assert.match(
    workflow,
    /FROM node:22\.23\.1-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3/
  );
  assert.ok(
    workflow.indexOf("Build exact release without cloud credentials") <
      workflow.indexOf("Authenticate to Google Cloud with OIDC")
  );
  assert.match(workflow, /imageArtifactDigest/);
  const buildJob = workflow.slice(
    workflow.indexOf("  build:"),
    workflow.indexOf("  deploy-no-traffic:")
  );
  assert.doesNotMatch(buildJob, /id-token: write/);
  const deployJob = workflow.slice(workflow.indexOf("  deploy-no-traffic:"));
  assert.doesNotMatch(deployJob, /\bnpm (?:ci|test)\b/);

  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 7);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${action} must use an immutable SHA`);
  }
});

test("workflow can create only an observed zero-traffic candidate", () => {
  assert.match(workflow, /--image "\$IMAGE_URI@\$IMAGE_DIGEST"/);
  assert.match(workflow, /--no-traffic/);
  assert.match(
    workflow,
    /STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT_NO_DEFAULT_TRAFFIC_VERIFIED/
  );
  assert.match(workflow, /previous_revision=\$previous_revision/);
  assert.match(workflow, /actual_config_fingerprint/);
  assert.match(workflow, /actual_iam_fingerprint/);
  assert.match(workflow, /birdie_status/);
  assert.match(workflow, /meta_challenge_status/);
  assert.match(workflow, /meta_post_status/);
  assert.match(workflow, /coin_write_status/);
  assert.match(workflow, /latestRevision == true/);
  assert.match(workflow, /candidateTagBoundToRevision:true/);
  assert.match(workflow, /trafficMutation:"ZERO_PERCENT_TAG_ADDED"/);
  assert.match(workflow, /default-traffic-allocation-unchanged/);
  assert.doesNotMatch(workflow, /configMutation:"IMAGE_ONLY_VERIFIED"/);
  assert.doesNotMatch(workflow, /"traffic-unchanged"/);
  assert.doesNotMatch(workflow, /update-traffic/);
  assert.doesNotMatch(workflow, /--allow-unauthenticated/);
  assert.doesNotMatch(workflow, /--service-account/);
  assert.doesNotMatch(workflow, /--(?:set|update|clear)-(?:env-vars|secrets|labels)/);
  assert.doesNotMatch(workflow, /credentials_json/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test("stage A pins every provider coordinate and proves its narrow absent bundles", () => {
  assert.match(
    workflow,
    /RELEASE_LANE: STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT/
  );
  assert.doesNotMatch(workflow, /CAPABILITY_MODE:/);
  assert.match(
    workflow,
    /EXPECTED_WIF_PROVIDER: projects\/893591677320\/locations\/global\/workloadIdentityPools\/github-birdie-agent\/providers\/github-birdie-agent/
  );
  assert.match(
    workflow,
    /EXPECTED_DEPLOYER_SERVICE_ACCOUNT: birdie-github-deployer@gen-lang-client-0251788487\.iam\.gserviceaccount\.com/
  );
  assert.match(
    workflow,
    /EXPECTED_RUNTIME_SERVICE_ACCOUNT: 893591677320-compute@developer\.gserviceaccount\.com/
  );
  assert.match(
    workflow,
    /EXPECTED_ARTIFACT_REPOSITORY: birdie-agent-releases/
  );
  assert.match(workflow, /test "\$WIF_PROVIDER" = "\$EXPECTED_WIF_PROVIDER"/);
  assert.match(
    workflow,
    /test "\$DEPLOYER_SERVICE_ACCOUNT" = "\$EXPECTED_DEPLOYER_SERVICE_ACCOUNT"/
  );
  assert.match(
    workflow,
    /test "\$RUNTIME_SERVICE_ACCOUNT" = "\$EXPECTED_RUNTIME_SERVICE_ACCOUNT"/
  );
  assert.match(
    workflow,
    /test "\$ARTIFACT_REPOSITORY" = "\$EXPECTED_ARTIFACT_REPOSITORY"/
  );
  assert.match(
    workflow,
    /test "\$current_runtime_sa" = "\$RUNTIME_SERVICE_ACCOUNT"/
  );
  assert.doesNotMatch(workflow, /\[\[ "\$RUNTIME_SERVICE_ACCOUNT" =~/);
  assert.doesNotMatch(workflow, /\[\[ "\$WIF_PROVIDER" =~/);
  assert.doesNotMatch(workflow, /\[\[ "\$DEPLOYER_SERVICE_ACCOUNT" =~/);
  assert.doesNotMatch(workflow, /\[\[ "\$ARTIFACT_REPOSITORY" =~/);
  assert.match(
    workflow,
    /DEPLOY_BIRDIE_AGENT_STAGE_A_NO_TRAFFIC_EEAF5D7/
  );

  const requiredBlock = workflow.match(
    /done <<'STAGE_A_REQUIRED_ENV'\n([\s\S]*?)\n\s*STAGE_A_REQUIRED_ENV/
  );
  assert.ok(requiredBlock, "Stage-A required environment block must exist");
  for (const name of [
    "BIRDIE_AGENT_API_KEY",
    "BIRDIE_OS_API_KEY",
    "BIRDIE_OS_BASE",
    "OPENAI_API_KEY"
  ]) {
    assert.match(requiredBlock[1], new RegExp(`^\\s*${name}$`, "m"));
  }
  assert.match(
    workflow,
    /grep -Fxq "\$required" "\$RUNNER_TEMP\/env-names\.txt"/
  );

  const forbiddenBlock = workflow.match(
    /done <<'STAGE_A_FORBIDDEN_ENV'\n([\s\S]*?)\n\s*STAGE_A_FORBIDDEN_ENV/
  );
  assert.ok(forbiddenBlock, "Stage-A forbidden environment block must exist");
  for (const name of [
    "BIRDIE_APP_BIRDIE_ID_CLAIM",
    "BIRDIE_APP_OAUTH_AUDIENCE",
    "BIRDIE_APP_OAUTH_ISSUER",
    "BIRDIE_APP_OAUTH_JWKS_URL",
    "META_APP_SECRET",
    "META_INSTAGRAM_ACCOUNT_ID",
    "META_INSTAGRAM_USERNAME",
    "META_WEBHOOK_VERIFY_TOKEN",
    "META_INSTAGRAM_ACCESS_TOKEN"
  ]) {
    assert.match(forbiddenBlock[1], new RegExp(`^\\s*${name}$`, "m"));
  }
  assert.match(
    workflow,
    /if grep -Fxq "\$forbidden" "\$RUNNER_TEMP\/env-names\.txt"; then[\s\S]*?exit 1/
  );

  assert.match(workflow, /\.birdieWorld == "AUTH_GATE_NOT_CONFIGURED"/);
  assert.doesNotMatch(
    workflow,
    /\.birdieWorld == "AUTHENTICATED_LEDGER_PROJECTION"/
  );
  assert.doesNotMatch(workflow, /\.meta == "SIGNED_WEBHOOK_CONTROLLED"/);
  assert.match(workflow, /test "\$birdie_status" = "503"/);
  assert.match(workflow, /BIRDIE_APP_AUTH_NOT_CONFIGURED/);
  assert.match(workflow, /test "\$meta_challenge_status" = "503"/);
  assert.match(workflow, /test "\$meta_post_status" = "503"/);
  assert.match(workflow, /META_CONFIG_MISSING/);
  assert.match(workflow, /test "\$coin_write_status" = "401"/);
  assert.match(workflow, /birdie-cloud-run-no-traffic\/stage-a-v1/);
  assert.match(workflow, /--argjson rootStatus "\$ROOT_STATUS"/);
  assert.match(workflow, /--argjson healthStatus "\$HEALTH_STATUS"/);
  assert.match(workflow, /--argjson birdieWorldStatus "\$BIRDIE_WORLD_STATUS"/);
  assert.match(
    workflow,
    /--argjson metaChallengeStatus "\$META_CHALLENGE_STATUS"/
  );
  assert.match(workflow, /--argjson metaPostStatus "\$META_POST_STATUS"/);
  assert.match(workflow, /--argjson coinWriteStatus "\$COIN_WRITE_STATUS"/);
  assert.match(workflow, /trafficAuthorization/);
  assert.match(workflow, /candidatePercent/);
  assert.match(workflow, /ABSENT_VERIFIED/);
  assert.match(
    workflow,
    /authenticatedWriteSurface:"NOT_EVALUATED_EXISTING_GOVERNED_KEY"/
  );
  assert.match(workflow, /appsScriptDeployment:"NOT_EVALUATED_STAGE_A"/);
});

test("candidate evidence binds revision, zero-percent tag, route results and drift", () => {
  assert.match(
    workflow,
    /\.revisionName == \$revision and \.tag == \$tag and \(\.percent \/\/ 0\) == 0/
  );
  assert.match(
    workflow,
    /\[\.status\.traffic\[\]\? \| select\([\s\S]*?\)\] \| length\) == 1/
  );
  assert.match(
    workflow,
    /\[\.spec\.traffic\[\]\? \| select\([\s\S]*?\)\] \| length\) == 1/
  );
  assert.ok((workflow.match(/latestRevision == true/g) || []).length >= 4);
  assert.match(
    workflow,
    /traffic-after-without-candidate\.json"\n\s*cmp "\$RUNNER_TEMP\/traffic-before\.json" "\$RUNNER_TEMP\/traffic-after-without-candidate\.json"/
  );
  assert.match(
    workflow,
    /test "\$actual_config_fingerprint" = "\$EXPECTED_CONFIG_FINGERPRINT"/
  );
  assert.match(
    workflow,
    /test "\$actual_iam_fingerprint" = "\$EXPECTED_IAM_FINGERPRINT"/
  );
  assert.match(
    workflow,
    /RUNTIME_SERVICE_ACCOUNT: \$\{\{ steps\.before\.outputs\.runtime_service_account \}\}/
  );
  assert.match(workflow, /candidateUrlSha256:\$candidateUrlSha256/);
  assert.doesNotMatch(workflow, /candidateUrl:\$candidateUrl/);
  assert.match(
    workflow,
    /\.success == false and \.error == "BIRDIE_APP_AUTH_NOT_CONFIGURED"/
  );
  assert.ok(
    (workflow.match(/\.success == false and \.error == "META_CONFIG_MISSING"/g) || [])
      .length >= 2
  );
  assert.match(
    workflow,
    /\.success == false and \.error == "UNAUTHORIZED"/
  );
});

test("temporary credentials and private build context are excluded", () => {
  assert.match(gitignore, /^gha-creds-\*\.json$/m);
  assert.match(dockerignore, /^gha-creds-\*\.json$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.github$/m);
  assert.match(dockerignore, /^birdie-os$/m);
  assert.match(dockerignore, /^test$/m);
  assert.match(gcloudignore, /^gha-creds-\*\.json$/m);
  assert.match(gcloudignore, /^\.env\.\*$/m);
});

test("bootstrap contract pins immutable GitHub identity and least privilege", () => {
  assert.match(
    runbook,
    /repo:zm56snbdvp-hash\/birdie-agent:environment:birdie-cloud-run-no-traffic/
  );
  assert.match(runbook, /assertion\.repository_id == '1329217661'/);
  assert.match(runbook, /assertion\.repository_owner_id == '315131667'/);
  assert.match(runbook, /assertion\.ref == 'refs\/heads\/main'/);
  assert.match(runbook, /assertion\.event_name == 'workflow_dispatch'/);
  assert.match(runbook, /assertion\.workflow_ref == 'zm56snbdvp-hash\/birdie-agent\/\.github\/workflows\/deploy-cloud-run-no-traffic\.yml@refs\/heads\/main'/);
  assert.match(runbook, /roles\/iam\.workloadIdentityUser/);
  assert.match(runbook, /roles\/artifactregistry\.writer/);
  assert.match(runbook, /roles\/run\.developer/);
  assert.match(runbook, /roles\/iam\.serviceAccountUser/);
  assert.match(runbook, /gcloud projects get-iam-policy "\$PROJECT_ID"/);
  assert.match(runbook, /filtered project-level role export/);
  assert.match(
    runbook,
    /893591677320-compute@developer\.gserviceaccount\.com/
  );
  assert.match(runbook, /STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT/);
  assert.match(runbook, /BIRDIE_APP_AUTH_NOT_CONFIGURED/);
  assert.match(runbook, /META_CONFIG_MISSING/);
  assert.match(runbook, /does not authorize traffic/i);
  assert.match(runbook, /directly addressable/i);
  assert.match(runbook, /NOT_EVALUATED_EXISTING_GOVERNED_KEY/);
  assert.doesNotMatch(runbook, /because it cannot receive traffic/i);
  assert.doesNotMatch(runbook, /image-only Cloud Run revision/i);
  for (const variable of [
    "GCP_WIF_PROVIDER",
    "GCP_DEPLOYER_SERVICE_ACCOUNT",
    "GCP_RUNTIME_SERVICE_ACCOUNT",
    "GCP_ARTIFACT_REPOSITORY",
    "BIRDIE_NO_TRAFFIC_ENVIRONMENT_GUARD"
  ]) {
    assert.match(runbook, new RegExp(`\\b${variable}\\b`));
  }
});
