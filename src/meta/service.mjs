import { createHmac } from "node:crypto";

import { normalizeMetaWebhook, verifyMetaSignature } from "./normalize.mjs";

const DEFAULT_API_VERSION = "v24.0";
const DEFAULT_MESSAGING_GRAPH_HOST = "graph.instagram.com";
const ALLOWED_MESSAGING_GRAPH_HOSTS = new Set([
  "graph.facebook.com",
  "graph.instagram.com"
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
  messagingAccessToken
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
  const proof = createHmac("sha256", secret).update(token).digest("hex");
  const url = new URL(
    `https://${host}/${required(apiVersion, "META_API_VERSION")}/${encodeURIComponent(accountId)}/messages`
  );
  url.searchParams.set("appsecret_proof", proof);
  return { token, url };
}

export function createMetaCommunityService({
  birdieOSPost,
  fetchImpl = fetch,
  appSecret = process.env.META_APP_SECRET,
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN,
  accessToken = process.env.META_INSTAGRAM_ACCESS_TOKEN,
  instagramAccountId = process.env.META_INSTAGRAM_ACCOUNT_ID,
  messagingAccessToken = process.env.META_MESSAGING_ACCESS_TOKEN || accessToken,
  messagingAccountId = process.env.META_MESSAGING_ACCOUNT_ID || instagramAccountId,
  messagingGraphHost = process.env.META_MESSAGING_GRAPH_HOST || DEFAULT_MESSAGING_GRAPH_HOST,
  apiVersion = process.env.META_API_VERSION || DEFAULT_API_VERSION,
  sourceAccount = process.env.META_INSTAGRAM_USERNAME || "birdieandbreakfast"
}) {
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");

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
    sendPrivateReply,
    sendResponseMessage
  };
}
