import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createMetaCommunityService } from "../src/meta/service.mjs";
import { normalizeMetaWebhook, verifyMetaSignature } from "../src/meta/normalize.mjs";

test("normalizes Instagram comment webhook into canonical queue event", () => {
  const events = normalizeMetaWebhook({
    entry: [{
      time: 1786500000,
      changes: [{
        field: "comments",
        value: {
          id: "comment-123",
          from: { id: "igsid-7", username: "golfer.one" },
          media: { id: "media-9" },
          text: "BIRDIE"
        }
      }]
    }]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].sourceType, "INSTAGRAM");
  assert.equal(events[0].externalUserId, "golfer.one");
  assert.equal(events[0].eventType, "COMMENT");
  assert.equal(events[0].idempotencyKey, "INSTAGRAM|COMMENT|comment-123");
  assert.equal(events[0].syncStatus, "PENDING");
});

test("normalizes inbound Instagram DM and ignores echoes", () => {
  const events = normalizeMetaWebhook({
    entry: [{
      messaging: [
        { sender: { id: "igsid-1" }, timestamp: 1786500000000, message: { mid: "m-1", text: "Hi" } },
        { sender: { id: "igsid-1" }, timestamp: 1786500000000, message: { mid: "m-2", text: "Echo", is_echo: true } }
      ]
    }]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "DM_RECEIVED");
  assert.equal(events[0].externalUserId, "igsid-1");
  assert.equal(events[0].idempotencyKey, "INSTAGRAM|DM|m-1");
});

test("verifies X-Hub-Signature-256", () => {
  const raw = JSON.stringify({ hello: "birdie" });
  const secret = "test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", secret), false);
});

test("ingest posts normalized events only through appendCommunitySyncEvent", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async (payload) => {
      calls.push(payload);
      return { data: { idempotent: false } };
    },
    appSecret: "test-secret",
    verifyToken: "verify",
    accessToken: "token",
    instagramAccountId: "ig-1"
  });

  const raw = JSON.stringify({
    entry: [{
      changes: [{
        field: "comments",
        value: {
          id: "comment-9",
          from: { id: "igsid-9", username: "birdie.fan" },
          text: "BIRDIE"
        }
      }]
    }]
  });
  const signature = `sha256=${crypto.createHmac("sha256", "test-secret").update(raw).digest("hex")}`;
  const result = await service.ingestWebhook(raw, signature);

  assert.equal(result.eventCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "appendCommunitySyncEvent");
  assert.equal(calls[0].event.idempotencyKey, "INSTAGRAM|COMMENT|comment-9");
  assert.equal("birdieId" in calls[0].event, false);
});

test("private reply uses comment_id and response DM uses recipient id", async () => {
  const requests = [];
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ data: {} }),
    appSecret: "secret",
    verifyToken: "verify",
    accessToken: "token",
    instagramAccountId: "ig-account",
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 200, text: async () => '{"message_id":"ok"}' };
    }
  });

  await service.sendPrivateReply({ commentId: "c-1", text: "Welcome" });
  await service.sendResponseMessage({ recipientId: "igsid-1", text: "Balance" });

  assert.equal(requests[0].body.recipient.comment_id, "c-1");
  assert.equal(requests[1].body.recipient.id, "igsid-1");
  assert.equal(requests[1].body.messaging_type, "RESPONSE");
});
