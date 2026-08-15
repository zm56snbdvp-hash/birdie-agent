import assert from "node:assert/strict";
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
  assert.match(workflow, /test "\$CONFIRMATION" = "DEPLOY_BIRDIE_AGENT_NO_TRAFFIC_EEAF5D7"/);
  assert.match(workflow, /test "\$RELEASE_SHA_INPUT" = "\$RELEASE_SHA"/);
  assert.match(workflow, /APPS_SCRIPT_RECEIPT_SHA256/);
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

test("operator entrypoint points at the 2.9.0 governed lane", () => {
  assert.match(readme, /Current service version: \*\*2\.9\.0\*\*/);
  assert.match(readme, /github-oidc-cloud-run-no-traffic\.md/);
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
  assert.match(workflow, /NO_TRAFFIC_VERIFIED/);
  assert.match(workflow, /previous_revision=\$previous_revision/);
  assert.match(workflow, /actual_config_fingerprint/);
  assert.match(workflow, /actual_iam_fingerprint/);
  assert.match(workflow, /birdie_status/);
  assert.match(workflow, /meta_status/);
  assert.match(workflow, /appsScriptReceipt/);
  assert.match(workflow, /latestRevision == true/);
  assert.doesNotMatch(workflow, /update-traffic/);
  assert.doesNotMatch(workflow, /--allow-unauthenticated/);
  assert.doesNotMatch(workflow, /--service-account/);
  assert.doesNotMatch(workflow, /--(?:set|update|clear)-(?:env-vars|secrets|labels)/);
  assert.doesNotMatch(workflow, /credentials_json/);
  assert.doesNotMatch(workflow, /secrets\./);
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
