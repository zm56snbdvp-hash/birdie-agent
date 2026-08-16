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

test("rejects the unselected Instagram Login host before fetch", async () => {
  let fetched = false;
  const service = createMetaCommunityService({
    birdieOSPost: async () => ({ success: true }),
    fetchImpl: async () => {
      fetched = true;
      return okResponse();
    },
    appSecret: "app-secret",
    messagingAccessToken: "instagram-access-token",
    messagingAccountId: "ig-123",
    messagingGraphHost: "graph.instagram.com"
  });

  await assert.rejects(
    service.sendPrivateReply({ commentId: "comment-456", text: "Hello" }),
    (error) => error.code === "META_MESSAGING_HOST_INVALID"
  );
  assert.equal(fetched, false);
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

test("lists one Page conversation with GET, appsecret_proof and sanitized output", async () => {
  const calls = [];
  let birdieWrites = 0;
  const service = createMetaCommunityService({
    birdieOSPost: async () => {
      birdieWrites += 1;
      return { success: true };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okResponse({
        data: [{
          id: "conv-123",
          messages: { data: [{ message: "must-not-leak" }] }
        }],
        paging: {
          cursors: { after: "CURSOR_123" },
          next: "https://graph.facebook.com/next?access_token=TOKEN_MUST_NOT_LEAK"
        }
      });
    },
    appSecret: "app-secret",
    messagingAccessToken: "page-access-token",
    messagingAccountId: "1265475843314216",
    messagingGraphHost: "graph.facebook.com",
    instagramAccountId: "17841440257520993",
    oauthPageId: "1265475843314216",
    oauthInstagramAccountId: "17841440257520993",
    apiVersion: "v26.0"
  });

  const result = await service.listInstagramConversations();

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin, "https://graph.facebook.com");
  assert.equal(requestUrl.pathname, "/v26.0/1265475843314216/conversations");
  assert.equal(requestUrl.searchParams.get("platform"), "instagram");
  assert.equal(requestUrl.searchParams.get("fields"), "id");
  assert.equal(requestUrl.searchParams.get("limit"), "1");
  assert.equal(requestUrl.searchParams.has("access_token"), false);
  assert.equal(
    requestUrl.searchParams.get("appsecret_proof"),
    createHmac("sha256", "app-secret").update("page-access-token").digest("hex")
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer page-access-token");
  assert.equal(Object.hasOwn(calls[0].options, "body"), false);
  assert.equal(birdieWrites, 0);
  assert.deepEqual(result, {
    count: 1,
    conversations: [{ id: "conv-123" }],
    hasNext: true,
    nextCursor: "CURSOR_123"
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("TOKEN_MUST_NOT_LEAK"), false);
});

test("conversations rejects unsafe limit, host and Page mismatch before fetch", async () => {
  for (const item of [
    { limit: 10 },
    { messagingGraphHost: "graph.instagram.com" },
    { messagingAccountId: "1265475843314999" }
  ]) {
    let fetched = false;
    const service = createMetaCommunityService({
      birdieOSPost: async () => ({ success: true }),
      fetchImpl: async () => {
        fetched = true;
        return okResponse({ data: [] });
      },
      appSecret: "app-secret",
      messagingAccessToken: "page-access-token",
      messagingAccountId: item.messagingAccountId || "1265475843314216",
      messagingGraphHost: item.messagingGraphHost || "graph.facebook.com",
      instagramAccountId: "17841440257520993",
      oauthPageId: "1265475843314216",
      oauthInstagramAccountId: "17841440257520993"
    });

    await assert.rejects(
      service.listInstagramConversations({ limit: item.limit ?? 1 }),
      (error) => [
        "META_CONVERSATIONS_LIMIT_INVALID",
        "META_CONVERSATIONS_ROUTE_INVALID",
        "META_CONVERSATIONS_ACCOUNT_MISMATCH"
      ].includes(error.code)
    );
    assert.equal(fetched, false);
  }
});
