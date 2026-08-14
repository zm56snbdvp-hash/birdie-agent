import crypto from "node:crypto";

function metaError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result) {
    throw metaError("META_CONFIG_MISSING", `${field} is required`, 503);
  }
  return result;
}

function compact(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function eventTimestamp(value) {
  let milliseconds;

  if (typeof value === "number" || /^\d+$/.test(String(value ?? "").trim())) {
    const numeric = Number(value);
    milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  } else {
    milliseconds = Date.parse(String(value ?? ""));
  }

  if (!Number.isFinite(milliseconds)) {
    throw metaError(
      "META_EVENT_TIMESTAMP_INVALID",
      "Meta event timestamp is required and must be valid"
    );
  }

  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw metaError(
      "META_EVENT_TIMESTAMP_INVALID",
      "Meta event timestamp is required and must be valid"
    );
  }
  return date.toISOString();
}

function instagramHandle(value, field = "username") {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) {
    throw metaError(
      "META_INSTAGRAM_HANDLE_INVALID",
      `${field} must be a valid Instagram handle`
    );
  }
  return normalized;
}

function commentReference(value) {
  const reference = String(value ?? "").trim();
  if (!/^\d{5,80}$/.test(reference)) {
    throw metaError(
      "META_COMMENT_SOURCE_REFERENCE_INVALID",
      "Instagram comment sourceReference must contain 5-80 numeric characters"
    );
  }
  return reference;
}

function instagramAccountReference(value, field = "instagramAccountId") {
  const reference = String(value ?? "").trim();
  if (!/^\d{5,80}$/.test(reference)) {
    throw metaError(
      "META_INSTAGRAM_ACCOUNT_ID_INVALID",
      `${field} must contain 5-80 numeric characters`
    );
  }
  return reference;
}

function messageReference(value) {
  const reference = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(reference)) {
    throw metaError(
      "META_DM_SOURCE_REFERENCE_INVALID",
      "Instagram message sourceReference is invalid"
    );
  }
  return reference;
}

function addUniqueEvent(eventsById, event) {
  const existing = eventsById.get(event.syncEventId);
  if (!existing) {
    eventsById.set(event.syncEventId, event);
    return;
  }
  if (JSON.stringify(existing) !== JSON.stringify(event)) {
    throw metaError(
      "META_EVENT_CONFLICT",
      `Conflicting Meta events share ${event.syncEventId}`
    );
  }
}

export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  const secret = required(appSecret, "META_APP_SECRET");
  const supplied = String(signatureHeader ?? "").trim();
  if (!/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;

  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ""), "utf8");
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeMetaWebhook(
  payload,
  { sourceAccount = "birdieandbreakfast", instagramAccountId } = {}
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw metaError("META_WEBHOOK_PAYLOAD_INVALID", "Meta webhook payload must be an object");
  }
  if (String(payload.object ?? "").toLowerCase() !== "instagram") {
    throw metaError("META_WEBHOOK_OBJECT_INVALID", "Meta webhook object must be instagram");
  }

  const account = instagramHandle(sourceAccount, "sourceAccount");
  const expectedAccountId = instagramAccountReference(instagramAccountId);
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const actualAccountId = instagramAccountReference(
      entry?.id,
      "entry.id"
    );
    if (actualAccountId !== expectedAccountId) {
      throw metaError(
        "META_WEBHOOK_ACCOUNT_MISMATCH",
        "Meta webhook entry does not belong to the configured Instagram account",
        403
      );
    }
  }
  const eventsById = new Map();

  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (String(change?.field ?? "").toLowerCase() !== "comments") continue;

      const value = change?.value ?? {};
      const verb = String(value.verb ?? "add").toLowerCase();
      if (!["add", "create", "created"].includes(verb)) continue;

      const sourceReference = commentReference(value.id ?? value.comment_id);
      const handle = instagramHandle(value.from?.username ?? value.username);
      const scopedId = String(value.from?.id ?? value.user_id ?? "").trim();
      const syncEventId = `SCE-IG-COMMENT-${sourceReference}`;
      const workItemId = `WORK-IG-COMMENT-${sourceReference}`;
      const sourceSnapshotKey = `SSK-IG-COMMENT-${sourceReference}`;

      addUniqueEvent(eventsById, {
        syncEventId,
        workItemId,
        sourceSnapshotKey,
        sourceType: "INSTAGRAM",
        sourceAccount: account,
        sourceReference,
        externalUserId: handle,
        eventType: "IG_COMMENT",
        actionCode: "IG_COMMENT",
        payloadSummary: compact(
          `commentId=${sourceReference} | scopedId=${scopedId || "OPEN"} | username=${handle} | mediaId=${value.media?.id ?? value.media_id ?? "OPEN"} | text=${value.text ?? ""}`
        ),
        detectedAt: eventTimestamp(value.created_time ?? entry?.time),
        syncStatus: "PENDING",
        idempotencyKey: `ig:ig_comment:${handle}:${sourceReference}`,
        notes:
          "Signed Meta comment webhook ingested. Identity and Coin writes remain pending governed processing."
      });
    }

    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const message = item?.message ?? {};
      if (message.is_echo === true) continue;

      const sourceReference = messageReference(message.mid);
      const senderId = messageReference(item?.sender?.id);
      const syncEventId = `SCE-IG-DM-${sourceReference}`;

      addUniqueEvent(eventsById, {
        syncEventId,
        sourceType: "INSTAGRAM",
        sourceAccount: account,
        sourceReference,
        externalUserId: senderId,
        eventType: "DM_RECEIVED",
        actionCode: "INSTAGRAM_DM",
        payloadSummary: compact(
          `messageId=${sourceReference} | senderScopedId=${senderId} | text=${message.text ?? ""}`
        ),
        detectedAt: eventTimestamp(item?.timestamp ?? entry?.time),
        syncStatus: "PENDING",
        idempotencyKey: `ig:dm:${senderId}:${sourceReference}`,
        notes: "Signed Meta DM webhook ingested queue-only; no Coin event is created."
      });
    }
  }

  return [...eventsById.values()];
}
