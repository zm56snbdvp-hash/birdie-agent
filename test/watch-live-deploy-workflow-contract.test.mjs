import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/deploy-watch-live.yml",
  "utf8"
).replace(/\r\n/g, "\n");

const productionServiceWorkflows = [
  ".github/workflows/deploy-cloud-run-no-traffic.yml",
  ".github/workflows/deploy-meta-live.yml",
  ".github/workflows/deploy-watch-live.yml"
].map((path) => ({
  path,
  source: readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}));

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

test("Watch production release is manual and bound to exact protected main", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /test "\$REF_PROTECTED" = "true"/);
  assert.match(workflow, /test "\$RELEASE_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /DEPLOY_BIRDIE_WATCH_PRODUCTION/);
  assert.match(workflow, /environment:\n      name: birdie-watch-live/);
  assert.match(workflow, /BIRDIE_WATCH_ENVIRONMENT_GUARD/);
  assert.match(workflow, /BIRDIE_WATCH_PROTECTED_V1/);
});

test("all active production mutations share one lock and the one-time lane is retired", () => {
  for (const { path, source } of productionServiceWorkflows) {
    assert.match(
      source,
      /concurrency:\n  group: birdie-agent-production-service\n  cancel-in-progress: false/,
      path
    );
  }
  assert.equal(existsSync(".github/workflows/framer-v4-zero-traffic-once.yml"), false);
});

test("full tests precede a credential-free immutable image build", () => {
  const npmCi = workflow.indexOf("npm ci");
  const npmTest = workflow.indexOf("npm test");
  const dockerBuild = workflow.indexOf("docker build");
  const cloudAuth = workflow.indexOf("google-github-actions/auth@");
  assert.ok(npmCi > 0 && npmCi < npmTest);
  assert.ok(npmTest < dockerBuild);
  assert.ok(dockerBuild < cloudAuth);
  assert.match(workflow, /docker save "birdie-watch-release:\$GITHUB_SHA"/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /gcloud secrets versions add/);
  assert.doesNotMatch(workflow, /data-file=-/);
});

test("provider and runtime coordinates stay exact", () => {
  assert.match(workflow, /GCP_PROJECT_ID: gen-lang-client-0251788487/);
  assert.match(workflow, /GCP_PROJECT_NUMBER: "893591677320"/);
  assert.match(workflow, /GCP_REGION: europe-west3/);
  assert.match(workflow, /CLOUD_RUN_SERVICE: birdie-agent/);
  assert.match(workflow, /ARTIFACT_REPOSITORY: birdie-agent-releases/);
  assert.match(workflow, /github-birdie-agent\/providers\/github-birdie-watch/);
  assert.match(workflow, /birdie-github-deployer@gen-lang-client-0251788487\.iam\.gserviceaccount\.com/);
  assert.match(workflow, /893591677320-compute@developer\.gserviceaccount\.com/);
  assert.match(workflow, /WATCH_SECRET: birdie-watch-api-key/);
  assert.match(workflow, /id: watch_secret/);
  assert.match(workflow, /secret_version_resource=.*versions describe latest/);
  assert.match(workflow, /\^\[1-9\]\[0-9\]\*\$/);
  assert.match(workflow, /secret_state.*ENABLED/s);
});

test("Watch candidate is secret-bound and proven at zero traffic before promotion", () => {
  const deployCandidate = workflow.indexOf("Deploy configured Watch candidate at zero traffic");
  const verifyCandidate = workflow.indexOf("Verify scoped Watch candidate");
  const promote = workflow.indexOf("Promote exact verified Watch revision to production");
  assert.ok(deployCandidate > 0 && deployCandidate < verifyCandidate);
  assert.ok(verifyCandidate < promote);
  assert.match(workflow, /--revision-suffix "\$revision_suffix"/);
  assert.match(workflow, /--tag "\$candidate_tag"/);
  assert.match(workflow, /--no-traffic/);
  assert.match(workflow, /--update-secrets "BIRDIE_WATCH_API_KEY=\$WATCH_SECRET:\$WATCH_SECRET_VERSION"/);
  assert.match(workflow, /\.valueFrom\.secretKeyRef\.key == \$secret_version/);
  assert.doesNotMatch(workflow, /BIRDIE_WATCH_API_KEY=\$WATCH_SECRET:latest/);
  assert.match(workflow, /\.watch == "SCOPED_AUTH_READY"/);
  assert.match(workflow, /GET \/watch\/briefing/);
  assert.match(workflow, /POST \/watch\/command/);
  assert.match(workflow, /POST \/watch\/mail\/reply/);
  assert.match(workflow, /test "\$status" = "401"/);
  assert.match(workflow, /\.error == "WATCH_UNAUTHORIZED"/);
  assert.match(workflow, /--to-revisions "\$REVISION=100"/);
  assert.doesNotMatch(workflow, /--allow-unauthenticated/);
});

test("previous revision, IAM and runtime identity are captured and verified", () => {
  assert.match(workflow, /service-before\.json/);
  assert.match(workflow, /previous_revision=/);
  assert.match(workflow, /runtime_service_account=/);
  assert.match(workflow, /iam-before-normalized\.json/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/iam-before-normalized\.json" "\$RUNNER_TEMP\/iam-candidate-normalized\.json"/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/iam-before-normalized\.json" "\$RUNNER_TEMP\/iam-live-normalized\.json"/);
  assert.match(workflow, /live_runtime_sa/);
  assert.match(workflow, /length == 1 and \.\[0\]\.revisionName == \$revision and \.\[0\]\.percent == 100/);
  assert.match(workflow, /--to-revisions "\$PREVIOUS_REVISION=100"/);
  assert.match(workflow, /steps\.promote\.outcome == 'failure'/);
  assert.match(workflow, /steps\.verify_live\.outcome != 'success'/);
  assert.match(workflow, /service-rollback\.json/);
});

test("all actions are immutable and all embedded shell blocks parse", () => {
  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 7);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
  }
  const blocks = extractRunBlocks(workflow);
  assert.ok(blocks.length >= 14);
  for (const [index, block] of blocks.entries()) {
    const parsed = spawnSync("bash", ["-n"], { encoding: "utf8", input: block });
    assert.equal(parsed.status, 0, `run block ${index + 1}: ${parsed.stderr}`);
  }
});
