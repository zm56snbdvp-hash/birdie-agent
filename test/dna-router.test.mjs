import test from "node:test";
import assert from "node:assert/strict";
import { routeDnaRequest } from "../src/dna/router.mjs";

function responseHarness() {
  const calls = [];
  return {
    calls,
    json(_res, status, body) {
      calls.push({ status, body });
    }
  };
}

test("DNA router ignores non-DNA paths", async () => {
  const { json, calls } = responseHarness();
  const handled = await routeDnaRequest({
    req: { method: "GET" },
    res: {},
    url: new URL("http://birdie.local/coin/config"),
    json,
    readBody: async () => ({}),
    service: {}
  });
  assert.equal(handled, false);
  assert.equal(calls.length, 0);
});

test("DNA config route returns governed config", async () => {
  const { json, calls } = responseHarness();
  const handled = await routeDnaRequest({
    req: { method: "GET" },
    res: {},
    url: new URL("http://birdie.local/dna/config"),
    json,
    readBody: async () => ({}),
    service: { getConfig: () => ({ principles: { directCoinWrites: false } }) }
  });
  assert.equal(handled, true);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].body.source, "BIRDIE_DNA_CONFIG");
  assert.equal(calls[0].body.data.principles.directCoinWrites, false);
});

test("DNA event route forwards object id and body", async () => {
  const { json, calls } = responseHarness();
  const serviceCalls = [];
  await routeDnaRequest({
    req: { method: "POST" },
    res: {},
    url: new URL("http://birdie.local/dna/objects/DNA-ABC/events"),
    json,
    readBody: async () => ({ eventType: "COURSE_VISIT" }),
    service: {
      async createEvent(objectId, body) {
        serviceCalls.push({ objectId, body });
        return { eventId: "EVT-1" };
      }
    }
  });
  assert.deepEqual(serviceCalls[0], {
    objectId: "DNA-ABC",
    body: { eventType: "COURSE_VISIT" }
  });
  assert.equal(calls[0].status, 201);
  assert.equal(calls[0].body.data.eventId, "EVT-1");
});
