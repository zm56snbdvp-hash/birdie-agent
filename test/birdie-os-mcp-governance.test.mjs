import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mcpSource = fs.readFileSync(new URL("../src/mcp-server.mjs", import.meta.url), "utf8");
const authSource = fs.readFileSync(new URL("../src/mcp-auth.mjs", import.meta.url), "utf8");

test("BirdieOS MCP V1 exposes canonical startup and read tools", () => {
  for (const tool of [
    "birdie_os_startup",
    "birdie_os_health",
    "birdie_os_briefing",
    "birdie_os_next_task",
    "birdie_framer_config",
    "birdie_framer_status"
  ]) {
    assert.match(mcpSource, new RegExp(`\\"${tool}\\"`));
  }
});

test("BirdieOS MCP V1 does not expose Framer mutation or publication tools", () => {
  for (const forbidden of [
    "birdie_framer_apply",
    "birdie_framer_preview",
    "birdie_framer_deploy",
    "PUBLISH_FRAMER_PREVIEW",
    "DEPLOY_FRAMER_PRODUCTION",
    "APPLY_FRAMER_CMS_CHANGE"
  ]) {
    assert.doesNotMatch(mcpSource, new RegExp(forbidden));
  }
});

test("BirdieOS startup path is GET-only", () => {
  assert.match(mcpSource, /birdieOsReader\.get\("health"\)/);
  assert.match(mcpSource, /birdieOsReader\.get\("briefing"\)/);
  assert.match(mcpSource, /birdieOsReader\.get\("nextTask"\)/);
  assert.doesNotMatch(mcpSource, /birdieOsReader\.post/);
});

test("OAuth metadata advertises separated OS and Framer read scopes", () => {
  assert.match(authSource, /"os\.read"/);
  assert.match(authSource, /"framer\.read"/);
  assert.match(authSource, /MCP_SCOPES/);
});

test("MCP source never exposes runtime secret values", () => {
  assert.doesNotMatch(mcpSource, /secretExposed:\s*true/);
  assert.doesNotMatch(mcpSource, /FRAMER_API_KEY/);
  assert.doesNotMatch(mcpSource, /BIRDIE_AGENT_API_KEY/);
});
