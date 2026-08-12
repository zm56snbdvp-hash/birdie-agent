import crypto from "node:crypto";

function equalSecret(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isFamilyAuthorized(req, familyApiKey) {
  const expected = String(familyApiKey ?? "").trim();
  if (!expected) return false;
  const bearer = String(req.headers.authorization ?? "");
  const custom = String(req.headers["x-birdie-family-key"] ?? "");
  return equalSecret(bearer, `Bearer ${expected}`) || equalSecret(custom, expected);
}
