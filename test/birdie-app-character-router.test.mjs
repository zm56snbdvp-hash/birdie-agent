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

test("character route rejects client birdieId query scope before persistence", async () => {
  const req = { method: "GET", headers: {} };
  const res = mockResponse();
  const url = new URL("https://example.test/birdie-app/v1/character?birdieId=other");
  await assert.rejects(
    routeBirdieAppRequest({
      req,
      res,
      url,
      json,
      readBody: async () => ({}),
      service: {},
      authenticateBirdie: async () => ({ birdieId: "birdie-1", subject: "user-1" })
    }),
    (error) => error?.code === "CLIENT_BIRDIE_ID_FORBIDDEN" && error?.status === 403
  );
});
