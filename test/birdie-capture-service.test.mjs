import assert from "node:assert/strict";
import test from "node:test";

import { createBirdieCaptureService, BirdieCaptureError } from "../src/app/birdie-capture-service.mjs";

const captureID = "4d36e967-e325-11ce-bfc1-08002be10318";
const auth = { birdieId: "BIRDIE-1", subject: "auth0|birdie-1" };

function body(overrides = {}) {
  return {
    contract: "birdie.capture.v1",
    captureID,
    idempotencyKey: `capture.v1.${captureID}`,
    createdAt: "2026-08-28T00:00:00.000Z",
    source: "share",
    intent: "remember",
    parts: [{
      partID: "4d36e967-e325-11ce-bfc1-08002be10319",
      kind: "text",
      displayName: "Shared text",
      contentType: "text/plain",
      byteCount: 5
    }],
    derivedText: "hello",
    suggestions: [],
    requiresUserReview: true,
    originalPolicy: "derivedTextOnly",
    ...overrides
  };
}

function storageFixture() {
  const records = new Map();
  return {
    records,
    findByCaptureID: async (id) => records.get(id) || null,
    create: async (record) => {
      if (records.has(record.captureID)) throw Object.assign(new Error("already exists"), { code: "already_exists" });
      records.set(record.captureID, record);
      return record;
    },
    delete: async (id) => records.delete(id)
  };
}

test("capture service creates and idempotently replays the same request", async () => {
  const storage = storageFixture();
  const service = createBirdieCaptureService({ storage, clock: () => new Date("2026-08-28T00:00:00Z") });
  const first = await service.submit(auth, body());
  const second = await service.submit(auth, body());
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.serverReceiptID, `capture-receipt:${captureID}`);
  assert.equal(storage.records.size, 1);
});

test("capture service rejects digest conflicts and cross-Birdie access", async () => {
  const storage = storageFixture();
  const service = createBirdieCaptureService({ storage });
  await service.submit(auth, body());
  await assert.rejects(service.submit(auth, body({ derivedText: "changed" })),
    (error) => error instanceof BirdieCaptureError && error.code === "CAPTURE_IDEMPOTENCY_CONFLICT" && error.status === 409);
  await assert.rejects(service.submit({ birdieId: "BIRDIE-2", subject: "auth0|birdie-2" }, body()),
    (error) => error instanceof BirdieCaptureError && error.code === "CAPTURE_SCOPE_CONFLICT" && error.status === 403);
});

test("capture service fails closed for originals, review bypass and client identity", async () => {
  const service = createBirdieCaptureService({ storage: storageFixture() });
  for (const overrides of [
    { originalPolicy: "includeOriginals" },
    { requiresUserReview: false },
    { birdieId: "ATTACKER" }
  ]) await assert.rejects(service.submit(auth, body(overrides)), BirdieCaptureError);
});

test("capture service deletes only an authenticated owner's record", async () => {
  const storage = storageFixture();
  const service = createBirdieCaptureService({ storage });
  await service.submit(auth, body());
  assert.deepEqual(await service.remove(auth, captureID), { captureID, deleted: true });
  assert.deepEqual(await service.remove(auth, captureID), { captureID, deleted: false });
});
