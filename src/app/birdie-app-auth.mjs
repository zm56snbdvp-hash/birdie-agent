import { createRemoteJWKSet, jwtVerify } from "jose";

export const BIRDIE_APP_SCOPE = "birdie-world:access";

const BIRDIE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CLAIM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:/._-]{0,299}$/;

export class BirdieAppAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = "BirdieAppAuthError";
    this.code = code;
    this.status = status;
  }
}

function trustedUrl(value, field) {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`${field} must use HTTPS`);
  }
  return url;
}

function normalizeIssuer(value) {
  const url = trustedUrl(value, "BIRDIE_APP_OAUTH_ISSUER");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function normalizeAudience(value) {
  const audience = String(value ?? "").trim();
  if (!audience || audience.length > 500) {
    throw new Error("BIRDIE_APP_OAUTH_AUDIENCE is invalid");
  }
  return audience;
}

function scopesFromPayload(payload) {
  const scopes = new Set(
    String(payload.scope || "").split(/\s+/).filter(Boolean)
  );
  if (Array.isArray(payload.permissions)) {
    for (const permission of payload.permissions) {
      const scope = String(permission || "").trim();
      if (scope) scopes.add(scope);
    }
  }
  return scopes;
}

function disabledConfig(missing) {
  return Object.freeze({
    enabled: false,
    missing: Object.freeze([...missing]),
    requiredScope: BIRDIE_APP_SCOPE
  });
}

export function createBirdieAppAuthConfig(env = process.env) {
  const values = {
    BIRDIE_APP_OAUTH_ISSUER: String(env.BIRDIE_APP_OAUTH_ISSUER ?? "").trim(),
    BIRDIE_APP_OAUTH_AUDIENCE: String(env.BIRDIE_APP_OAUTH_AUDIENCE ?? "").trim(),
    BIRDIE_APP_BIRDIE_ID_CLAIM: String(env.BIRDIE_APP_BIRDIE_ID_CLAIM ?? "").trim()
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return disabledConfig(missing);

  const issuer = normalizeIssuer(values.BIRDIE_APP_OAUTH_ISSUER);
  const audience = normalizeAudience(values.BIRDIE_APP_OAUTH_AUDIENCE);
  const birdieIdClaim = values.BIRDIE_APP_BIRDIE_ID_CLAIM;
  if (!CLAIM_NAME_PATTERN.test(birdieIdClaim)) {
    throw new Error("BIRDIE_APP_BIRDIE_ID_CLAIM is invalid");
  }
  const jwksUrl = String(env.BIRDIE_APP_OAUTH_JWKS_URL ?? "").trim() ||
    new URL(".well-known/jwks.json", issuer).toString();
  trustedUrl(jwksUrl, "BIRDIE_APP_OAUTH_JWKS_URL");

  return {
    enabled: true,
    issuer,
    audience,
    birdieIdClaim,
    jwksUrl,
    requiredScope: BIRDIE_APP_SCOPE,
    jwks: createRemoteJWKSet(new URL(jwksUrl))
  };
}

export async function authenticateBirdieAppRequest(req, { config }) {
  if (!config?.enabled) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_AUTH_NOT_CONFIGURED",
      "BirdieWorld app authentication is not configured",
      503
    );
  }

  const authorization = String(req?.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_UNAUTHENTICATED",
      "A BirdieWorld bearer token is required",
      401
    );
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_UNAUTHENTICATED",
      "A BirdieWorld bearer token is required",
      401
    );
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, config.jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"]
    }));
  } catch {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_TOKEN_INVALID",
      "The BirdieWorld access token is invalid",
      401
    );
  }

  const subject = String(payload.sub ?? "").trim();
  if (!subject) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_TOKEN_INVALID",
      "The BirdieWorld access token has no subject",
      401
    );
  }
  const scopes = scopesFromPayload(payload);
  if (!scopes.has(config.requiredScope)) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_SCOPE_REQUIRED",
      `The BirdieWorld token requires ${config.requiredScope}`,
      403
    );
  }

  const birdieId = String(payload[config.birdieIdClaim] ?? "").trim();
  if (!BIRDIE_ID_PATTERN.test(birdieId)) {
    throw new BirdieAppAuthError(
      "BIRDIE_APP_BIRDIE_ID_REQUIRED",
      "The BirdieWorld token has no valid Birdie identity",
      403
    );
  }

  return { type: "oauth", subject, birdieId, scopes };
}
