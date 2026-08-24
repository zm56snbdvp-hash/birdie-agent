import assert from "node:assert/strict";
import test from "node:test";

import { routeBirdieAppRequest } from "../src/app/birdie-app-router.mjs";

function mockResponse() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; }
  };
}

function json(res, status, body) {
  res.status = status;
  res.body = body;
}

function routeOptions({ method = "GET", body = {}, url = "/birdie-app/v1/character" } = {}) {
  const req = { method, headers: {} };
  const res = mockResponse();
  return {
    req,
    res,
    url: new URL(url, "https://example.test"),
    json,
    readBody: async () => body,
    service: {},
    coinService: {},
    authenticateBirdie: async () => ({ birdieId: "birdie-1", subject: "user-1" })
  };
}

async function withMockedBirdieOS(data, run) {
  const previousBase = process.env.BIRDIE_OS_BASE;
  const previousKey = process.env.BIRDIE_OS_API_KEY;
  const previousFetch = globalThis.fetch;
  const calls = [];
  process.env.BIRDIE_OS_BASE = "https://birdie-os.example.test/exec";
  process.env.BIRDIE_OS_API_KEY = "test-key";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ success: true, data }); }
    };
  };
  try {
    await run(calls);
  } finally {
    if (previousBase === undefined) delete process.env.BIRDIE_OS_BASE;
    else process.env.BIRDIE_OS_BASE = previousBase;
    if (previousKey === undefined) delete process.env.BIRDIE_OS_API_KEY;
    else process.env.BIRDIE_OS_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
}

test("character route rejects client birdieId query scope before persistence", async () => {
  const options = routeOptions({ url: "/birdie-app/v1/character?birdieId=other" });
  await assert.rejects(
    routeBirdieAppRequest(options),
    (error) => error?.code === "CLIENT_BIRDIE_ID_FORBIDDEN" && error?.status === 403
  );
});

test("character GET derives identity from auth and redacts BirdieOS scope fields", async () => {
  await withMockedBirdieOS({
    birdieId: "birdie-1",
    characterId: "a".repeat(32),
    displayName: "Kevin",
    story: "ENTDECKER",
    color: "FOREST",
    coinBalance: 999
  }, async (calls) => {
    const options = routeOptions();
    assert.equal(await routeBirdieAppRequest(options), true);
    assert.equal(options.res.status, 200);
    assert.deepEqual(options.res.body.data, {
      characterId: "a".repeat(32),
      displayName: "Kevin",
      story: "ENTDECKER",
      color: "FOREST"
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      action: "worldGetCharacter",
      authSubject: "user-1",
      authBirdieId: "birdie-1",
      source: "Birdie Agent BirdieWorld V1"
    });
  });
});

test("character POST forwards only the cosmetic allowlist and returns the server identity", async () => {
  await withMockedBirdieOS({
    birdieId: "birdie-1",
    characterId: "b".repeat(32),
    displayName: "Kevin",
    story: "STRATEGE",
    style: "CLASSIC",
    color: "MIDNIGHT",
    createdAt: "2026-08-24T17:00:00.000Z",
    updatedAt: "2026-08-24T17:01:00.000Z",
    schemaVersion: "birdieworld-character/v1"
  }, async (calls) => {
    const options = routeOptions({
      method: "POST",
      body: {
        character: {
          displayName: "Kevin",
          story: "STRATEGE",
          style: "CLASSIC",
          color: "MIDNIGHT"
        }
      }
    });
    assert.equal(await routeBirdieAppRequest(options), true);
    const forwarded = JSON.parse(calls[0].options.body);
    assert.deepEqual(forwarded.character, {
      displayName: "Kevin",
      story: "STRATEGE",
      style: "CLASSIC",
      color: "MIDNIGHT"
    });
    assert.equal(forwarded.authBirdieId, "birdie-1");
    assert.equal(options.res.body.data.characterId, "b".repeat(32));
    assert.equal(Object.hasOwn(options.res.body.data, "birdieId"), false);
  });
});

test("character POST rejects nested identity and economic fields", async () => {
  const nestedIdentity = routeOptions({
    method: "POST",
    body: { character: { displayName: "Kevin", birdieId: "other" } }
  });
  await assert.rejects(
    routeBirdieAppRequest(nestedIdentity),
    (error) => error?.code === "CLIENT_BIRDIE_ID_FORBIDDEN" && error?.status === 403
  );

  const economicState = routeOptions({
    method: "POST",
    body: { character: { displayName: "Kevin", coinBalance: 999 } }
  });
  await assert.rejects(
    routeBirdieAppRequest(economicState),
    (error) => error?.code === "CHARACTER_FIELD_FORBIDDEN" && error?.status === 400
  );

  const clientCharacterId = routeOptions({
    method: "POST",
    body: { character: { displayName: "Kevin", characterId: "c".repeat(32) } }
  });
  await assert.rejects(
    routeBirdieAppRequest(clientCharacterId),
    (error) => error?.code === "CHARACTER_FIELD_FORBIDDEN" && error?.status === 400
  );

  const formulaName = routeOptions({
    method: "POST",
    body: { character: { displayName: "=IMPORTXML()" } }
  });
  await assert.rejects(
    routeBirdieAppRequest(formulaName),
    (error) => error?.code === "INVALID_CHARACTER_NAME" && error?.status === 400
  );

  const structuredStyle = routeOptions({
    method: "POST",
    body: { character: { displayName: "Kevin", style: { name: "classic" } } }
  });
  await assert.rejects(
    routeBirdieAppRequest(structuredStyle),
    (error) => error?.code === "INVALID_CHARACTER_FIELD" && error?.status === 400
  );
});
