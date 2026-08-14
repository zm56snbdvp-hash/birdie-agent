import assert from "node:assert/strict";
import test from "node:test";

import { createBirdieOsWorldStorage } from "../src/app/birdie-os-world-storage.mjs";

function transaction(overrides = {}) {
  return {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "COMMENT-1",
    status: "APPROVED",
    createdAt: "2026-08-14T10:00:00.000Z",
    approvedAt: "2026-08-14T10:01:00.000Z",
    ...overrides
  };
}

function fixture() {
  const getCalls = [];
  const postCalls = [];
  const postResults = [];
  const storage = createBirdieOsWorldStorage({
    async birdieOSGet(action, params) {
      getCalls.push({ action, params });
      return {
        success: true,
        data: {
          birdieId: "BIRDIE-1",
          balances: {},
          transactions: [
            transaction(),
            transaction({
              transactionId: "TX-2",
              transactionType: "REDEEM",
              amount: -1,
              status: "PENDING"
            })
          ]
        }
      };
    },
    async birdieOSPost(payload) {
      postCalls.push(payload);
      return postResults.shift() || { success: true, data: {} };
    },
    reconcilerSubject: "birdie-agent"
  });
  return { storage, getCalls, postCalls, postResults };
}

test("world progress reads and filters the exact canonical BirdieOS ledger", async () => {
  const { storage, getCalls } = fixture();
  const events = await storage.listApprovedEarnEvents({ birdieId: "BIRDIE-1" });

  assert.deepEqual(getCalls, [{
    action: "coinGetLedger",
    params: { birdieId: "BIRDIE-1" }
  }]);
  assert.deepEqual(events, [transaction()]);
});

test("ledger scope corruption and duplicate transaction IDs fail closed", async () => {
  for (const transactions of [
    [transaction(), transaction()],
    [transaction({ birdieId: "BIRDIE-2" })]
  ]) {
    const storage = createBirdieOsWorldStorage({
      birdieOSGet: async () => ({
        success: true,
        data: { birdieId: "BIRDIE-1", transactions }
      }),
      birdieOSPost: async () => ({ success: true, data: {} })
    });
    await assert.rejects(
      storage.listApprovedEarnEvents({ birdieId: "BIRDIE-1" }),
      (error) => [
        "BIRDIE_OS_LEDGER_TRANSACTION_DUPLICATE",
        "BIRDIE_OS_LEDGER_SCOPE_MISMATCH"
      ].includes(error.code)
    );
  }
});

test("projection forwards only the canonical transaction identifier", async () => {
  const { storage, postCalls, postResults } = fixture();
  postResults.push({
    success: true,
    data: {
      eligible: true,
      created: true,
      event: transaction(),
      response: { responseId: "birdie-response:TX-1" }
    }
  });
  const data = await storage.applyLedgerProjection({
    event: transaction({ amount: 999, birdieId: "CLIENT-SPOOF" })
  });

  assert.equal(data.created, true);
  assert.deepEqual(postCalls[0], {
    action: "worldProjectTransaction",
    transactionId: "TX-1",
    authSubject: "birdie-agent",
    authBirdieId: "",
    source: "Birdie Agent BirdieWorld V1"
  });
  assert.equal("amount" in postCalls[0], false);
  assert.equal("birdieId" in postCalls[0], false);
});

test("lease and ACK preserve the server-generated lease proof exactly", async () => {
  const { storage, postCalls, postResults } = fixture();
  const response = {
    responseId: "birdie-response:TX-1",
    eventId: "coin:TX-1",
    birdieId: "BIRDIE-1",
    kind: "COIN_EARNED"
  };
  postResults.push({
    success: true,
    data: {
      response,
      leaseId: "lease-request:test-1",
      leaseExpiresAt: "2026-08-14T10:00:30.000Z"
    }
  });

  const leased = await storage.leaseNextResponse({
    birdieId: "BIRDIE-1",
    actorSubject: "auth0|birdie-1",
    leaseRequestId: "lease-request:test-1",
    requestedAt: "2026-08-14T10:00:00.000Z",
    leaseSeconds: 30
  });
  assert.equal(leased.leaseRequestId, "lease-request:test-1");
  assert.deepEqual(postCalls[0], {
    action: "worldLeaseResponses",
    birdieId: "BIRDIE-1",
    leaseId: "lease-request:test-1",
    leasedAt: "2026-08-14T10:00:00.000Z",
    leaseExpiresAt: "2026-08-14T10:00:30.000Z",
    authSubject: "auth0|birdie-1",
    authBirdieId: "BIRDIE-1",
    source: "Birdie Agent BirdieWorld V1"
  });

  postResults.push({
    success: true,
    data: {
      acknowledged: true,
      idempotent: false,
      birdieId: "BIRDIE-1",
      responseId: "birdie-response:TX-1",
      acknowledgedAt: "2026-08-14T10:00:10.000Z"
    }
  });
  const ack = await storage.ackResponse({
    birdieId: "BIRDIE-1",
    actorSubject: "auth0|birdie-1",
    responseId: "birdie-response:TX-1",
    leaseId: "lease-request:test-1",
    acknowledgedAt: "2026-08-14T10:00:10.000Z"
  });
  assert.equal(ack.acknowledged, true);
  assert.equal(postCalls[1].leaseId, "lease-request:test-1");
  assert.equal(postCalls[1].authBirdieId, "BIRDIE-1");
});

test("reconciliation is an explicit idempotent BirdieOS admin action", async () => {
  const { storage, postCalls, postResults } = fixture();
  postResults.push({ success: true, data: { scanned: 2, projectionsCreated: 1 } });
  const result = await storage.reconcile();
  assert.deepEqual(result, { scanned: 2, projectionsCreated: 1 });
  assert.equal(postCalls[0].action, "worldReconcileLedger");
  assert.equal(postCalls[0].authSubject, "birdie-agent");
});
