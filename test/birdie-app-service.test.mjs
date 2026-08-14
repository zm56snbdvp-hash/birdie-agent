import assert from "node:assert/strict";
import test from "node:test";

import { createBirdieAppService } from "../src/app/birdie-app-service.mjs";

function ledgerEvent(overrides = {}) {
  return {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "COMMENT-1",
    status: "APPROVED",
    approvedAt: "2026-08-14T10:00:00.000Z",
    ...overrides
  };
}

function auth(birdieId) {
  return { birdieId, subject: `auth0|${birdieId}` };
}

function memoryStorage() {
  const projections = new Map();
  const outbox = new Map();

  return {
    projections,
    outbox,

    async applyLedgerProjection({ eventId, responseId, event, response }) {
      const existing = projections.get(eventId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) {
          const error = new Error("projection conflict");
          error.code = "LEDGER_EVENT_CONFLICT";
          throw error;
        }
        return {
          created: false,
          event: existing,
          response: outbox.get(responseId).response
        };
      }

      projections.set(eventId, structuredClone(event));
      outbox.set(responseId, {
        response: structuredClone(response),
        status: "READY",
        leaseId: null,
        leaseExpiresAt: null,
        acknowledgedAt: null
      });
      return { created: true, event, response };
    },

    async listApprovedEarnEvents({ birdieId }) {
      return [...projections.values()]
        .filter((event) => event.birdieId === birdieId)
        .reverse();
    },

    async leaseNextResponse({
      birdieId,
      leaseRequestId,
      requestedAt,
      leaseSeconds
    }) {
      const now = Date.parse(requestedAt);
      const candidate = [...outbox.values()]
        .filter((record) => record.response.birdieId === birdieId)
        .sort((left, right) => left.response.responseId.localeCompare(right.response.responseId))
        .find((record) =>
          record.status === "READY" ||
          (
            record.status === "LEASED" &&
            Date.parse(record.leaseExpiresAt) <= now
          )
        );
      if (!candidate) return null;

      const leaseId = leaseRequestId.replace("lease-request:", "lease:");
      const leaseExpiresAt = new Date(now + leaseSeconds * 1000 - 1_000).toISOString();
      candidate.status = "LEASED";
      candidate.leaseId = leaseId;
      candidate.leaseExpiresAt = leaseExpiresAt;
      return {
        response: structuredClone(candidate.response),
        leaseId,
        leaseExpiresAt,
        leaseRequestId
      };
    },

    async ackResponse({ birdieId, responseId, leaseId, acknowledgedAt }) {
      const record = outbox.get(responseId);
      if (!record || record.response.birdieId !== birdieId) {
        const error = new Error("response not found in Birdie scope");
        error.code = "CROSS_BIRDIE_ACCESS";
        throw error;
      }
      if (record.status === "ACKED" && record.leaseId === leaseId) {
        return {
          acknowledged: true,
          idempotent: true,
          birdieId,
          responseId,
          acknowledgedAt: record.acknowledgedAt
        };
      }
      if (record.status !== "LEASED" || record.leaseId !== leaseId) {
        const error = new Error("lease mismatch");
        error.code = "LEASE_MISMATCH";
        throw error;
      }
      if (Date.parse(record.leaseExpiresAt) <= Date.parse(acknowledgedAt)) {
        const error = new Error("lease expired");
        error.code = "LEASE_EXPIRED";
        throw error;
      }

      record.status = "ACKED";
      record.acknowledgedAt = acknowledgedAt;
      return {
        acknowledged: true,
        idempotent: false,
        birdieId,
        responseId,
        acknowledgedAt
      };
    }
  };
}

function serviceFixture() {
  const storage = memoryStorage();
  let now = "2026-08-14T10:05:00.000Z";
  let leaseSequence = 0;
  const service = createBirdieAppService({
    storage,
    clock: () => now,
    createLeaseRequestId: () => `lease-request:test-${++leaseSequence}`,
    leaseDurationSeconds: 30
  });
  return {
    service,
    storage,
    setNow(value) {
      now = value;
    }
  };
}

