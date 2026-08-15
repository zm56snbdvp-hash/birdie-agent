import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../birdie-os/social-outreach-events.gs", import.meta.url), "utf8");

test("social outreach adapter is durable, idempotent and economically inert", () => {
  assert.match(source, /SOCIAL_OUTREACH_EVENTS/);
  assert.match(source, /appendSocialOutreachEvent/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /SOCIAL_OUTREACH_ECONOMIC_AUTHORITY_FORBIDDEN/);
  assert.match(source, /LockService\.getScriptLock/);
});
