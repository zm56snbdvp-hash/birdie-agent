import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { normalizeMetaWebhook, verifyMetaSignature } from "../src/meta/normalize.mjs";
import { routeMetaPublicRequest } from "../src/meta/router.mjs";
import { createMetaCommunityService } from "../src/meta/service.mjs";

const COMMENT_ID = "17930197359365940";
const INSTAGRAM_ACCOUNT_ID = "17841400000000000";

function commentPayload(overrides = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: INSTAGRAM_ACCOUNT_ID,
        time: 1786500000,
        changes: [
          {
            field: "comments",
            value: {
              id: COMMENT_ID,
              from: { id: "17841400123456789", username: "Birdie.Fan" },
              media: { id: "17900000000000000" },
              text: "BIRDIE",
              ...overrides
            }
          }
        ]
      }
    ]
  };
}

function signature(raw, secret = "test-secret") {
  return `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function exactBirdieOsResponse(event) {
  return {
    success: true,
    data: {
      syncEventId: event.syncEventId,
      workItemId: event.workItemId,
      socialEventId: event.syncEventId,
      idempotencyKey: event.idempotencyKey,
      idempotent: false,
      repaired: false,
      readback: {
        communitySync: {
          syncEventId: event.syncEventId,
          idempotencyKey: event.idempotencyKey
        },
        communityWork: {
          workItemId: event.workItemId,
          syncEventId: event.syncEventId,
          sourceSnapshotKey: event.sourceSnapshotKey
        },
        socialCoinEvent: {
          eventId: event.syncEventId,
          points: 1,
          verificationStatus: "IDENTITY_PENDING",
          coinWriteStatus: "NOT_WRITTEN",
          idempotencyKey: event.idempotencyKey
        }
      }
    }
  };
}

test("normalizes a signed-cycle comment into deterministic common, work and snapshot IDs", () => {
  const events = normalizeMetaWebhook(commentPayload(), {
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });

  assert.equal(events.length, 1);
  assert.deepEqual(
    {
      syncEventId: events[0].syncEventId,
      workItemId: events[0].workItemId,
      sourceSnapshotKey: events[0].sourceSnapshotKey,
      sourceReference: events[0].sourceReference,
      externalUserId: events[0].externalUserId,
      eventType: events[0].eventType,
      actionCode: events[0].actionCode,
      idempotencyKey: events[0].idempotencyKey,
      syncStatus: events[0].syncStatus
    },
    {
      syncEventId: `SCE-IG-COMMENT-${COMMENT_ID}`,
      workItemId: `WORK-IG-COMMENT-${COMMENT_ID}`,
      sourceSnapshotKey: `SSK-IG-COMMENT-${COMMENT_ID}`,
      sourceReference: COMMENT_ID,
      externalUserId: "birdie.fan",
      eventType: "IG_COMMENT",
      actionCode: "IG_COMMENT",
      idempotencyKey: `ig:ig_comment:birdie.fan:${COMMENT_ID}`,
      syncStatus: "PENDING"
    }
  );
  for (const forbidden of [
    "birdieId",
    "matchedBirdieId",
    "points",
    "amount",
    "coinWriteStatus",
    "verificationStatus"
  ]) {
    assert.equal(Object.hasOwn(events[0], forbidden), false);
  }
});

test("collapses exact duplicate deliveries in one webhook before BirdieOS writes", () => {
  const payload = commentPayload();
  payload.entry[0].changes.push(structuredClone(payload.entry[0].changes[0]));
  assert.equal(normalizeMetaWebhook(payload, {
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  }).length, 1);
});

test("rejects non-numeric, short and oversized comment source references", () => {
  for (const id of ["comment-123", "1234", "9".repeat(81)]) {
    assert.throws(
      () => normalizeMetaWebhook(commentPayload({ id }), {
        instagramAccountId: INSTAGRAM_ACCOUNT_ID
      }),
      (error) => error.code === "META_COMMENT_SOURCE_REFERENCE_INVALID"
    );
  }
});

test("rejects a comment without a canonical Instagram handle", () => {
  assert.throws(
    () => normalizeMetaWebhook(
      commentPayload({ from: { id: "17841400123456789" } }),
      { instagramAccountId: INSTAGRAM_ACCOUNT_ID }
    ),
    (error) => error.code === "META_INSTAGRAM_HANDLE_INVALID"
  );
});

test("requires the exact configured Instagram account before normalization", () => {
  const missingObject = commentPayload();
  delete missingObject.object;
  assert.throws(
    () => normalizeMetaWebhook(missingObject, {
      instagramAccountId: INSTAGRAM_ACCOUNT_ID
    }),
    (error) => error.code === "META_WEBHOOK_OBJECT_INVALID"
  );

  const wrongAccount = commentPayload();
  wrongAccount.entry[0].id = "17841400999999999";
  assert.throws(
    () => normalizeMetaWebhook(wrongAccount, {
      instagramAccountId: INSTAGRAM_ACCOUNT_ID
    }),
    (error) =>
      error.code === "META_WEBHOOK_ACCOUNT_MISMATCH" && error.status === 403
  );
});

test("verifies X-Hub-Signature-256 against the untouched raw bytes", () => {
  const raw = Buffer.from(JSON.stringify(commentPayload()));
  assert.equal(verifyMetaSignature(raw, signature(raw), "test-secret"), true);
  assert.equal(verifyMetaSignature(raw, `sha256=${"0".repeat(64)}`, "test-secret"), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", "test-secret"), false);
});

test("invalid signature fails before normalization or BirdieOS writes", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async (payload) => calls.push(payload),
    appSecret: "test-secret",
    verifyToken: "verify",
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });
  const raw = JSON.stringify(commentPayload());

  await assert.rejects(
    service.ingestWebhook(raw, `sha256=${"0".repeat(64)}`),
    (error) => error.code === "META_WEBHOOK_SIGNATURE_INVALID" && error.status === 401
  );
  assert.equal(calls.length, 0);
});

test("a signed webhook for another app-bound account makes zero BirdieOS writes", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async (payload) => calls.push(payload),
    appSecret: "test-secret",
    verifyToken: "verify",
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });
  const payload = commentPayload();
  payload.entry[0].id = "17841400999999999";
  const raw = JSON.stringify(payload);

  await assert.rejects(
    service.ingestWebhook(raw, signature(raw)),
    (error) =>
      error.code === "META_WEBHOOK_ACCOUNT_MISMATCH" && error.status === 403
  );
  assert.equal(calls.length, 0);
});

test("ingest sends only the derived event and requires all three BirdieOS readbacks", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async (payload) => {
      calls.push(payload);
      return exactBirdieOsResponse(payload.event);
    },
    appSecret: "test-secret",
    verifyToken: "verify",
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });
  const raw = JSON.stringify(commentPayload());
  const result = await service.ingestWebhook(raw, signature(raw));

  assert.equal(result.eventCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "appendCommunitySyncEvent");
  assert.equal(calls[0].event.syncEventId, `SCE-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(calls[0].event.workItemId, `WORK-IG-COMMENT-${COMMENT_ID}`);
  assert.equal(Object.hasOwn(calls[0].event, "points"), false);
  assert.equal(Object.hasOwn(calls[0].event, "birdieId"), false);
  assert.equal(result.events[0].birdieOS.socialEventId, calls[0].event.syncEventId);
});

