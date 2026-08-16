import { META_PAGE_OAUTH_SCOPES } from "./oauth.mjs";

export const GCP_SECRET_MANAGER_CREDENTIAL_STORE = "GCP_SECRET_MANAGER";
export const META_PAGE_TOKEN_SECRET_ID = "META_MESSAGING_ACCESS_TOKEN";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const SECRET_MANAGER_ORIGIN = "https://secretmanager.googleapis.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_SECRET_BYTES = 16 * 1024;

function storeError(code, message, status = 503) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result) {
    throw storeError(
      "META_CREDENTIAL_STORE_CONFIG_MISSING",
      `${field} is required for the governed credential store`
    );
  }
  return result;
}

function requiredMetaId(value, field) {
  const result = required(value, field);
  if (!/^\d{5,30}$/.test(result)) {
    throw storeError(
      "META_CREDENTIAL_STORE_CONFIG_INVALID",
      `${field} must be a Meta numeric ID`
    );
  }
  return result;
}

function requiredProjectId(value) {
  const result = required(value, "META_MESSAGING_SECRET_PROJECT");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(result)) {
    throw storeError(
      "META_CREDENTIAL_STORE_CONFIG_INVALID",
      "META_MESSAGING_SECRET_PROJECT must be a Google Cloud project ID"
    );
  }
  return result;
}

function requiredSecretId(value) {
  const result = required(value, "META_MESSAGING_ACCESS_TOKEN_SECRET_ID");
  if (result !== META_PAGE_TOKEN_SECRET_ID) {
    throw storeError(
      "META_CREDENTIAL_STORE_TARGET_INVALID",
      `The governed credential store may write only ${META_PAGE_TOKEN_SECRET_ID}`
    );
  }
  return result;
}

function requiredTimeout(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 100 || result > 10_000) {
    throw storeError(
      "META_CREDENTIAL_STORE_CONFIG_INVALID",
      "Secret Manager request timeout must be between 100 and 10000 milliseconds"
    );
  }
  return result;
}

function exactScopes(value) {
  if (!Array.isArray(value) || value.length !== META_PAGE_OAUTH_SCOPES.length) {
    return false;
  }
  return META_PAGE_OAUTH_SCOPES.every(
    (scope, index) => String(value[index] ?? "") === scope
  );
}

function validateCredential(credential, config) {
  if (
    credential?.provider !== "META" ||
    credential?.route !== "FACEBOOK_PAGE" ||
    credential?.graphHost !== "graph.facebook.com" ||
    String(credential?.accountId ?? "") !== config.pageId ||
    String(credential?.instagramAccountId ?? "") !== config.instagramAccountId ||
    !exactScopes(credential?.scopes) ||
    !Number.isFinite(Date.parse(String(credential?.observedAt ?? "")))
  ) {
    throw storeError(
      "META_CREDENTIAL_STORE_INPUT_INVALID",
      "Credential did not match the governed Meta Page route",
      400
    );
  }

  const token = String(credential?.accessToken ?? "");
  if (
    !token ||
    token.trim() !== token ||
    /\s|[\u0000-\u001F\u007F]/.test(token) ||
    Buffer.byteLength(token, "utf8") > MAX_SECRET_BYTES
  ) {
    throw storeError(
      "META_CREDENTIAL_STORE_INPUT_INVALID",
      "Credential token is invalid",
      400
    );
  }
  return token;
}

async function readResponseText(response, code, message, status = 502) {
  try {
    return await response.text();
  } catch {
    throw storeError(code, message, status);
  }
}

function parseJson(raw, code, message, status = 502) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw storeError(code, message, status);
  }
}

function abortSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

