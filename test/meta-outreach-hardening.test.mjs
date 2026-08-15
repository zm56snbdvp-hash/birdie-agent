import test from "node:test";
import assert from "node:assert/strict";
import { createOutreachPlane } from "../src/meta/outreach.mjs";
import { normalizeInstagramOutboundEcho } from "../src/meta/outbound-echo.mjs";

function harness({ providerMode = "success" } = {}) {
  const rows = [];
  let sends = 0;
  const ledger = {
    async appendIdempotent(row) {
      const existing = rows.find((item) => item.idempotencyKey === row.idempotencyKey);
      if (existing) return existing;
      rows.push({ ...row });
      return rows.at(-1);
    },
    async findByIdempotencyKey(key) {
      return rows.find((item) => item.idempotencyKey === key);
    },
    async findByProviderMessageId(messageId) {
      return rows.find((item) => item.providerMessageId === messageId);
    },
    async patch(outreachEventId, patch) {
      const row = rows.find((item) => item.outreachEventId === outreachEventId);
      if (!row) throw new Error("missing outreach row");
      Object.assign(row, patch);
      return row;
    }
  };
  const plane = createOutreachPlane({
    ledger,
    assetRegistry: {
      async get(id) {
        return id === "ASSET-COIN-V1"
          ? { state: "RELEASED", mimeType: "image/png", providerUrl: "https://approved.invalid/coin.png" }
          : null;
      }
    },
    eligibilityReader: async () => ({ state: "ELIGIBLE" }),
    permissionReader: async () => ({ instagram_manage_messages: true }),
    providerSend: async () => {
      sends += 1;
      if (providerMode === "throw") throw new Error("provider response lost");
      if (providerMode === "missing-mid") return { recipient_id: "1789" };
      return { message_id: "mid.sent.1" };
    },
    now: () => Date.parse("2026-08-15T16:00:00Z")
  });
  return { plane, rows, get sends() { return sends; } };
}

const input = {
  recipientScopedId: "1789",
  instagramHandle: "birdie.test",
  triggerEventId: "T1",
  assetReleaseId: "ASSET-COIN-V1"
};

test("ambiguous provider exception is recorded once and automatic retry is suppressed", async () => {
  const h = harness({ providerMode: "throw" });
  await assert.rejects(() => h.plane.sendRegisteredImage(input), /provider response lost/);
  assert.equal(h.sends, 1);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].sendStatus, "PROVIDER_AMBIGUOUS");
  assert.equal(h.rows[0].failureCode, "PROVIDER_ERROR_NO_RETRY");

  const replay = await h.plane.sendRegisteredImage(input);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.providerCalled, false);
  assert.equal(h.sends, 1);
  assert.equal(h.rows.length, 1);
});

test("missing provider message_id fails closed and replay never sends again", async () => {
  const h = harness({ providerMode: "missing-mid" });
  await assert.rejects(
    () => h.plane.sendRegisteredImage(input),
    (error) => error?.code === "OUTREACH_PROVIDER_RESPONSE_AMBIGUOUS"
  );
  assert.equal(h.rows[0].sendStatus, "PROVIDER_AMBIGUOUS");
  assert.equal(h.rows[0].failureCode, "MISSING_PROVIDER_MESSAGE_ID");
  await h.plane.sendRegisteredImage(input);
  assert.equal(h.sends, 1);
  assert.equal(h.rows.length, 1);
});

test("supported outbound echo is explicitly non-economic and native sticker remains unverifiable", () => {
  const event = normalizeInstagramOutboundEcho({
    sender: { id: "business" },
    recipient: { id: "1789" },
    timestamp: 1786813260000,
    message: {
      mid: "mid.sent.1",
      is_echo: true,
      attachments: [{ type: "sticker", payload: { url: "https://provider.invalid/native" } }]
    }
  });

  assert.equal(event.eventType, "IG_OUTBOUND_ECHO");
  assert.equal(event.providerMessageId, "mid.sent.1");
  assert.equal(event.echoMessageId, "mid.sent.1");
  assert.equal(event.nativeAssetUnverifiable, true);
  assert.equal(event.coinWriteAllowed, false);
  assert.equal(event.identityProofAllowed, false);
  assert.match(event.idempotencyKey, /^ig:outbound-echo:/);
});

test("non-echo messaging event is ignored by outbound echo normalizer", () => {
  assert.equal(normalizeInstagramOutboundEcho({ message: { mid: "mid.inbound.1" } }), null);
});

test("unknown echo quarantine is idempotent across repeated delivery", async () => {
  const h = harness();
  for (let i = 0; i < 10; i += 1) {
    await h.plane.recordEcho({
      providerMessageId: "mid.unknown.1",
      echoMessageId: "echo.unknown.1",
      recipientScopedId: "1789",
      timestamp: "2026-08-15T16:02:00Z"
    });
  }
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].sendStatus, "ECHO_QUARANTINED");
  assert.equal(h.rows[0].failureCode, "ECHO_UNCORRELATED");
});

test("outreach receipts contain no caller secrets or message content fields", async () => {
  const h = harness();
  const result = await h.plane.sendRegisteredImage(input);
  const serialized = JSON.stringify(result.event);
  for (const forbidden of ["accessToken", "token", "Authorization", "messageBody", "messageContent"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