test("mismatching or incomplete BirdieOS comment readback fails closed", async () => {
  const service = createMetaCommunityService({
    birdieOSPost: async (payload) => {
      const response = exactBirdieOsResponse(payload.event);
      response.data.readback.socialCoinEvent.points = 2;
      return response;
    },
    appSecret: "test-secret",
    verifyToken: "verify",
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });
  const raw = JSON.stringify(commentPayload());

  await assert.rejects(
    service.ingestWebhook(raw, signature(raw)),
    (error) => error.code === "META_BIRDIE_OS_READBACK_INVALID" && error.status === 502
  );
});

test("first inbound DM derives one deterministic welcome entitlement per sender", () => {
  const events = normalizeMetaWebhook({
    object: "instagram",
    entry: [
      {
        id: INSTAGRAM_ACCOUNT_ID,
        time: 1786500000,
        messaging: [
          {
            sender: { id: "17841400000000001" },
            timestamp: 1786500000000,
            message: { mid: "m_1.abc", text: "Hi" }
          },
          {
            sender: { id: "17841400000000001" },
            timestamp: 1786500001000,
            message: { mid: "m_2.abc", text: "BIRDIE" }
          },
          {
            sender: { id: "17841400000000001" },
            timestamp: 1786500002000,
            message: { mid: "m_3.abc", text: "Echo", is_echo: true }
          }
        ]
      }
    ]
  }, { instagramAccountId: INSTAGRAM_ACCOUNT_ID });

  assert.equal(events.length, 1);
  assert.deepEqual(
    {
      syncEventId: events[0].syncEventId,
      workItemId: events[0].workItemId,
      sourceSnapshotKey: events[0].sourceSnapshotKey,
      sourceReference: events[0].sourceReference,
      externalUserId: events[0].externalUserId,
      eventType: events[0].eventType,
      actionCode: events[0].actionCode,
      idempotencyKey: events[0].idempotencyKey
    },
    {
      syncEventId: "SCE-IG-DM-WELCOME-17841400000000001",
      workItemId: "WORK-IG-DM-WELCOME-17841400000000001",
      sourceSnapshotKey: "SSK-IG-DM-WELCOME-17841400000000001",
      sourceReference: "17841400000000001",
      externalUserId: "17841400000000001",
      eventType: "IG_DM_WELCOME",
      actionCode: "IG_DM_WELCOME",
      idempotencyKey: "ig:ig_dm_welcome:17841400000000001"
    }
  );
  assert.equal(Object.hasOwn(events[0], "points"), false);
  assert.equal(Object.hasOwn(events[0], "birdieId"), false);
});

