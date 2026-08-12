import crypto from "node:crypto";

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

function isoTime(value) {
  if (!value) return new Date().toISOString();
  const n = Number(value);
  if (!Number.isFinite(n)) return new Date().toISOString();
  return new Date(n > 10_000_000_000 ? n : n * 1000).toISOString();
}

function compact(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  const secret = required(appSecret, "META_APP_SECRET");
  const supplied = String(signatureHeader ?? "").trim();
  if (!supplied.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeMetaWebhook(payload, { sourceAccount = "birdieandbreakfast" } = {}) {
  const events = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (String(change?.field || "").toLowerCase() !== "comments") continue;
      const v = change?.value || {};
      const commentId = String(v.id || v.comment_id || "").trim();
      const username = String(v.from?.username || v.username || "").trim();
      const scopedId = String(v.from?.id || v.user_id || "").trim();
      const externalUserId = username || scopedId;
      if (!commentId || !externalUserId) continue;
      events.push({
        syncEventId: `META-IG-COMMENT-${commentId}`,
        sourceType: "INSTAGRAM",
        sourceAccount,
        sourceReference: commentId,
        externalUserId,
        eventType: "COMMENT",
        actionCode: "INSTAGRAM-COMMENT",
        payloadSummary: compact(`commentId=${commentId} | scopedId=${scopedId || "OPEN"} | username=${username || "OPEN"} | mediaId=${v.media?.id || v.media_id || "OPEN"} | text=${v.text || ""}`),
        detectedAt: isoTime(v.created_time || entry?.time),
        syncStatus: "PENDING",
        idempotencyKey: `INSTAGRAM|COMMENT|${commentId}`,
        notes: "Meta comments webhook ingested by Birdie Agent. Awaiting identity resolution and canonical claim/Coin processing."
      });
    }

    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const message = item?.message || {};
      const messageId = String(message.mid || "").trim();
      const senderId = String(item?.sender?.id || "").trim();
      if (!messageId || !senderId || message.is_echo === true) continue;
      events.push({
        syncEventId: `META-IG-DM-${messageId}`,
        sourceType: "INSTAGRAM",
        sourceAccount,
        sourceReference: messageId,
        externalUserId: senderId,
        eventType: "DM_RECEIVED",
        actionCode: "INSTAGRAM-DM",
        payloadSummary: compact(`messageId=${messageId} | senderScopedId=${senderId} | text=${message.text || ""}`),
        detectedAt: isoTime(item?.timestamp || entry?.time),
        syncStatus: "PENDING",
        idempotencyKey: `INSTAGRAM|DM|${messageId}`,
        notes: "Meta messages webhook ingested by Birdie Agent. Messaging eligibility originates from the user-initiated conversation."
      });
    }
  }
  return events;
}
