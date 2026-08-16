import { createHmac } from "node:crypto";

import { normalizeMetaWebhook, verifyMetaSignature } from "./normalize.mjs";
import { createMetaPageOAuthFlow } from "./oauth.mjs";

const DEFAULT_API_VERSION = "v26.0";
const DEFAULT_MESSAGING_GRAPH_HOST = "graph.facebook.com";
const MAX_CONVERSATIONS_LIMIT = 1;
const ALLOWED_MESSAGING_GRAPH_HOSTS = new Set([
  "graph.facebook.com"
]);

function serviceError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result) {
    throw serviceError("META_CONFIG_MISSING", `${field} is required`, 503);
  }
  return result;
}

function requiredMetaId(value, field) {
  const result = required(value, field);
  if (!/^\d{5,30}$/.test(result)) {
    throw serviceError("META_CONFIG_INVALID", `${field} must be a Meta numeric ID`, 503);
  }
  return result;
}

function requireExact(value, expected, field) {
  if (String(value ?? "") !== String(expected)) {
    throw serviceError(
      "META_BIRDIE_OS_READBACK_INVALID",
      `BirdieOS ${field} readback did not match the signed Meta event`,
      502
    );
  }
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(String(value ?? ""))) {
    throw serviceError(
      "META_BIRDIE_OS_READBACK_INVALID",
      `BirdieOS ${field} readback is not a governed state`,
      502
    );
  }
}

function validateCommentReadback(event, response) {
  const data = response?.data;
  const readback = data?.readback;
  if (!data || !readback?.communitySync || !readback?.communityWork || !readback?.socialCoinEvent) {
    throw serviceError(
      "META_BIRDIE_OS_READBACK_INVALID",
      "BirdieOS must read back the sync, work, and social Coin rows",
      502
    );
  }

  requireExact(data.syncEventId, event.syncEventId, "syncEventId");
  requireExact(data.workItemId, event.workItemId, "workItemId");
  requireExact(data.socialEventId, event.syncEventId, "socialEventId");
  requireExact(data.idempotencyKey, event.idempotencyKey, "idempotencyKey");

  requireExact(readback.communitySync.syncEventId, event.syncEventId, "communitySync.syncEventId");
  requireExact(readback.communitySync.idempotencyKey, event.idempotencyKey, "communitySync.idempotencyKey");
  requireExact(readback.communityWork.workItemId, event.workItemId, "communityWork.workItemId");
  requireExact(readback.communityWork.syncEventId, event.syncEventId, "communityWork.syncEventId");
  requireExact(
    readback.communityWork.sourceSnapshotKey,
    event.sourceSnapshotKey,
    "communityWork.sourceSnapshotKey"
  );
  requireExact(readback.socialCoinEvent.eventId, event.syncEventId, "socialCoinEvent.eventId");
  requireExact(readback.socialCoinEvent.idempotencyKey, event.idempotencyKey, "socialCoinEvent.idempotencyKey");
  requireExact(readback.socialCoinEvent.points, 1, "socialCoinEvent.points");
  requireOneOf(
    readback.socialCoinEvent.verificationStatus,
    ["IDENTITY_PENDING", "IDENTITY_RESOLVED"],
    "socialCoinEvent.verificationStatus"
  );
  requireOneOf(
    readback.socialCoinEvent.coinWriteStatus,
    ["NOT_WRITTEN", "WRITE_PREPARED", "WRITTEN"],
    "socialCoinEvent.coinWriteStatus"
  );

  return data;
}

function validateDmReadback(event, response) {
  const data = response?.data;
  if (!data?.readback?.communitySync) {
    throw serviceError(
      "META_BIRDIE_OS_READBACK_INVALID",
      "BirdieOS must read back the DM sync row",
      502
    );
  }
  requireExact(data.syncEventId, event.syncEventId, "syncEventId");
  requireExact(data.idempotencyKey, event.idempotencyKey, "idempotencyKey");
  requireExact(data.readback.communitySync.syncEventId, event.syncEventId, "communitySync.syncEventId");
  return data;
}

