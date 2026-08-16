import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/deploy-meta-live.yml", import.meta.url)
);

test("Meta deploy workflow binds the verified Page route and secret-only OAuth inputs", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  for (const expected of [
    "META_APP_ID: '1028523216674895'",
    "META_INSTAGRAM_ACCOUNT_ID: '17841440257520993'",
    "META_MESSAGING_ACCOUNT_ID: '1265475843314216'",
    "META_MESSAGING_GRAPH_HOST: graph.facebook.com",
    "META_OAUTH_PAGE_ID: '1265475843314216'",
    "META_OAUTH_INSTAGRAM_ACCOUNT_ID: '17841440257520993'",
    "META_OAUTH_REDIRECT_URI: https://birdie-agent-893591677320.europe-west3.run.app/meta/oauth/callback",
    "META_API_VERSION: v26.0"
  ]) {
    assert.equal(workflow.includes(expected), true, `missing ${expected}`);
  }

  for (const secret of [
    "META_APP_SECRET",
    "META_WEBHOOK_VERIFY_TOKEN",
    "META_MESSAGING_ACCESS_TOKEN",
    "META_OAUTH_STATE_SECRET"
  ]) {
    assert.match(workflow, new RegExp(`${secret}=${secret}:latest`));
    assert.match(workflow, new RegExp(`for secret in[^\\n]*${secret}`));
  }

  assert.equal(workflow.includes("META_INSTAGRAM_ACCESS_TOKEN"), false);
  assert.equal(workflow.includes("page-access-token"), false);
  assert.equal(workflow.includes("APP_SECRET_CANARY"), false);
});
