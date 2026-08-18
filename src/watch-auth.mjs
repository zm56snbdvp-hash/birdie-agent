import crypto from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createWatchAuthConfig(env = process.env) {
  const apiKey = String(env.BIRDIE_WATCH_API_KEY || "").trim();
  return {
    enabled: apiKey.length >= 32,
    apiKey
  };
}

export function authenticateWatchRequest(req, config = createWatchAuthConfig()) {
  if (!config.enabled) return false;
  const bearer = String(req?.headers?.authorization || "");
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  return safeEqual(token, config.apiKey);
}

export function watchUnauthorized(json, res) {
  return json(res, 401, {
    success: false,
    error: "WATCH_UNAUTHORIZED",
    message: "Birdie Watch authentication failed."
  });
}