function buildMessagingUrl({
  apiVersion,
  appSecret,
  graphHost,
  messagingAccountId,
  messagingAccessToken,
  resource = "messages"
}) {
  const host = required(graphHost, "META_MESSAGING_GRAPH_HOST").toLowerCase();
  if (!ALLOWED_MESSAGING_GRAPH_HOSTS.has(host)) {
    throw serviceError(
      "META_MESSAGING_HOST_INVALID",
      "META_MESSAGING_GRAPH_HOST must be a supported Meta Graph host",
      503
    );
  }

  const token = required(messagingAccessToken, "META_MESSAGING_ACCESS_TOKEN");
  const secret = required(appSecret, "META_APP_SECRET");
  const accountId = required(messagingAccountId, "META_MESSAGING_ACCOUNT_ID");
  if (!new Set(["messages", "conversations"]).has(resource)) {
    throw serviceError("META_MESSAGING_RESOURCE_INVALID", "Unsupported Meta resource", 500);
  }
  const proof = createHmac("sha256", secret).update(token).digest("hex");
  const url = new URL(
    `https://${host}/${required(apiVersion, "META_API_VERSION")}/${encodeURIComponent(accountId)}/${resource}`
  );
  url.searchParams.set("appsecret_proof", proof);
  return { token, url };
}

