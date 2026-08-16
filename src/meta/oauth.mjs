import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const META_PAGE_OAUTH_SCOPES = Object.freeze([
  "instagram_basic",
  "instagram_manage_messages",
  "pages_manage_metadata",
  "pages_show_list"
]);

const DEFAULT_API_VERSION = "v26.0";
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;
const GRAPH_ORIGIN = "https://graph.facebook.com";
const OAUTH_ORIGIN = "https://www.facebook.com";

function oauthError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result) {
    throw oauthError("META_OAUTH_CONFIG_MISSING", `${field} is required`, 503);
  }
  return result;
}

function requiredMetaId(value, field) {
  const result = required(value, field);
  if (!/^\d{5,30}$/.test(result)) {
    throw oauthError("META_OAUTH_CONFIG_INVALID", `${field} must be a Meta numeric ID`, 503);
  }
  return result;
}

function requiredRedirectUri(value) {
  const uri = required(value, "META_OAUTH_REDIRECT_URI");
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw oauthError(
      "META_OAUTH_CONFIG_INVALID",
      "META_OAUTH_REDIRECT_URI must be an absolute URL",
      503
    );
  }
  if (parsed.protocol !== "https:") {
    throw oauthError(
      "META_OAUTH_CONFIG_INVALID",
      "META_OAUTH_REDIRECT_URI must use HTTPS",
      503
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signState(payload, secret) {
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function stateStoreKey(nonce) {
  return createHash("sha256").update(nonce).digest("base64url");
}

function parseSignedState(value, secret) {
  const [encoded, suppliedSignature, extra] = String(value ?? "").split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) {
    throw oauthError("META_OAUTH_STATE_INVALID", "OAuth state is invalid", 400);
  }
  const expectedSignature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw oauthError("META_OAUTH_STATE_INVALID", "OAuth state is invalid", 400);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw oauthError("META_OAUTH_STATE_INVALID", "OAuth state is invalid", 400);
  }
  if (
    payload?.v !== 1 ||
    payload?.purpose !== "META_PAGE_OAUTH" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(String(payload?.nonce ?? "")) ||
    !Number.isSafeInteger(payload?.iat) ||
    !Number.isSafeInteger(payload?.exp)
  ) {
    throw oauthError("META_OAUTH_STATE_INVALID", "OAuth state is invalid", 400);
  }
  return payload;
}

function ensureStateStore(store) {
  if (
    !store ||
    typeof store.set !== "function" ||
    typeof store.get !== "function" ||
    typeof store.delete !== "function"
  ) {
    throw oauthError(
      "META_OAUTH_STATE_STORE_INVALID",
      "OAuth state store must support set, get and delete",
      503
    );
  }
  return store;
}

async function responseJson(response, failureCode) {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    throw oauthError(failureCode, "Meta OAuth provider response was unreadable", 502);
  }
  if (!response.ok) {
    throw oauthError(failureCode, `Meta OAuth provider HTTP ${response.status}`, 502);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw oauthError(failureCode, "Meta OAuth provider returned invalid JSON", 502);
  }
}

