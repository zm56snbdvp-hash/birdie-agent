import { createRemoteJWKSet, jwtVerify } from "jose";

export const MAIL_SCOPES = Object.freeze([
  "mail.read",
  "mail.write",
  "mail.send",
  "mail.delete"
]);

export const OS_SCOPES = Object.freeze([
  "os.read"
]);

export const FRAMER_SCOPES = Object.freeze([
  "framer.read"
]);

export const MCP_SCOPES = Object.freeze([
  ...OS_SCOPES,
  ...FRAMER_SCOPES,
  ...MAIL_SCOPES
]);

const DEFAULT_ISSUER = "https://dev-dfveukr86fg3e8fr.eu.auth0.com/";
const DEFAULT_RESOURCE = "https://birdie-agent-893591677320.europe-west3.run.app";

function normalizedIssuer(value) {
  const url = new URL(value || DEFAULT_ISSUER);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function normalizedResource(value) {
  const url = new URL(value || DEFAULT_RESOURCE);
  return url.toString().replace(/\/$/, "");
}

export function createMcpAuthConfig(env = process.env) {
  const issuer = normalizedIssuer(env.BIRDIE_OAUTH_ISSUER);
  const resource = normalizedResource(env.BIRDIE_MCP_RESOURCE);
  const jwksUrl = env.BIRDIE_OAUTH_JWKS_URL || new URL(".well-known/jwks.json", issuer).toString();

  return {
    issuer,
    resource,
    jwksUrl,
    metadataUrl: `${resource}/.well-known/oauth-protected-resource`,
    scopes: MCP_SCOPES,
    jwks: createRemoteJWKSet(new URL(jwksUrl))
  };
}

export function protectedResourceMetadata(config) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...config.scopes],
    bearer_methods_supported: ["header"],
    resource_documentation:
      "https://github.com/zm56snbdvp-hash/birdie-agent#birdie-os-mcp"
  };
}

export function oauthChallenge(config, {
  scope = "os.read",
  error = "invalid_token",
  description = "A valid BirdieOS access token is required"
} = {}) {
  const safeDescription = String(description).replace(/["\r\n]/g, " ");
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${scope}", error="${error}", error_description="${safeDescription}"`;
}

function scopesFromPayload(payload) {
  const scopes = new Set();
  for (const scope of String(payload.scope || "").split(/\s+/).filter(Boolean)) scopes.add(scope);
  if (Array.isArray(payload.permissions)) {
    for (const permission of payload.permissions) scopes.add(String(permission));
  }
  return scopes;
}

export async function authenticateMcpRequest(req, { apiKey, config }) {
  const bearer = String(req.headers.authorization || "");
  const customHeader = String(req.headers["x-birdie-agent-key"] || "");

  if (customHeader === apiKey || bearer === `Bearer ${apiKey}`) {
    return { type: "api-key", subject: "birdie-agent", scopes: new Set(MCP_SCOPES) };
  }

  if (!bearer.startsWith("Bearer ")) return null;
  const token = bearer.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, config.jwks, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["RS256"]
    });
    if (!payload.sub) return null;
    return { type: "oauth", subject: payload.sub, scopes: scopesFromPayload(payload) };
  } catch {
    return null;
  }
}

export function fullMailAuthContext() {
  return { type: "internal", subject: "birdie-mail-test", scopes: new Set(MAIL_SCOPES) };
}

export function fullMcpAuthContext() {
  return { type: "internal", subject: "birdie-os-test", scopes: new Set(MCP_SCOPES) };
}