test("projection persists one event and response across exact replay", async () => {
  const { service, storage } = serviceFixture();

  const first = await service.projectLedgerEvent(ledgerEvent());
  const replay = await service.projectLedgerEvent(ledgerEvent());

  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(first.eventId, "coin:TX-1");
  assert.equal(first.responseId, "birdie-response:TX-1");
  assert.deepEqual(replay.progress, first.progress);
  assert.equal(storage.projections.size, 1);
  assert.equal(storage.outbox.size, 1);
});

test("world reads are derived only from the authenticated Birdie scope", async () => {
  const { service } = serviceFixture();
  await service.projectLedgerEvent(ledgerEvent());
  await service.projectLedgerEvent(ledgerEvent({
    transactionId: "TX-2",
    birdieId: "BIRDIE-2",
    sourceReference: "COMMENT-2"
  }));

  const firstWorld = await service.getWorld(auth("BIRDIE-1"));
  const secondWorld = await service.getWorld(auth("BIRDIE-2"));

  assert.deepEqual(firstWorld.appliedEventIds, ["coin:TX-1"]);
  assert.deepEqual(secondWorld.appliedEventIds, ["coin:TX-2"]);
  await assert.rejects(service.getWorld(), { code: "BIRDIE_APP_UNAUTHENTICATED" });
  await assert.rejects(
    service.leaseNextResponse(
      auth("BIRDIE-1"),
      { birdieId: "BIRDIE-2" }
    ),
    { code: "CLIENT_BIRDIE_ID_FORBIDDEN", status: 403 }
  );
});

test("a response is leased once, ACKed exactly and absent after ACK", async () => {
  const { service } = serviceFixture();
  const session = auth("BIRDIE-1");
  await service.projectLedgerEvent(ledgerEvent());

  const lease = await service.leaseNextResponse(session);
  assert.equal(lease.response.text, "+1 Birdie ist angekommen.");
  assert.equal(lease.leaseId, "lease:test-1");
  assert.equal(await service.leaseNextResponse(session), null);

  const ack = await service.ackResponse(session, {
    responseId: lease.response.responseId,
    leaseId: lease.leaseId
  });
  assert.equal(ack.acknowledged, true);
  assert.equal(ack.idempotent, false);

  const ackReplay = await service.ackResponse(session, {
    responseId: lease.response.responseId,
    leaseId: lease.leaseId
  });
  assert.equal(ackReplay.idempotent, true);
  assert.equal(await service.leaseNextResponse(session), null);
});

test("expired leases can be recovered but the previous lease cannot ACK", async () => {
  const { service, setNow } = serviceFixture();
  const session = auth("BIRDIE-1");
  await service.projectLedgerEvent(ledgerEvent());
  const oldLease = await service.leaseNextResponse(session);

  setNow("2026-08-14T10:06:00.000Z");
  const recoveredLease = await service.leaseNextResponse(session);
  assert.equal(recoveredLease.response.responseId, oldLease.response.responseId);
  assert.notEqual(recoveredLease.leaseId, oldLease.leaseId);

  await assert.rejects(
    service.ackResponse(session, {
      responseId: oldLease.response.responseId,
      leaseId: oldLease.leaseId
    }),
    { code: "LEASE_MISMATCH" }
  );
});

test("another Birdie cannot lease or acknowledge a foreign response", async () => {
  const { service } = serviceFixture();
  await service.projectLedgerEvent(ledgerEvent());
  const lease = await service.leaseNextResponse(auth("BIRDIE-1"));

  assert.equal(
    await service.leaseNextResponse(auth("BIRDIE-2")),
    null
  );
  await assert.rejects(
    service.ackResponse(
      auth("BIRDIE-2"),
      { responseId: lease.response.responseId, leaseId: lease.leaseId }
    ),
    { code: "CROSS_BIRDIE_ACCESS" }
  );
});
