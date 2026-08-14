import assert from "node:assert/strict";
import test from "node:test";

import { routeCoinRequest } from "../src/coin/router.mjs";

function responseRecorder() {
  const calls = [];
  return {
    calls,
    json(_res, status, body) {
      calls.push({ status, body });
    }
  };
}

test("non-Coin routes are ignored", async () => {
  const handled = await routeCoinRequest({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/health"),
    json() {},
    readBody: async () => ({}),
    service: {}
  });
  assert.equal(handled, false);
});

test("Coin config returns the public configuration contract", async () => {
  const recorder = responseRecorder();
  const handled = await routeCoinRequest({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/coin/config"),
    json: recorder.json,
    readBody: async () => ({}),
    service: { getConfig: () => ({ unit: { singular: "Birdie" } }) }
  });
  assert.equal(handled, true);
  assert.equal(recorder.calls[0].status, 200);
  assert.equal(recorder.calls[0].body.source, "BIRDIE_COIN_CONFIG");
});

test("claim creation returns authoritative Birdie OS data", async () => {
  const recorder = responseRecorder();
  const handled = await routeCoinRequest({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/coin/claims"),
    json: recorder.json,
    readBody: async () => ({ birdieId: "BIRDIE-1" }),
    service: { createClaim: async () => ({ claimId: "CLAIM-1" }) }
  });
  assert.equal(handled, true);
  assert.equal(recorder.calls[0].status, 201);
  assert.equal(recorder.calls[0].body.source, "BIRDIE_OS");
  assert.equal(recorder.calls[0].body.data.claimId, "CLAIM-1");
});

test("admin queue route forwards the Birdie OS queue", async () => {
  const recorder = responseRecorder();
  await routeCoinRequest({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/coin/admin/queue"),
    json: recorder.json,
    readBody: async () => ({}),
    service: { getAdminQueue: async () => ({ claims: [], redemptions: [] }) }
  });
  assert.deepEqual(recorder.calls[0].body.data, { claims: [], redemptions: [] });
});

test("existing profile Instagram route links through the Coin service", async () => {
  const recorder = responseRecorder();
  const body = {
    instagramHandle: "@second.shot.kev",
    idempotencyKey: "profile-instagram:BIRDIE-123:second.shot.kev"
  };
  const calls = [];

  const handled = await routeCoinRequest({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/coin/profiles/BIRDIE-123/instagram"),
    json: recorder.json,
    readBody: async () => body,
    service: {
      async linkInstagramHandle(birdieId, input) {
        calls.push({ birdieId, input });
        return { profile: { birdieId }, idempotent: false };
      }
    }
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [{ birdieId: "BIRDIE-123", input: body }]);
  assert.equal(recorder.calls[0].status, 200);
});
