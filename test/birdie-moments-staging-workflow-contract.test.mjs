import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/birdie-moments-staging-bootstrap.yml", import.meta.url), "utf8");

test("staging provider bootstrap is manual-only and defaults to dry-run", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /default:\s*dry-run/);
  assert.match(workflow, /-\s*apply-app-store/);
});

test("App Store mutation runs only after explicit apply-app-store input", () => {
  assert.match(workflow, /if \[\[ "\$\{\{ inputs\.action \}\}" == "apply-app-store" \]\]; then/);
  assert.match(workflow, /npm run moments:staging:apply-app-store/);
  assert.match(workflow, /else\n\s+npm run moments:staging:check/);
});

test("workflow consumes provider credentials from GitHub secrets and never passes them as CLI arguments", () => {
  for (const secret of [
    "APP_STORE_CONNECT_ISSUER_ID",
    "APP_STORE_CONNECT_KEY_ID",
    "APP_STORE_CONNECT_PRIVATE_KEY",
    "GELATO_API_KEY"
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
    assert.doesNotMatch(workflow, new RegExp(`--[^\\n]*${secret}`));
  }
  assert.match(workflow, /environment:\s*birdie-moments-staging/);
});

test("uploaded receipt is sanitized and excludes raw provider result", () => {
  assert.match(workflow, /birdie-moments-staging-summary\.json/);
  assert.doesNotMatch(workflow, /path:\s*birdie-moments-staging-result\.json/);
  assert.match(workflow, /candidateCount/);
  assert.doesNotMatch(workflow, /apiKey:\s*input/);
  assert.doesNotMatch(workflow, /privateKey:\s*input/);
});