test("signed first-DM entitlement requires sync, work and +1 social readback", async () => {
  const calls = [];
  const payload = {
    object: "instagram",
    entry: [
      {
        id: INSTAGRAM_ACCOUNT_ID,
        time: 1786500000,
        messaging: [
          {
            sender: { id: "17841400000000001" },
            timestamp: 1786500000000,
            message: { mid: "m_1.abc", text: "Anything qualifies" }
          }
        ]
      }
    ]
  };
  const service = createMetaCommunityService({
    birdieOSPost: async (request) => {
      calls.push(request);
      return exactBirdieOsResponse(request.event);
    },
    appSecret: "test-secret",
    verifyToken: "verify",
    instagramAccountId: INSTAGRAM_ACCOUNT_ID
  });
  const raw = JSON.stringify(payload);
  const result = await service.ingestWebhook(raw, signature(raw));

  assert.equal(result.eventCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event.actionCode, "IG_DM_WELCOME");
  assert.equal(result.events[0].birdieOS.readback.socialCoinEvent.points, 1);
});

test("public webhook router preserves raw bytes and signature header", async () => {
  const raw = Buffer.from('{"object":"instagram","entry":[]}');
  const seen = [];
  const response = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };

  const handled = await routeMetaPublicRequest({
    req: {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=abc" }
    },
    res: response,
    url: new URL("https://example.test/meta/webhook"),
    readRawBody: async () => raw,
    service: {
      async ingestWebhook(body, header) {
        seen.push({ body, header });
        return { received: true, eventCount: 0, events: [] };
      }
    }
  });

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  assert.strictEqual(seen[0].body, raw);
  assert.equal(seen[0].header, "sha256=abc");
});
