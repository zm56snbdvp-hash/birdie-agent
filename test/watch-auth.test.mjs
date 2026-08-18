import test from "node:test";
import assert from "node:assert/strict";
import { authenticateWatchRequest, createWatchAuthConfig } from "../src/watch-auth.mjs";

test("watch auth is disabled for missing or weak keys", () => {
  assert.equal(createWatchAuthConfig({}).enabled, false);
  assert.equal(createWatchAuthConfig({ BIRDIE_WATCH_API_KEY: "short" }).enabled, false);
});

test("watch auth accepts only exact bearer token", () => {
  const key = "w".repeat(48);
  const config = createWatchAuthConfig({ BIRDIE_WATCH_API_KEY: key });
  assert.equal(config.enabled, true);
  assert.equal(authenticateWatchRequest({ headers: { authorization: `Bearer ${key}` } }, config), true);
  assert.equal(authenticateWatchRequest({ headers: { authorization: "Bearer wrong" } }, config), false);
  assert.equal(authenticateWatchRequest({ headers: {} }, config), false);
});
