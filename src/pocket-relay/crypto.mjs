import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify
} from "node:crypto";
import { PocketRelayProtocolError } from "./contract.mjs";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

export function base64UrlDecode(value, field = "base64url") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PocketRelayProtocolError("ENCODING_INVALID", `${field} must be unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || base64UrlEncode(decoded) !== value) {
    throw new PocketRelayProtocolError("ENCODING_INVALID", `${field} is not canonical base64url`);
  }
  return decoded;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest();
}

export function sha256Fingerprint(value) {
  return base64UrlEncode(sha256(value));
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function publicKeyFromRawEd25519(rawKey) {
  const raw = Buffer.from(rawKey);
  if (raw.length !== 32) {
    throw new PocketRelayProtocolError("DEVICE_PUBLIC_KEY_INVALID", "Ed25519 public key must contain 32 bytes");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki"
  });
}

export function rawEd25519PublicKey(publicKey) {
  const der = Buffer.from(publicKey.export({ format: "der", type: "spki" }));
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new PocketRelayProtocolError("PUBLIC_KEY_INVALID", "key is not Ed25519 SPKI");
  }
  return der.subarray(ED25519_SPKI_PREFIX.length);
}

export function generateEd25519Identity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    privateKey,
    publicKeyRaw: rawEd25519PublicKey(publicKey)
  };
}

export function importEd25519PrivateKey(pkcs8Der) {
  return createPrivateKey({ key: Buffer.from(pkcs8Der), format: "der", type: "pkcs8" });
}

export function signEd25519(payload, privateKey) {
  return sign(null, Buffer.from(payload), privateKey);
}

export function verifyEd25519(payload, signature, publicKey) {
  try {
    return verify(null, Buffer.from(payload), publicKey, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function hmacSha256(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest();
}
