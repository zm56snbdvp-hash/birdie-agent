import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^capture\.v1\.[0-9a-f-]{36}$/i;
const MAX_PARTS = 20;
const MAX_TEXT_BYTES = 1_048_576;

export class BirdieCaptureError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BirdieCaptureError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new BirdieCaptureError(code, message, status);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CAPTURE_REQUEST", `${label} must be an object`, 400);
  }
  return value;
}

function requiredString(value, label, pattern = null) {
  const normalized = String(value ?? "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    fail("INVALID_CAPTURE_REQUEST", `${label} is invalid`, 400);
  }
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function payloadDigest(body) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}

function validatePart(part) {
  object(part, "part");
  requiredString(part.partID, "partID", UUID_PATTERN);
  requiredString(part.kind, "kind", /^(text|url|image|pdf|file)$/);
  requiredString(part.displayName, "displayName");
  if (part.contentType !== undefined && part.contentType !== null) {
    requiredString(part.contentType, "contentType");
  }
  if (part.byteCount !== undefined && part.byteCount !== null &&
      (!Number.isSafeInteger(part.byteCount) || part.byteCount < 0)) {
    fail("INVALID_CAPTURE_REQUEST", "byteCount is invalid", 400);
  }
  if (part.sha256 !== undefined && part.sha256 !== null &&
      !/^[0-9a-f]{64}$/i.test(String(part.sha256))) {
    fail("INVALID_CAPTURE_REQUEST", "sha256 is invalid", 400);
  }
}

function validateRequest(body) {
  object(body, "capture request");
  if (body.birdieId !== undefined) {
    fail("CLIENT_BIRDIE_ID_FORBIDDEN", "birdieId is derived from the authenticated session", 403);
  }
  if (body.contract !== "birdie.capture.v1") {
    fail("UNSUPPORTED_CAPTURE_CONTRACT", "Only birdie.capture.v1 is supported", 400);
  }
  const captureID = requiredString(body.captureID, "captureID", UUID_PATTERN).toLowerCase();
  const idempotencyKey = requiredString(body.idempotencyKey, "idempotencyKey", IDEMPOTENCY_PATTERN).toLowerCase();
  if (idempotencyKey !== `capture.v1.${captureID}`) {
    fail("INVALID_CAPTURE_REQUEST", "idempotencyKey does not match captureID", 400);
  }
  const source = requiredString(body.source, "source", /^(share|lens)$/);
  const intent = requiredString(body.intent, "intent", /^(remember|summarize|prepareTask|sendToPC)$/);
  if (!Array.isArray(body.parts) || body.parts.length < 1 || body.parts.length > MAX_PARTS) {
    fail("INVALID_CAPTURE_REQUEST", "parts must contain 1 to 20 entries", 400);
  }
  body.parts.forEach(validatePart);
  const derivedText = body.derivedText === undefined || body.derivedText === null
    ? ""
    : String(body.derivedText);
  if (Buffer.byteLength(derivedText, "utf8") > MAX_TEXT_BYTES) {
    fail("PAYLOAD_TOO_LARGE", "derivedText exceeds the 1 MB limit", 413);
  }
  if (body.requiresUserReview !== true) {
    fail("USER_REVIEW_REQUIRED", "requiresUserReview must be true", 403);
  }
  if (body.originalPolicy !== "derivedTextOnly") {
    fail("ORIGINAL_UPLOAD_NOT_ENABLED", "Original uploads are not enabled on this route", 422);
  }
  if (body.pcTarget !== undefined && body.pcTarget !== null &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(String(body.pcTarget))) {
    fail("INVALID_CAPTURE_REQUEST", "pcTarget is invalid", 400);
  }
  return { captureID, idempotencyKey, source, intent, derivedText };
}

function session(authContext) {
  const birdieId = requiredString(authContext?.birdieId, "authenticated birdieId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/);
  const subject = requiredString(authContext?.subject, "authenticated subject", /^\S{1,300}$/);
  return { birdieId, subject };
}

export function createBirdieCaptureService({ storage, clock = () => new Date() }) {
  if (!storage || typeof storage.findByCaptureID !== "function" ||
      typeof storage.create !== "function" || typeof storage.delete !== "function") {
    throw new Error("capture storage must implement findByCaptureID, create and delete");
  }

  return {
    async submit(authContext, body) {
      const { birdieId, subject } = session(authContext);
      const normalized = validateRequest(body);
      const digest = payloadDigest(body);
      const existing = await storage.findByCaptureID(normalized.captureID);
      if (existing) {
        if (existing.birdieId !== birdieId || existing.idempotencyKey !== normalized.idempotencyKey) {
          fail("CAPTURE_SCOPE_CONFLICT", "Capture belongs to another authenticated Birdie", 403);
        }
        if (existing.payloadDigest !== digest) {
          fail("CAPTURE_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different content", 409);
        }
        return { ...existing, idempotent: true };
      }
      const record = {
        captureID: normalized.captureID,
        birdieId,
        subject,
        idempotencyKey: normalized.idempotencyKey,
        payloadDigest: digest,
        source: normalized.source,
        intent: normalized.intent,
        derivedText: normalized.derivedText,
        createdAt: new Date(clock()).toISOString(),
        serverReceiptID: `capture-receipt:${normalized.captureID}`,
        processingState: "accepted",
      };
      try {
        const created = await storage.create(record);
        return { ...created, idempotent: false };
      } catch (error) {
        if (error?.code !== "already_exists") throw error;
        const raced = await storage.findByCaptureID(normalized.captureID);
        if (!raced || raced.payloadDigest !== digest || raced.birdieId !== birdieId) {
          fail("CAPTURE_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different content", 409);
        }
        return { ...raced, idempotent: true };
      }
    },

    async remove(authContext, captureID) {
      const { birdieId } = session(authContext);
      const normalizedID = requiredString(captureID, "captureID", UUID_PATTERN).toLowerCase();
      const existing = await storage.findByCaptureID(normalizedID);
      if (!existing) return { captureID: normalizedID, deleted: false };
      if (existing.birdieId !== birdieId) {
        fail("CAPTURE_SCOPE_CONFLICT", "Capture belongs to another authenticated Birdie", 403);
      }
      await storage.delete(normalizedID);
      return { captureID: normalizedID, deleted: true };
    }
  };
}
