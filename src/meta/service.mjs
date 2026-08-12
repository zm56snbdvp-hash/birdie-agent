import { normalizeMetaWebhook, verifyMetaSignature } from "./normalize.mjs";

const DEFAULT_API_VERSION = "v24.0";

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result) {
    const error = new Error(`${field} is required`);
    error.code = "META_CONFIG_MISSING";
    error.status = 503;
    throw error;
  }
  return result;
}

export function createMetaCommunityService({
  birdieOSPost,
  fetchImpl = fetch,
  appSecret = process.env.META_APP_SECRET,
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN,
  accessToken = process.env.META_INSTAGRAM_ACCESS_TOKEN,
  instagramAccountId = process.env.META_INSTAGRAM_ACCOUNT_ID,
  apiVersion = process.env.META_API_VERSION || DEFAULT_API_VERSION,
  sourceAccount = process.env.META_INSTAGRAM_USERNAME || "birdieandbreakfast"
}) {
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost is required");

  function verifyChallenge(params) {
    const mode = String(params.get("hub.mode") || "");
    const token = String(params.get("hub.verify_token") || "");
    const challenge = String(params.get("hub.challenge") || "");
    if (mode !== "subscribe" || !challenge || token !== required(verifyToken, "META_WEBHOOK_VERIFY_TOKEN")) return null;
    return challenge;
  }

  async function ingestWebhook(rawBody, signatureHeader) {
    if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
      const error = new Error("Invalid Meta webhook signature");
      error.code = "META_WEBHOOK_SIGNATURE_INVALID";
      error.status = 401;
      throw error;
    }

    let payload;
    try { payload = JSON.parse(rawBody || "{}"); }
    catch {
      const error = new Error("Meta webhook body must be valid JSON");
      error.code = "INVALID_JSON";
      error.status = 400;
      throw error;
    }

    const events = normalizeMetaWebhook(payload, { sourceAccount });
    const results = [];
    for (const event of events) {
      const response = await birdieOSPost({
        action: "appendCommunitySyncEvent",
        event,
        source: "Birdie Agent Meta Adapter"
      });
      results.push({
        syncEventId: event.syncEventId,
        idempotencyKey: event.idempotencyKey,
        birdieOS: response?.data ?? null
      });
    }
    return { received: true, eventCount: events.length, events: results };
  }

  async function postMessage(body) {
    const token = required(accessToken, "META_INSTAGRAM_ACCESS_TOKEN");
    const accountId = required(instagramAccountId, "META_INSTAGRAM_ACCOUNT_ID");
    const response = await fetchImpl(
      `https://graph.instagram.com/${apiVersion}/${encodeURIComponent(accountId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      }
    );
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { raw: raw.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(`Meta messaging HTTP ${response.status}`);
      error.code = "META_MESSAGING_ERROR";
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }

  const sendPrivateReply = ({ commentId, text }) => postMessage({
    recipient: { comment_id: required(commentId, "commentId") },
    message: { text: required(text, "text") }
  });

  const sendResponseMessage = ({ recipientId, text }) => postMessage({
    recipient: { id: required(recipientId, "recipientId") },
    messaging_type: "RESPONSE",
    message: { text: required(text, "text") }
  });

  return { verifyChallenge, ingestWebhook, sendPrivateReply, sendResponseMessage };
}
