import assert from "node:assert/strict";
import test from "node:test";

import {
  birdieResponseId,
  createBirdieSystemResponse,
  ledgerEventId,
  normalizeApprovedEarnLedgerEvent,
  projectApprovedEarnLedgerEvents
} from "../src/app/ledger-world-projector.mjs";

function ledgerEvent(overrides = {}) {
  return {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    createdAt: "2026-08-14T12:00:00+02:00",
    approvedAt: "2026-08-14T12:01:00+02:00",
    ignoredCallerField: "not projected",
    ...overrides
  };
}

test("stable ledger and response identifiers derive only from transactionId", () => {
  assert.equal(ledgerEventId("TX-123"), "coin:TX-123");
  assert.equal(birdieResponseId("TX-123"), "birdie-response:TX-123");
});

test("approved EARN normalization is strict and allowlisted", () => {
  assert.deepEqual(normalizeApprovedEarnLedgerEvent(ledgerEvent()), {
    transactionId: "TX-1",
    birdieId: "BIRDIE-1",
    amount: 1,
    transactionType: "EARN",
    actionCode: "IG_COMMENT",
    sourceType: "INSTAGRAM",
    sourceReference: "17930197359365940",
    status: "APPROVED",
    approvedAt: "2026-08-14T10:01:00.000Z",
    createdAt: "2026-08-14T10:00:00.000Z"
  });

  for (const [override, code] of [
    [{ status: "PENDING" }, "LEDGER_EVENT_NOT_APPROVED"],
    [{ transactionType: "SPEND", amount: -1 }, "LEDGER_EVENT_NOT_EARN"],
    [{ amount: 0 }, "INVALID_LEDGER_EVENT"],
    [{ amount: 1.5 }, "INVALID_LEDGER_EVENT"],
    [{ approvedAt: "not-a-time" }, "INVALID_LEDGER_EVENT"]
  ]) {
    assert.throws(
      () => normalizeApprovedEarnLedgerEvent(ledgerEvent(override)),
      { code }
    );
  }
});

test("the German system response is deterministic and makes no model choice", () => {
  assert.deepEqual(createBirdieSystemResponse(ledgerEvent()), {
    schemaVersion: "birdie-system-response/v1",
    responseId: "birdie-response:TX-1",
    eventId: "coin:TX-1",
    birdieId: "BIRDIE-1",
    kind: "COIN_EARNED",
    language: "de-DE",
    amount: 1,
    actionCode: "IG_COMMENT",
    text: "+1 Birdie ist angekommen."
  });
  assert.equal(
    createBirdieSystemResponse(ledgerEvent({ amount: 3 })).text,
    "+3 Birdies sind angekommen."
  );
});

test("duplicate and reordered delivery produce the same world projection", () => {
  const first = ledgerEvent();
  const second = ledgerEvent({
    transactionId: "TX-2",
    amount: 3,
    sourceReference: "17930197359365941",
    approvedAt: "2026-08-14T12:02:00+02:00"
  });

  const ordered = projectApprovedEarnLedgerEvents([first, second], {
    birdieId: "BIRDIE-1"
  });
  const replayed = projectApprovedEarnLedgerEvents([second, first, second, first], {
    birdieId: "BIRDIE-1"
  });

  assert.deepEqual(replayed, ordered);
  assert.deepEqual(ordered, {
    schemaVersion: "birdie-world-progress/v1",
    birdieId: "BIRDIE-1",
    revision: 2,
    approvedEarnedBirdies: 4,
    appliedEventIds: ["coin:TX-1", "coin:TX-2"],
    lastEventId: "coin:TX-2"
  });
});

test("a divergent transaction replay or cross-Birdie set fails closed", () => {
  assert.throws(
    () => projectApprovedEarnLedgerEvents([
      ledgerEvent(),
      ledgerEvent({ amount: 2 })
    ]),
    { code: "LEDGER_EVENT_CONFLICT" }
  );
  assert.throws(
    () => projectApprovedEarnLedgerEvents([
      ledgerEvent(),
      ledgerEvent({ transactionId: "TX-2", birdieId: "BIRDIE-2" })
    ]),
    { code: "WORLD_SCOPE_MISMATCH" }
  );
});

test("an empty world remains scoped and deterministic", () => {
  assert.deepEqual(projectApprovedEarnLedgerEvents([], { birdieId: "BIRDIE-9" }), {
    schemaVersion: "birdie-world-progress/v1",
    birdieId: "BIRDIE-9",
    revision: 0,
    approvedEarnedBirdies: 0,
    appliedEventIds: [],
    lastEventId: null
  });
});