export function createMetaCommunityService({
  birdieOSPost,
  fetchImpl = fetch,
  metaAppId = process.env.META_APP_ID,
  appSecret = process.env.META_APP_SECRET,
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN,
  instagramAccountId = process.env.META_INSTAGRAM_ACCOUNT_ID,
  messagingAccessToken = process.env.META_MESSAGING_ACCESS_TOKEN,
  messagingAccountId = process.env.META_MESSAGING_ACCOUNT_ID,
  messagingGraphHost = process.env.META_MESSAGING_GRAPH_HOST || DEFAULT_MESSAGING_GRAPH_HOST,
  apiVersion = process.env.META_API_VERSION || DEFAULT_API_VERSION,
  sourceAccount = process.env.META_INSTAGRAM_USERNAME || "birdieandbreakfast",
  oauthRedirectUri = process.env.META_OAUTH_REDIRECT_URI,
  oauthStateSecret = process.env.META_OAUTH_STATE_SECRET,
  oauthPageId = process.env.META_OAUTH_PAGE_ID || messagingAccountId,
  oauthInstagramAccountId = process.env.META_OAUTH_INSTAGRAM_ACCOUNT_ID || instagramAccountId,
  oauthStateTtlMs,
  oauthStateStore,
  storeMetaCredential,
  now,
  randomBytesImpl
}) {
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");

  const oauthFlow = createMetaPageOAuthFlow({
    appId: metaAppId,
    appSecret,
    redirectUri: oauthRedirectUri,
    pageId: oauthPageId,
    instagramAccountId: oauthInstagramAccountId,
    apiVersion,
    stateSecret: oauthStateSecret,
    stateTtlMs: oauthStateTtlMs,
    stateStore: oauthStateStore,
    storeMetaCredential,
    fetchImpl,
    now,
    randomBytesImpl
  });

  function verifyChallenge(params) {
    const mode = String(params.get("hub.mode") ?? "");
    const token = String(params.get("hub.verify_token") ?? "");
    const challenge = String(params.get("hub.challenge") ?? "");
    if (
      mode !== "subscribe" ||
      !challenge ||
      token !== required(verifyToken, "META_WEBHOOK_VERIFY_TOKEN")
    ) {
      return null;
    }
    return challenge;
  }

  async function ingestWebhook(rawBody, signatureHeader) {
    if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
      throw serviceError(
        "META_WEBHOOK_SIGNATURE_INVALID",
        "Invalid Meta webhook signature",
        401
      );
    }

    let payload;
    try {
      const text = Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : String(rawBody ?? "");
      payload = JSON.parse(text);
    } catch {
      throw serviceError("INVALID_JSON", "Meta webhook body must be valid JSON", 400);
    }

    const events = normalizeMetaWebhook(payload, {
      sourceAccount,
      instagramAccountId: required(
        instagramAccountId,
        "META_INSTAGRAM_ACCOUNT_ID"
      )
    });
    const results = [];
    for (const event of events) {
      const response = await birdieOSPost({
        action: "appendCommunitySyncEvent",
        event,
        source: "Birdie Agent Meta Adapter"
      });
      const data = event.eventType === "IG_COMMENT"
        ? validateCommentReadback(event, response)
        : validateDmReadback(event, response);
      results.push({
        syncEventId: event.syncEventId,
        workItemId: event.workItemId ?? null,
        idempotencyKey: event.idempotencyKey,
        birdieOS: data
      });
    }

    return { received: true, eventCount: events.length, events: results };
  }

  async function postMessage(body) {
    const { token, url } = buildMessagingUrl({
      apiVersion,
      appSecret,
      graphHost: messagingGraphHost,
      messagingAccountId,
      messagingAccessToken
    });
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw: raw.slice(0, 500) };
    }
    if (!response.ok) {
      const error = serviceError(
        "META_MESSAGING_ERROR",
        `Meta messaging HTTP ${response.status}`,
        response.status
      );
      error.details = data;
      throw error;
    }
    return data;
  }

  async function listInstagramConversations({ limit = 1, after } = {}) {
    const parsedLimit = Number(limit);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit !== MAX_CONVERSATIONS_LIMIT) {
      throw serviceError(
        "META_CONVERSATIONS_LIMIT_INVALID",
        `Meta conversations limit must be exactly ${MAX_CONVERSATIONS_LIMIT}`,
        400
      );
    }
    const expectedPageId = requiredMetaId(oauthPageId, "META_OAUTH_PAGE_ID");
    const expectedInstagramId = requiredMetaId(
      oauthInstagramAccountId,
      "META_OAUTH_INSTAGRAM_ACCOUNT_ID"
    );
    const webhookInstagramId = requiredMetaId(
      instagramAccountId,
      "META_INSTAGRAM_ACCOUNT_ID"
    );
    if (expectedInstagramId !== webhookInstagramId) {
      throw serviceError(
        "META_CONVERSATIONS_INSTAGRAM_ACCOUNT_MISMATCH",
        "META_OAUTH_INSTAGRAM_ACCOUNT_ID must match META_INSTAGRAM_ACCOUNT_ID",
        503
      );
    }
    if (String(messagingAccountId ?? "") !== expectedPageId) {
      throw serviceError(
        "META_CONVERSATIONS_ACCOUNT_MISMATCH",
        "META_MESSAGING_ACCOUNT_ID must match META_OAUTH_PAGE_ID",
        503
      );
    }
    if (String(messagingGraphHost ?? "").toLowerCase() !== "graph.facebook.com") {
      throw serviceError(
        "META_CONVERSATIONS_ROUTE_INVALID",
        "Legacy Page conversations require graph.facebook.com",
        503
      );
    }

    const cursor = String(after ?? "").trim();
    if (cursor && !/^[A-Za-z0-9._~-]{1,512}$/.test(cursor)) {
      throw serviceError(
        "META_CONVERSATIONS_CURSOR_INVALID",
        "Meta conversations cursor is invalid",
        400
      );
    }

    const { token, url } = buildMessagingUrl({
      apiVersion,
      appSecret,
      graphHost: messagingGraphHost,
      messagingAccountId,
      messagingAccessToken,
      resource: "conversations"
    });
    url.searchParams.set("platform", "instagram");
    url.searchParams.set("fields", "id");
    url.searchParams.set("limit", String(parsedLimit));
    if (cursor) url.searchParams.set("after", cursor);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      });
    } catch {
      throw serviceError(
        "META_CONVERSATIONS_ERROR",
        "Meta conversations request failed",
        502
      );
    }
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw serviceError(
        "META_CONVERSATIONS_ERROR",
        "Meta conversations returned invalid JSON",
        502
      );
    }
    if (!response.ok) {
      throw serviceError(
        "META_CONVERSATIONS_ERROR",
        `Meta conversations HTTP ${response.status}`,
        response.status >= 400 && response.status < 500 ? response.status : 502
      );
    }

    const conversations = (Array.isArray(data?.data) ? data.data : [])
      .map((item) => String(item?.id ?? "").trim())
      .filter((id) => /^[A-Za-z0-9._~-]{1,128}$/.test(id))
      .slice(0, MAX_CONVERSATIONS_LIMIT)
      .map((id) => ({ id }));
    const providerCursor = String(data?.paging?.cursors?.after ?? "").trim();
    const nextCursor = /^[A-Za-z0-9._~-]{1,512}$/.test(providerCursor)
      ? providerCursor
      : "";
    return {
      count: conversations.length,
      conversations,
      hasNext: Boolean(nextCursor),
      nextCursor: nextCursor || null
    };
  }

  const sendPrivateReply = ({ commentId, text }) =>
    postMessage({
      recipient: { comment_id: required(commentId, "commentId") },
      message: { text: required(text, "text") }
    });

  const sendResponseMessage = ({ recipientId, text }) =>
    postMessage({
      recipient: { id: required(recipientId, "recipientId") },
      messaging_type: "RESPONSE",
      message: { text: required(text, "text") }
    });

  return {
    verifyChallenge,
    ingestWebhook,
    startOAuth: oauthFlow.createAuthorizationUrl,
    completeOAuth: oauthFlow.completeAuthorization,
    listInstagramConversations,
    sendPrivateReply,
    sendResponseMessage
  };
}
