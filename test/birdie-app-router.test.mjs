import assert from "node:assert/strict";
import test from "node:test";

import { routeBirdieAppRequest } from "../src/app/birdie-app-router.mjs";

function responseRecorder() {
  const calls = [];
  return {
    calls,
    json(_res, status, body) {
      calls.push({ status, body });
    }
  };
}

function routeFixture(overrides = {}) {
  const recorder = responseRecorder();
  const calls = [];
  const body = overrides.body || {};
  return {
    calls,
    recorder,
    input: {
      req: { method: overrides.method || "GET", headers: {} },
      res: {},
      url: new URL(`http://localhost${overrides.path || "/birdie-app/v1/world"}`),
      json: recorder.json,
      readBody: async () => body,
      authenticateBirdie: async () => ({
        birdieId: "BIRDIE-1",
        subject: "auth0|birdie-1"
      }),
      service: {
        async getWorld(auth) {
          calls.push(["world", auth]);
          return { birdieId: auth.birdieId, revision: 0 };
        },
        async leaseNextResponse(auth, input) {
          calls.push(["lease", auth, input]);
          return null;
        },
        async ackResponse(auth, input) {
          calls.push(["ack", auth, input]);
          return { responseId: input.responseId, acknowledged: true };
        }
      }
    }
  };
}

test("non-Birdie-app routes are ignored", async () => {
  const fixture = routeFixture({ path: "/health" });
  assert.equal(await routeBirdieAppRequest(fixture.input), false);
  assert.equal(fixture.recorder.calls.length, 0);

  const otherVersion = routeFixture({ path: "/birdie-app/v10/world" });
  assert.equal(await routeBirdieAppRequest(otherVersion.input), false);
  assert.equal(otherVersion.recorder.calls.length, 0);
});

test("world route uses only authenticated session scope", async () => {
  const fixture = routeFixture();
  assert.equal(await routeBirdieAppRequest(fixture.input), true);
  assert.deepEqual(fixture.calls, [["world", {
    birdieId: "BIRDIE-1",
    subject: "auth0|birdie-1"
  }]]);
  assert.deepEqual(fixture.recorder.calls[0], {
    status: 200,
    body: {
      success: true,
      source: "BIRDIE_WORLD_PROJECTION",
      data: { birdieId: "BIRDIE-1", revision: 0 }
    }
  });

  const malicious = routeFixture({ path: "/birdie-app/v1/world?birdieId=BIRDIE-2" });
  await assert.rejects(
    routeBirdieAppRequest(malicious.input),
    { code: "CLIENT_BIRDIE_ID_FORBIDDEN", status: 403 }
  );
});

test("lease route forwards body under the authenticated scope", async () => {
  const body = { clientRequestId: "render-1" };
  const fixture = routeFixture({
    method: "POST",
    path: "/birdie-app/v1/responses/lease",
    body
  });
  await routeBirdieAppRequest(fixture.input);
  assert.deepEqual(fixture.calls, [[
    "lease",
    { birdieId: "BIRDIE-1", subject: "auth0|birdie-1" },
    body
  ]]);
  assert.equal(fixture.recorder.calls[0].status, 200);
});

test("ACK responseId comes from the route and cannot be overridden by body", async () => {
  const fixture = routeFixture({
    method: "POST",
    path: "/birdie-app/v1/responses/birdie-response%3ATX-1/ack",
    body: {
      responseId: "birdie-response:TX-FOREIGN",
      leaseId: "lease:test-1"
    }
  });
  await routeBirdieAppRequest(fixture.input);
  assert.deepEqual(fixture.calls, [[
    "ack",
    { birdieId: "BIRDIE-1", subject: "auth0|birdie-1" },
    {
      responseId: "birdie-response:TX-1",
      leaseId: "lease:test-1"
    }
  ]]);
});

test("unknown Birdie-app routes return a bounded 404", async () => {
  const fixture = routeFixture({ path: "/birdie-app/v1/unknown" });
  assert.equal(await routeBirdieAppRequest(fixture.input), true);
  assert.deepEqual(fixture.recorder.calls[0], {
    status: 404,
    body: {
      success: false,
      error: "BIRDIE_APP_ROUTE_NOT_FOUND"
    }
  });
});
