import { readFileSync } from "node:fs";

const assets = new Map([
  ["/supporter", ["text/html; charset=utf-8", "../../public/supporter/index.html"]],
  ["/supporter/", ["text/html; charset=utf-8", "../../public/supporter/index.html"]],
  ["/supporter/styles.css", ["text/css; charset=utf-8", "../../public/supporter/styles.css"]],
  ["/supporter/app.js", ["text/javascript; charset=utf-8", "../../public/supporter/app.js"]]
].map(([pathname, [contentType, relativePath]]) => [
  pathname,
  {
    contentType,
    body: readFileSync(new URL(relativePath, import.meta.url))
  }
]));

const COOKIE_NAME = "__Host-birdie_session";
const rateWindows = new Map();

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return forwarded.length > 1
    ? forwarded[forwarded.length - 2]
    : forwarded[0] || req.socket?.remoteAddress || "unknown";
}

function consumeRateLimit(req, bucket, limit, windowMs) {
  const now = Date.now();
  if (rateWindows.size > 2_000) {
    for (const [key, value] of rateWindows) {
      if (value.resetAt <= now) rateWindows.delete(key);
    }
  }
  const key = `${bucket}:${clientAddress(req)}`;
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    const error = new Error("Too many authentication attempts");
    error.code = "AUTH_RATE_LIMITED";
    error.status = 429;
    throw error;
  }
  current.count += 1;
}

function sendAsset(res, asset) {
  res.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": asset.body.length,
    "Cache-Control": asset.contentType.startsWith("text/html")
      ? "no-store"
      : "public, max-age=300",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  res.end(asset.body);
}

function result(data, extra = {}) {
  return {
    success: true,
    authoritative: true,
    source: "BIRDIE_OS",
    ...extra,
    data
  };
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return "";
}

function requestToken(req) {
  return cookieValue(req, COOKIE_NAME);
}

function requireSameOrigin(req) {
  const origin = String(req.headers.origin || "");
  const host = String(req.headers.host || "").toLowerCase();
  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    // Rejected below with the same non-enumerating CSRF error.
  }
  if (!host || originHost !== host) {
    const error = new Error("Request origin is not allowed");
    error.code = "INVALID_REQUEST_ORIGIN";
    error.status = 403;
    throw error;
  }
}

function requireJson(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.code = "JSON_CONTENT_TYPE_REQUIRED";
    error.status = 415;
    throw error;
  }
}

function setSessionCookie(res, token, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge)}; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

export async function routeSupporterRequest({
  req,
  res,
  url,
  json,
  readBody,
  authService,
  coinService
}) {
  if (!url.pathname.startsWith("/supporter")) return false;

  if (req.method !== "GET" && req.method !== "HEAD") {
    requireSameOrigin(req);
  }

  const asset = req.method === "GET" ? assets.get(url.pathname) : null;
  if (asset) {
    sendAsset(res, asset);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/supporter/api/auth/request-code") {
    requireJson(req);
    consumeRateLimit(req, "request-code", 5, 15 * 60 * 1000);
    const data = await authService.requestCode(await readBody(req, 16 * 1024));
    json(res, 202, result(data, { authoritative: false, source: "BIRDIE_SUPPORTER_AUTH" }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/supporter/api/auth/verify-code") {
    requireJson(req);
    consumeRateLimit(req, "verify-code", 20, 10 * 60 * 1000);
    const verified = await authService.verifyCode(await readBody(req, 16 * 1024));
    setSessionCookie(res, verified.sessionToken, verified.expiresInSeconds);
    json(res, 200, result({
      profile: verified.profile,
      expiresAt: verified.expiresAt
    }, { source: "BIRDIE_SUPPORTER_AUTH" }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/supporter/api/auth/logout") {
    const token = requestToken(req);
    await authService.authorize(token);
    authService.verifyCsrf(token, req.headers["x-birdie-csrf"]);
    await authService.revoke(token);
    clearSessionCookie(res);
    json(res, 200, result({ revoked: true }, { source: "BIRDIE_SUPPORTER_AUTH" }));
    return true;
  }

  const token = requestToken(req);
  const authorized = await authService.authorize(token);
  const profile = authorized.profile;

  if (req.method === "GET" && url.pathname === "/supporter/api/bootstrap") {
    const [ledger, rewards] = await Promise.all([
      coinService.getLedger(profile.birdieId),
      coinService.listRewards(profile.accountType)
    ]);
    json(res, 200, result({
      profile,
      ledger,
      rewards: rewards.rewards || rewards,
      config: coinService.getConfig(),
      csrfToken: authService.csrfToken(token)
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/supporter/api/claims") {
    requireJson(req);
    authService.verifyCsrf(token, req.headers["x-birdie-csrf"]);
    const body = await readBody(req, 32 * 1024);
    const claim = await coinService.createClaim({
      ...body,
      birdieId: profile.birdieId
    });
    json(res, 201, result(claim));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/supporter/api/redemptions") {
    requireJson(req);
    authService.verifyCsrf(token, req.headers["x-birdie-csrf"]);
    const body = await readBody(req, 16 * 1024);
    const redemption = await coinService.createRedemption({
      ...body,
      birdieId: profile.birdieId
    });
    json(res, 201, result(redemption));
    return true;
  }

  json(res, 404, {
    success: false,
    error: "SUPPORTER_ROUTE_NOT_FOUND"
  });
  return true;
}

export const supporterCookieName = COOKIE_NAME;
