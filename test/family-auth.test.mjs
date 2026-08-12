import test from "node:test";
import assert from "node:assert/strict";
import { isFamilyAuthorized } from "../src/family/family-auth.mjs";

function req(headers = {}) {
  return { headers };
}

test("family auth accepts its dedicated bearer key", () => {
  assert.equal(isFamilyAuthorized(req({ authorization: "Bearer family-key" }), "family-key"), true);
});

test("family auth accepts dedicated custom header", () => {
  assert.equal(isFamilyAuthorized(req({ "x-birdie-family-key": "family-key" }), "family-key"), true);
});

test("family auth rejects missing, wrong and founder-style keys", () => {
  assert.equal(isFamilyAuthorized(req({}), "family-key"), false);
  assert.equal(isFamilyAuthorized(req({ authorization: "Bearer wrong-key" }), "family-key"), false);
  assert.equal(isFamilyAuthorized(req({ "x-birdie-agent-key": "founder-key" }), "family-key"), false);
  assert.equal(isFamilyAuthorized(req({ authorization: "Bearer family-key" }), ""), false);
});