export function createGcpSecretManagerCredentialStore({
  mode = process.env.META_CREDENTIAL_STORE,
  projectId = process.env.META_MESSAGING_SECRET_PROJECT,
  secretId = process.env.META_MESSAGING_ACCESS_TOKEN_SECRET_ID,
  pageId = process.env.META_OAUTH_PAGE_ID || process.env.META_MESSAGING_ACCOUNT_ID,
  instagramAccountId =
    process.env.META_OAUTH_INSTAGRAM_ACCOUNT_ID ||
    process.env.META_INSTAGRAM_ACCOUNT_ID,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  const selectedMode = String(mode ?? "").trim();
  if (!selectedMode) return undefined;
  if (selectedMode !== GCP_SECRET_MANAGER_CREDENTIAL_STORE) {
    throw storeError(
      "META_CREDENTIAL_STORE_MODE_INVALID",
      `META_CREDENTIAL_STORE must be ${GCP_SECRET_MANAGER_CREDENTIAL_STORE}`
    );
  }
  if (typeof fetchImpl !== "function") {
    throw storeError(
      "META_CREDENTIAL_STORE_CONFIG_INVALID",
      "A fetch implementation is required"
    );
  }

  const config = Object.freeze({
    projectId: requiredProjectId(projectId),
    secretId: requiredSecretId(secretId),
    pageId: requiredMetaId(pageId, "META_OAUTH_PAGE_ID"),
    instagramAccountId: requiredMetaId(
      instagramAccountId,
      "META_OAUTH_INSTAGRAM_ACCOUNT_ID"
    ),
    timeoutMs: requiredTimeout(timeoutMs)
  });

  return async function storeMetaCredential(credential) {
    const pageAccessToken = validateCredential(credential, config);

    let metadataResponse;
    try {
      metadataResponse = await fetchImpl(METADATA_TOKEN_URL, {
        method: "GET",
        redirect: "error",
        signal: abortSignal(config.timeoutMs),
        headers: {
          "Metadata-Flavor": "Google",
          Accept: "application/json"
        }
      });
    } catch {
      throw storeError(
        "META_CREDENTIAL_STORE_IDENTITY_FAILED",
        "Cloud Run service identity could not be resolved",
        503
      );
    }
    const metadataRaw = await readResponseText(
      metadataResponse,
      "META_CREDENTIAL_STORE_IDENTITY_FAILED",
      "Cloud Run service identity response was unreadable",
      503
    );
    if (!metadataResponse.ok) {
      throw storeError(
        "META_CREDENTIAL_STORE_IDENTITY_FAILED",
        `Cloud Run service identity HTTP ${metadataResponse.status}`,
        503
      );
    }
    const metadata = parseJson(
      metadataRaw,
      "META_CREDENTIAL_STORE_IDENTITY_FAILED",
      "Cloud Run service identity returned invalid JSON",
      503
    );
    const serviceAccessToken = String(metadata?.access_token ?? "").trim();
    if (
      !serviceAccessToken ||
      /\s|[\u0000-\u001F\u007F]/.test(serviceAccessToken) ||
      String(metadata?.token_type ?? "").toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(Number(metadata?.expires_in)) ||
      Number(metadata.expires_in) <= 0 ||
      Number(metadata.expires_in) > 86_400
    ) {
      throw storeError(
        "META_CREDENTIAL_STORE_IDENTITY_FAILED",
        "Cloud Run service identity returned an invalid access token",
        503
      );
    }

    const versionUrl =
      `${SECRET_MANAGER_ORIGIN}/v1/projects/${encodeURIComponent(config.projectId)}` +
      `/secrets/${encodeURIComponent(config.secretId)}:addVersion`;
    let versionResponse;
    try {
      versionResponse = await fetchImpl(versionUrl, {
        method: "POST",
        redirect: "error",
        signal: abortSignal(config.timeoutMs),
        headers: {
          Authorization: `Bearer ${serviceAccessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          payload: {
            data: Buffer.from(pageAccessToken, "utf8").toString("base64")
          }
        })
      });
    } catch {
      throw storeError(
        "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
        "Secret Manager write outcome is unknown; verify before any new OAuth attempt",
        502
      );
    }
    const versionRaw = await readResponseText(
      versionResponse,
      "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
      "Secret Manager write response was unreadable; verify before any new OAuth attempt"
    );
    if (!versionResponse.ok) {
      const status = Number(versionResponse.status);
      if (status >= 400 && status < 500 && ![408, 429].includes(status)) {
        throw storeError(
          "META_CREDENTIAL_STORE_REJECTED",
          `Secret Manager rejected addVersion with HTTP ${status}`,
          status === 403 ? 503 : 502
        );
      }
      throw storeError(
        "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
        "Secret Manager write outcome is unknown; verify before any new OAuth attempt",
        502
      );
    }
    const version = parseJson(
      versionRaw,
      "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
      "Secret Manager write response was invalid; verify before any new OAuth attempt"
    );
    const expectedPrefix =
      `projects/${config.projectId}/secrets/${config.secretId}/versions/`;
    const versionName = String(version?.name ?? "");
    if (
      !versionName.startsWith(expectedPrefix) ||
      !/^\d+$/.test(versionName.slice(expectedPrefix.length))
    ) {
      throw storeError(
        "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN",
        "Secret Manager did not confirm the exact target version; verify before any new OAuth attempt",
        502
      );
    }

    return Object.freeze({
      provider: "GCP_SECRET_MANAGER",
      projectId: config.projectId,
      secretId: config.secretId,
      versionId: versionName.slice(expectedPrefix.length),
      stored: true,
      retrySafe: false
    });
  };
}