function tokenProof(token, appSecret) {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

export function createMetaPageOAuthFlow({
  appId,
  appSecret,
  redirectUri,
  pageId,
  instagramAccountId,
  apiVersion = DEFAULT_API_VERSION,
  stateSecret,
  stateTtlMs = DEFAULT_STATE_TTL_MS,
  stateStore = new Map(),
  storeMetaCredential,
  fetchImpl = fetch,
  now = Date.now,
  randomBytesImpl = randomBytes
} = {}) {
  const states = ensureStateStore(stateStore);
  let credentialStoreVerificationRequired = false;

  function requireKnownCredentialStoreOutcome() {
    if (credentialStoreVerificationRequired) {
      throw oauthError(
        "META_OAUTH_CREDENTIAL_STORE_VERIFICATION_REQUIRED",
        "Verify Secret Manager before starting or completing another OAuth attempt",
        503
      );
    }
  }

  function configuration() {
    const secret = required(appSecret, "META_APP_SECRET");
    const stateSigningSecret = required(stateSecret, "META_OAUTH_STATE_SECRET");
    if (Buffer.byteLength(stateSigningSecret, "utf8") < 32) {
      throw oauthError(
        "META_OAUTH_CONFIG_INVALID",
        "META_OAUTH_STATE_SECRET must contain at least 32 bytes",
        503
      );
    }
    const ttl = Number(stateTtlMs);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 15 * 60 * 1000) {
      throw oauthError(
        "META_OAUTH_CONFIG_INVALID",
        "OAuth state TTL must be between 1 millisecond and 15 minutes",
        503
      );
    }
    return {
      appId: requiredMetaId(appId, "META_APP_ID"),
      appSecret: secret,
      redirectUri: requiredRedirectUri(redirectUri),
      pageId: requiredMetaId(pageId, "META_OAUTH_PAGE_ID"),
      instagramAccountId: requiredMetaId(
        instagramAccountId,
        "META_OAUTH_INSTAGRAM_ACCOUNT_ID"
      ),
      apiVersion: required(apiVersion, "META_API_VERSION"),
      stateSecret: stateSigningSecret,
      stateTtlMs: ttl
    };
  }

  function issueState(config) {
    const current = Number(now());
    if (!Number.isSafeInteger(current)) {
      throw oauthError("META_OAUTH_CLOCK_INVALID", "OAuth clock is invalid", 503);
    }
    for (const [nonce, expiry] of states.entries?.() ?? []) {
      if (Number(expiry) < current) states.delete(nonce);
    }
    const nonce = Buffer.from(randomBytesImpl(32)).toString("base64url");
    const payload = {
      v: 1,
      purpose: "META_PAGE_OAUTH",
      nonce,
      iat: current,
      exp: current + config.stateTtlMs
    };
    states.set(stateStoreKey(nonce), payload.exp);
    return signState(payload, config.stateSecret);
  }

  function consumeState(value, config) {
    const payload = parseSignedState(value, config.stateSecret);
    const current = Number(now());
    const key = stateStoreKey(payload.nonce);
    const recordedExpiry = Number(states.get(key));
    if (!Number.isSafeInteger(recordedExpiry)) {
      throw oauthError("META_OAUTH_STATE_REPLAYED", "OAuth state was already used", 400);
    }
    states.delete(key);
    if (payload.exp !== recordedExpiry || current > payload.exp) {
      throw oauthError("META_OAUTH_STATE_EXPIRED", "OAuth state has expired", 400);
    }
    return payload;
  }

  async function graphGet(path, token, config, params = {}) {
    const url = new URL(`${GRAPH_ORIGIN}/${config.apiVersion}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("appsecret_proof", tokenProof(token, config.appSecret));
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      });
    } catch {
      throw oauthError("META_OAUTH_PROVIDER_FAILED", "Meta OAuth provider request failed", 502);
    }
    return responseJson(response, "META_OAUTH_PROVIDER_FAILED");
  }

  function createAuthorizationUrl() {
    const config = configuration();
    requireKnownCredentialStoreOutcome();
    if (typeof storeMetaCredential !== "function") {
      throw oauthError(
        "META_OAUTH_CREDENTIAL_SINK_MISSING",
        "A governed secret credential sink is required before OAuth start",
        503
      );
    }
    const state = issueState(config);
    const url = new URL(`${OAUTH_ORIGIN}/${config.apiVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_PAGE_OAUTH_SCOPES.join(","));
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      expiresInSeconds: Math.ceil(config.stateTtlMs / 1000)
    };
  }

  async function completeAuthorization(searchParams) {
    const config = configuration();
    requireKnownCredentialStoreOutcome();
    const params = searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams ?? {});
    consumeState(params.get("state"), config);

    if (params.has("error")) {
      throw oauthError(
        "META_OAUTH_PROVIDER_REJECTED",
        "Meta OAuth authorization was not granted",
        400
      );
    }
    const code = String(params.get("code") ?? "").trim();
    if (!code) {
      throw oauthError("META_OAUTH_CODE_MISSING", "Meta OAuth code is missing", 400);
    }
    if (typeof storeMetaCredential !== "function") {
      throw oauthError(
        "META_OAUTH_CREDENTIAL_SINK_MISSING",
        "A governed secret credential sink is required before OAuth exchange",
        503
      );
    }

    const exchangeBody = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code
    });
    let exchangeResponse;
    try {
      exchangeResponse = await fetchImpl(
        `${GRAPH_ORIGIN}/${config.apiVersion}/oauth/access_token`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: exchangeBody
        }
      );
    } catch {
      throw oauthError("META_OAUTH_EXCHANGE_FAILED", "Meta OAuth code exchange failed", 502);
    }
    const exchange = await responseJson(exchangeResponse, "META_OAUTH_EXCHANGE_FAILED");
    const userAccessToken = String(exchange?.access_token ?? "").trim();
    if (!userAccessToken) {
      throw oauthError(
        "META_OAUTH_EXCHANGE_FAILED",
        "Meta OAuth code exchange returned no access token",
        502
      );
    }

    const permissions = await graphGet("me/permissions", userAccessToken, config, {
      fields: "permission,status",
      limit: 100
    });
    const granted = new Set(
      (Array.isArray(permissions?.data) ? permissions.data : [])
        .filter((item) => item?.status === "granted")
        .map((item) => String(item?.permission ?? ""))
    );
    if (META_PAGE_OAUTH_SCOPES.some((scope) => !granted.has(scope))) {
      throw oauthError(
        "META_OAUTH_SCOPE_MISMATCH",
        "Meta OAuth did not grant every required Page messaging scope",
        403
      );
    }

    const accounts = await graphGet("me/accounts", userAccessToken, config, {
      fields: "id,access_token,instagram_business_account{id}",
      limit: 100
    });
    const page = (Array.isArray(accounts?.data) ? accounts.data : [])
      .find((item) => String(item?.id ?? "") === config.pageId);
    if (!page) {
      throw oauthError(
        "META_OAUTH_PAGE_MISMATCH",
        "Configured Facebook Page was not returned by Meta OAuth",
        403
      );
    }
    if (
      String(page?.instagram_business_account?.id ?? "") !==
      config.instagramAccountId
    ) {
      throw oauthError(
        "META_OAUTH_INSTAGRAM_ACCOUNT_MISMATCH",
        "Configured Instagram account is not linked to the configured Facebook Page",
        403
      );
    }
    const pageAccessToken = String(page?.access_token ?? "").trim();
    if (!pageAccessToken) {
      throw oauthError(
        "META_OAUTH_PAGE_TOKEN_MISSING",
        "Meta OAuth returned no token for the configured Facebook Page",
        502
      );
    }

    const verifiedPage = await graphGet(config.pageId, pageAccessToken, config, {
      fields: "id,instagram_business_account{id}"
    });
    if (String(verifiedPage?.id ?? "") !== config.pageId) {
      throw oauthError(
        "META_OAUTH_PAGE_MISMATCH",
        "Meta Page token did not verify the configured Facebook Page",
        403
      );
    }
    if (
      String(verifiedPage?.instagram_business_account?.id ?? "") !==
      config.instagramAccountId
    ) {
      throw oauthError(
        "META_OAUTH_INSTAGRAM_ACCOUNT_MISMATCH",
        "Meta Page token did not verify the configured Instagram account",
        403
      );
    }

    try {
      await storeMetaCredential({
        provider: "META",
        route: "FACEBOOK_PAGE",
        accessToken: pageAccessToken,
        accountId: config.pageId,
        instagramAccountId: config.instagramAccountId,
        graphHost: "graph.facebook.com",
        scopes: [...META_PAGE_OAUTH_SCOPES],
        observedAt: new Date(Number(now())).toISOString()
      });
    } catch (error) {
      if (error?.code === "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN") {
        credentialStoreVerificationRequired = true;
        throw oauthError(
          "META_OAUTH_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
          "Credential storage outcome is unknown; verify Secret Manager before a new OAuth attempt",
          502
        );
      }
      throw oauthError(
        "META_OAUTH_CREDENTIAL_STORE_FAILED",
        "Governed Meta credential storage failed",
        502
      );
    }

    return {
      provider: "META",
      route: "FACEBOOK_PAGE",
      accountId: config.pageId,
      instagramAccountId: config.instagramAccountId,
      graphHost: "graph.facebook.com",
      scopes: [...META_PAGE_OAUTH_SCOPES],
      credentialStored: true
    };
  }

  return {
    createAuthorizationUrl,
    completeAuthorization
  };
}
