import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createHeartbeatClient,
  deriveHeartbeatIds,
  runHeartbeatApprove,
  runHeartbeatPreflight,
  runHeartbeatPrepare
} from "../scripts/controlled-instagram-comment-heartbeat.mjs";

const target = {
  commentId: "18001234567890123",
  eventId: "SCE-IG-COMMENT-18001234567890123",
  workItemId: "WORK-IG-COMMENT-18001234567890123",
  birdieId: "BIRDIE-0001",
  instagramHandle: "founder.handle",
  notBefore: "2026-08-15T13:00:00+02:00"
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function gateReceipt(overrides = {}) {
  return {
    schemaVersion: "birdie-instagram-comment-gate/v1",
    producer: {
      attested: true,
      commentId: target.commentId,
      eventId: target.eventId,
      workItemId: target.workItemId,
      sourceReference: target.commentId,
      instagramHandle: target.instagramHandle,
      createdAt: "2026-08-15T13:05:00+02:00"
    },
    workItem: {
      attested: true,
      workItemId: target.workItemId,
      syncEventId: target.eventId,
      sourceType: "INSTAGRAM",
      eventType: "IG_COMMENT",
      actionCode: "IG_COMMENT",
      sourceReference: target.commentId,
      externalUserId: target.instagramHandle,
      resolutionStatus: "IDENTITY_PENDING"
    },
    catalog: {
      attested: true,
      actionCode: "IG_COMMENT",
      defaultCoins: 1,
      accountType: "PRIVATE",
      sourceTypes: "INSTAGRAM",
      approvalMode: "MANUAL_APPROVAL",
      frequencyRule: "PER_DISTINCT_COMMENT",
      status: "ACTIVE",
      freshReadAt: "2026-08-15T13:06:00+02:00"
    },
    owner: {
      confirmed: true,
      birdieId: target.birdieId,
      instagramHandle: target.instagramHandle
    },
    ...overrides
  };
}

function sourceConfig() {
  return {
    actions: {
      IG_COMMENT: {
        accountTypes: ["PRIVATE"],
        points: 1,
        sourceTypes: ["INSTAGRAM"],
        approvalMode: "MANUAL_APPROVAL",
        frequencyRule: "PER_DISTINCT_COMMENT",
        version: "V1",
        status: "ACTIVE",
        rolloutMode: "CONTROLLED_E2E"
      }
    }
  };
}

function profile(handle = "") {
  return {
    birdieId: target.birdieId,
    status: "ACTIVE",
    accountType: "PRIVATE",
    instagramHandle: handle
  };
}

function freshEvent({ resolved = false } = {}) {
  return {
    event: {
      eventId: target.eventId,
      platform: "Instagram",
      eventType: "IG_COMMENT",
      instagramHandle: target.instagramHandle,
      birdieId: resolved ? target.birdieId : "",
      points: 1,
      sourceReference: target.commentId,
      verificationStatus: resolved ? "IDENTITY_RESOLVED" : "IDENTITY_PENDING",
      coinWriteStatus: "NOT_WRITTEN",
      createdAt: "2026-08-15T13:05:00+02:00",
      verifiedAt: resolved ? "2026-08-15T13:07:00+02:00" : ""
    }
  };
}

function baselineLedger() {
  return {
    birdieId: target.birdieId,
    balances: { confirmed: 18, reserved: 10, available: 8, lifetime: 18 },
    transactions: [{ transactionId: "TX-OPENING-1" }, { transactionId: "TX-RESERVE-1" }]
  };
}

function approvedTransaction() {
  return {
    transactionId: "TX-IG-1",
    birdieId: target.birdieId,
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: target.commentId,
    status: "APPROVED",
    idempotencyKey: "claim:CLAIM-IG-1"
  };
}

function approvedLedger() {
  return {
    birdieId: target.birdieId,
    balances: { confirmed: 19, reserved: 10, available: 9, lifetime: 19 },
    transactions: [...baselineLedger().transactions, approvedTransaction()]
  };
}

function ledgerReceipt(ledger) {
  const transactions = [...ledger.transactions].sort((left, right) =>
    left.transactionId.localeCompare(right.transactionId)
  );
  return {
    birdieId: ledger.birdieId,
    balances: ledger.balances,
    transactionIds: transactions.map((row) => row.transactionId),
    transactionsSha256: sha256(transactions)
  };
}

test("derives only deterministic numeric Instagram comment IDs", () => {
  assert.deepEqual(deriveHeartbeatIds(target.commentId), {
    commentId: target.commentId,
    eventId: target.eventId,
    workItemId: target.workItemId
  });
  assert.throws(() => deriveHeartbeatIds("caller-controlled"), /COMMENT_ID_INVALID/);
});

test("missing producer/catalog/owner gate stops before any request", async () => {
  const calls = [];
  await assert.rejects(
    runHeartbeatPreflight({
      client: {
        get: async (...args) => calls.push(args),
        post: async (...args) => calls.push(args)
      },
      input: target,
      gateReceipt: { schemaVersion: "birdie-instagram-comment-gate/v1" }
    }),
    /PRODUCER_ATTESTATION_REQUIRED/
  );
  assert.deepEqual(calls, []);
});

test("preflight is GET-only and validates the exact fresh source", async () => {
  const calls = [];
  const responses = [sourceConfig(), profile(), baselineLedger(), freshEvent()];
  const result = await runHeartbeatPreflight({
    client: {
      async get(path) {
        calls.push(["GET", path]);
        return responses.shift();
      },
      async post(path, body) {
        calls.push(["POST", path, body]);
        throw new Error("unexpected POST");
      }
    },
    input: target,
    gateReceipt: gateReceipt()
  });
  assert.deepEqual(calls.map(([method]) => method), ["GET", "GET", "GET", "GET"]);
  assert.equal(result.target.eventId, target.eventId);
  assert.match(result.gateReceiptSha256, /^[0-9a-f]{64}$/);
});

test("prepare links, exact-resolves, binds, creates one PENDING claim, then stops", async () => {
  const calls = [];
  const client = {
    async get(path) {
      calls.push({ method: "GET", path });
      if (path === "/coin/config") return sourceConfig();
      if (path.includes("/ledger")) return baselineLedger();
      if (path.includes("/social-events/")) return freshEvent();
      if (path.includes("/coin/profiles/")) return profile(calls.some((call) => call.path?.endsWith("/instagram")) ? target.instagramHandle : "");
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body) {
      calls.push({ method: "POST", path, body });
      if (path.endsWith("/instagram")) return { profile: profile(target.instagramHandle), idempotent: false };
      if (path === "/community/identity/resolve") {
        return {
          processed: true,
          resolution: {
            resolutionStatus: "IDENTITY_RESOLVED",
            matchedBirdieId: target.birdieId,
            identityConfidence: 100,
            identityDecisionMode: "AUTO_EXACT_LINK"
          }
        };
      }
      if (path.endsWith("/identity")) {
        return freshEvent({ resolved: true });
      }
      if (path.endsWith("/claim")) {
        return {
          claimId: "CLAIM-IG-1",
          birdieId: target.birdieId,
          actionCode: "IG_COMMENT",
          sourceType: "INSTAGRAM",
          sourceReference: target.commentId,
          status: "PENDING"
        };
      }
      throw new Error(`unexpected POST ${path}`);
    }
  };
  const receipt = await runHeartbeatPrepare({ client, input: target, gateReceipt: gateReceipt() });
  assert.equal(receipt.claimId, "CLAIM-IG-1");
  assert.equal(receipt.status, "PENDING_CLAIM_READY_FOR_EXACT_FOUNDER_APPROVAL");
  assert.equal(calls.some(({ path }) => path?.includes("/decision")), false);
  assert.equal(calls.some(({ path }) => path?.endsWith("/written")), false);
  const claimCall = calls.find(({ path }) => path?.endsWith("/claim"));
  assert.deepEqual(claimCall.body, {
    workItemId: target.workItemId,
    birdieId: target.birdieId,
    confirmation: "CREATE_IG_COMMENT_CLAIM"
  });
});

function pendingClaim(status = "PENDING") {
  return {
    claimId: "CLAIM-IG-1",
    birdieId: target.birdieId,
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: target.commentId,
    status,
    ...(status === "APPROVED" ? { approvedAmount: 1 } : {})
  };
}

function prepareReceipt(gate = gateReceipt()) {
  const baseline = ledgerReceipt(baselineLedger());
  return {
    schemaVersion: "birdie-instagram-comment-heartbeat/prepare-v1",
    status: "PENDING_CLAIM_READY_FOR_EXACT_FOUNDER_APPROVAL",
    target,
    claimId: "CLAIM-IG-1",
    gateReceiptSha256: sha256(gate),
    baselineLedger: structuredClone(baseline),
    preApprovalLedger: structuredClone(baseline)
  };
}

function approvalClient({
  initialClaimStatus = "PENDING",
  ledgerBeforeDecision = baselineLedger(),
  ledgerAfterDecision = approvedLedger()
} = {}) {
  const calls = [];
  let claimCount = 0;
  let decisionCount = 0;
  let ledgerCount = 0;
  const client = {
    calls,
    async get(path) {
      calls.push({ method: "GET", path });
      if (path.includes("/ledger")) {
        ledgerCount += 1;
        return structuredClone(
          ledgerCount === 1 ? ledgerBeforeDecision : ledgerAfterDecision
        );
      }
      if (path.includes("/social-events/")) {
        return {
          event: {
            ...freshEvent({ resolved: true }).event,
            coinWriteStatus: "WRITTEN",
            processedAt: "2026-08-15T13:10:00+02:00"
          }
        };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body) {
      calls.push({ method: "POST", path, body });
      if (path.endsWith("/instagram")) return { profile: profile(target.instagramHandle), idempotent: true };
      if (path === "/community/identity/resolve") return { processed: false, reason: "WORK_ITEM_NOT_ELIGIBLE" };
      if (path.endsWith("/identity")) return { ...freshEvent({ resolved: true }), idempotent: true };
      if (path.endsWith("/claim")) {
        return pendingClaim(claimCount++ === 0 ? initialClaimStatus : "APPROVED");
      }
      if (path.includes("/decision")) {
        decisionCount += 1;
        return decisionCount === 1
          ? { claim: pendingClaim("APPROVED"), profile: profile(target.instagramHandle) }
          : pendingClaim("APPROVED");
      }
      if (path.endsWith("/written")) {
        return {
          event: { birdieId: target.birdieId, coinWriteStatus: "WRITTEN" },
          claim: pendingClaim("APPROVED"),
          transaction: approvedTransaction(),
          idempotent: calls.filter((call) => call.path?.endsWith("/written")).length > 1
        };
      }
      throw new Error(`unexpected POST ${path}`);
    }
  };
  return client;
}

function prepareRecoveryClient({ phase }) {
  const calls = [];
  const initiallyResolved = phase !== "after-resolver";
  return {
    calls,
    async get(path) {
      calls.push({ method: "GET", path });
      if (path === "/coin/config") return sourceConfig();
      if (path.includes("/ledger")) return baselineLedger();
      if (path.includes("/social-events/")) {
        return freshEvent({ resolved: initiallyResolved });
      }
      if (path.includes("/coin/profiles/")) return profile(target.instagramHandle);
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body) {
      calls.push({ method: "POST", path, body });
      if (path.endsWith("/instagram")) {
        return { profile: profile(target.instagramHandle), idempotent: true };
      }
      if (path === "/community/identity/resolve") {
        return { processed: false, reason: "WORK_ITEM_NOT_ELIGIBLE" };
      }
      if (path.endsWith("/identity")) {
        return { ...freshEvent({ resolved: true }), idempotent: phase !== "after-resolver" };
      }
      if (path.endsWith("/claim")) return pendingClaim();
      throw new Error(`unexpected POST ${path}`);
    }
  };
}

test("prepare resumes after resolver, bind, or PENDING-claim response loss", async (t) => {
  for (const phase of ["after-resolver", "after-bind", "after-claim"]) {
    await t.test(phase, async () => {
      const client = prepareRecoveryClient({ phase });
      const receipt = await runHeartbeatPrepare({
        client,
        input: target,
        gateReceipt: gateReceipt()
      });
      assert.equal(receipt.claimId, "CLAIM-IG-1");
      assert.equal(
        receipt.status,
        "PENDING_CLAIM_READY_FOR_EXACT_FOUNDER_APPROVAL"
      );
      assert.equal(client.calls.some(({ path }) => path?.includes("/decision")), false);
      assert.equal(client.calls.some(({ path }) => path?.endsWith("/written")), false);
    });
  }
});

test("approve requires the exact claim and confirmation before any request", async () => {
  const client = approvalClient();
  const gate = gateReceipt();
  await assert.rejects(
    runHeartbeatApprove({
      client,
      input: { expectedClaimId: "CLAIM-OTHER", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
      prepareReceipt: prepareReceipt(gate),
      gateReceipt: gate
    }),
    /APPROVAL_CLAIM_ID_MISMATCH/
  );
  assert.deepEqual(client.calls, []);
});

test("approve proves exactly one +1 transaction, marks WRITTEN and replays with zero delta", async () => {
  const client = approvalClient();
  const gate = gateReceipt();
  const receipt = await runHeartbeatApprove({
    client,
    input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
    prepareReceipt: prepareReceipt(gate),
    gateReceipt: gate
  });
  assert.equal(
    receipt.status,
    "DOWNSTREAM_COIN_REPLAY_VERIFIED_PRODUCER_REPLAY_PENDING"
  );
  assert.equal(receipt.transactionId, "TX-IG-1");
  assert.deepEqual(receipt.after.balances, { confirmed: 19, reserved: 10, available: 9, lifetime: 19 });
  assert.equal(receipt.replayCreatedTransactions, 0);
  const decisions = client.calls.filter(({ path }) => path?.includes("/decision"));
  assert.equal(decisions.length, 2);
  for (const { body } of decisions) {
    assert.equal("approvedAmount" in body, false);
    assert.equal(body.confirmation, "APPROVE_IG_COMMENT_CLAIM");
  }
});

test("unrelated pre-decision ledger drift blocks before economic approval", async () => {
  const drift = baselineLedger();
  drift.transactions.push({ transactionId: "TX-OTHER-1" });
  drift.balances.confirmed += 2;
  drift.balances.available += 2;
  drift.balances.lifetime += 2;
  const client = approvalClient({ ledgerBeforeDecision: drift });
  const gate = gateReceipt();
  await assert.rejects(
    runHeartbeatApprove({
      client,
      input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
      prepareReceipt: prepareReceipt(gate),
      gateReceipt: gate
    }),
    /APPROVED_TRANSACTION_INVALID/
  );
  assert.equal(client.calls.some(({ path }) => path?.includes("/decision")), false);
  assert.equal(client.calls.some(({ path }) => path?.endsWith("/written")), false);
});

test("post-decision ledger mismatch blocks WRITTEN", async () => {
  const drift = approvedLedger();
  drift.transactions.push({ ...approvedTransaction(), transactionId: "TX-IG-2" });
  drift.balances.confirmed += 1;
  drift.balances.available += 1;
  drift.balances.lifetime += 1;
  const client = approvalClient({ ledgerAfterDecision: drift });
  const gate = gateReceipt();
  await assert.rejects(
    runHeartbeatApprove({
      client,
      input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
      prepareReceipt: prepareReceipt(gate),
      gateReceipt: gate
    }),
    /APPROVAL_MUST_CREATE_EXACTLY_ONE_TRANSACTION/
  );
  assert.equal(client.calls.some(({ path }) => path?.endsWith("/written")), false);
});

test("approve recovers an exact transaction left by a prior decision attempt", async (t) => {
  for (const initialClaimStatus of ["PENDING", "APPROVED"]) {
    await t.test(initialClaimStatus, async () => {
      const client = approvalClient({
        initialClaimStatus,
        ledgerBeforeDecision: approvedLedger()
      });
      const gate = gateReceipt();
      const receipt = await runHeartbeatApprove({
        client,
        input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
        prepareReceipt: prepareReceipt(gate),
        gateReceipt: gate
      });
      assert.equal(receipt.transactionId, "TX-IG-1");
      assert.equal(receipt.replayCreatedTransactions, 0);
    });
  }
});

test("approval requires the exact gate receipt digest before any request", async () => {
  const originalGate = gateReceipt();
  const client = approvalClient();
  await assert.rejects(
    runHeartbeatApprove({
      client,
      input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
      prepareReceipt: prepareReceipt(originalGate),
      gateReceipt: { ...gateReceipt(), evidenceRevision: "different-valid-receipt" }
    }),
    /GATE_RECEIPT_DIGEST_MISMATCH/
  );
  assert.deepEqual(client.calls, []);
});

test("historical ledger-row mutation blocks approval before decision", async () => {
  const mutated = baselineLedger();
  mutated.transactions[0] = { ...mutated.transactions[0], note: "changed" };
  const client = approvalClient({ ledgerBeforeDecision: mutated });
  const gate = gateReceipt();
  await assert.rejects(
    runHeartbeatApprove({
      client,
      input: { expectedClaimId: "CLAIM-IG-1", confirmation: "APPROVE_IG_COMMENT_CLAIM" },
      prepareReceipt: prepareReceipt(gate),
      gateReceipt: gate
    }),
    /BASELINE_TRANSACTION_HISTORY_CHANGED/
  );
  assert.equal(client.calls.some(({ path }) => path?.includes("/decision")), false);
});

test("ledger birdie and integer balance shapes fail closed", async (t) => {
  const cases = [
    ["wrong birdie", { ...baselineLedger(), birdieId: "BIRDIE-OTHER" }, /LEDGER_BIRDIE_ID_MISMATCH/],
    [
      "missing balance",
      { ...baselineLedger(), balances: { ...baselineLedger().balances, confirmed: undefined } },
      /LEDGER_BALANCE_CONFIRMED_INVALID/
    ]
  ];
  for (const [name, ledger, expected] of cases) {
    await t.test(name, async () => {
      const responses = [sourceConfig(), profile(), ledger, freshEvent()];
      await assert.rejects(
        runHeartbeatPreflight({
          client: {
            get: async () => responses.shift(),
            post: async () => {
              throw new Error("unexpected POST");
            }
          },
          input: target,
          gateReceipt: gateReceipt()
        }),
        expected
      );
    });
  }
});

test("HTTP client requires success/data envelopes and authoritative Coin responses", async () => {
  const response = (body) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  });
  const missingSuccess = createHeartbeatClient({
    baseUrl: "https://birdie.example",
    apiKey: "test-key",
    fetchImpl: async () => response({ data: {} })
  });
  await assert.rejects(
    missingSuccess.get("/community/identity/resolve"),
    /SUCCESS_ENVELOPE_REQUIRED/
  );

  const nonAuthoritativeCoin = createHeartbeatClient({
    baseUrl: "https://birdie.example",
    apiKey: "test-key",
    fetchImpl: async () => response({ success: true, data: {} })
  });
  await assert.rejects(
    nonAuthoritativeCoin.get("/coin/config"),
    /AUTHORITATIVE_COIN_RESPONSE_REQUIRED/
  );

  const identity = createHeartbeatClient({
    baseUrl: "https://birdie.example",
    apiKey: "test-key",
    fetchImpl: async () => response({ success: true, data: { processed: false } })
  });
  assert.deepEqual(
    await identity.get("/community/identity/resolve"),
    { processed: false }
  );
});
