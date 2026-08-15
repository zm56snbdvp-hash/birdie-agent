import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createMetaCommunityService } from "../src/meta/service.mjs";

function okResponse(body = { message_id: "mid.test" }) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("uses dedicated Page routing and appsecret_proof without putting the token in the URL", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ success: true }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okResponse();
    },
    appSecret: "app-secret",
    messagingAccessToken: "page-access-token",
    messagingAccountId: "page-123",
    messagingGraphHost: "graph.facebook.com",
    apiVersion: "v24.0"
  });

  await service.sendResponseMessage({ recipientId: "igsid-456", text: "Hello" });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin, "https://graph.facebook.com");
  assert.equal(requestUrl.pathname, "/v24.0/page-123/messages");
  assert.equal(requestUrl.searchParams.has("access_token"), false);
  assert.equal(
    requestUrl.searchParams.get("appsecret_proof"),
    createHmac("sha256", "app-secret").update("page-access-token").digest("hex")
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer page-access-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    recipient: { id: "igsid-456" },
    messaging_type: "RESPONSE",
    message: { text: "Hello" }
  });
});

test("keeps the Instagram Login host available through explicit routing", async () => {
  const calls = [];
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ success: true }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okResponse();
    },
    appSecret: "app-secret",
    messagingAccessToken: "instagram-access-token",
    messagingAccountId: "ig-123",
    messagingGraphHost: "graph.instagram.com"
  });

  await service.sendPrivateReply({ commentId: "comment-456", text: "Hello" });

  assert.equal(new URL(calls[0].url).origin, "https://graph.instagram.com");
  assert.equal(calls[0].options.headers.Authorization, "Bearer instagram-access-token");
});

test("fails closed before fetch for an untrusted messaging host", async () => {
  let fetched = false;
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ success: true }),
    fetchImpl: async () => {
      fetched = true;
      return okResponse();
    },
    appSecret: "app-secret",
    messagingAccessToken: "page-access-token",
    messagingAccountId: "page-123",
    messagingGraphHost: "example.invalid"
  });

  await assert.rejects(
    service.sendResponseMessage({ recipientId: "igsid-456", text: "Hello" }),
    (error) => error.code === "META_MESSAGING_HOST_INVALID" && error.status === 503
  );
  assert.equal(fetched, false);
});

test("requires the app secret before any outbound fetch", async () => {
  let fetched = false;
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ success: true }),
    fetchImpl: async () => {
      fetched = true;
      return okResponse();
    },
    appSecret: "",
    messagingAccessToken: "page-access-token",
    messagingAccountId: "page-123",
    messagingGraphHost: "graph.facebook.com"
  });

  await assert.rejects(
    service.sendResponseMessage({ recipientId: "igsid-456", text: "Hello" }),
    (error) => error.code === "META_CONFIG_MISSING" && error.status === 503
  );
  assert.equal(fetched, false);
});
