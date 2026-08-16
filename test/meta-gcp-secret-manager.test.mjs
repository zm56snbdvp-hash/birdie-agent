import assert from "node:assert/strict";
import test from "node:test";

import { META_PAGE_OAUTH_SCOPES } from "../src/meta/oauth.mjs";
import {
  GCP_SECRET_MANAGER_CREDENTIAL_STORE,
  META_PAGE_TOKEN_SECRET_ID,
  createGcpSecretManagerCredentialStore
} from "../src/meta/gcp-secret-manager.mjs";

const PROJECT_ID = "gen-lang-client-0251788487";
const PAGE_ID = "1265475843314216";
const INSTAGRAM_ID = "17841440257520993";
const PAGE_TOKEN_CANARY = "PAGE_TOKEN_CANARY_NO_LOGS";
const GOOGLE_TOKEN_CANARY = "GOOGLE_TOKEN_CANARY_NO_LOGS";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

function credential(overrides = {}) {
  return {
    provider: "META",
    route: "FACEBOOK_PAGE",
    accessToken: PAGE_TOKEN_CANARY,
    accountId: PAGE_ID,
    instagramAccountId: INSTAGRAM_ID,
    graphHost: "graph.facebook.com",
    scopes: [...META_PAGE_OAUTH_SCOPES],
    observedAt: "2026-08-16T02:30:00.000Z",
    ...overrides
  };
}

function createStore(fetchImpl, overrides = {}) {
  return createGcpSecretManagerCredentialStore({
    mode: GCP_SECRET_MANAGER_CREDENTIAL_STORE,
    projectId: PROJECT_ID,
    secretId: META_PAGE_TOKEN_SECRET_ID,
    pageId: PAGE_ID,
    instagramAccountId: INSTAGRAM_ID,
    fetchImpl,
    ...overrides
  });
}

test("empty mode leaves OAuth fail-closed and invalid target config makes zero requests", () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return response({});
  };
  assert.equal(
    createGcpSecretManagerCredentialStore({ mode: "", fetchImpl }),
    undefined
  );
  assert.throws(
    () => createStore(fetchImpl, { secretId: "UNAPPROVED_SECRET" }),
    (error) => error.code === "META_CREDENTIAL_STORE_TARGET_INVALID"
  );
  assert.throws(
    () => createStore(fetchImpl, { mode: "LOCAL_FILE" }),
    (error) => error.code === "META_CREDENTIAL_STORE_MODE_INVALID"
  );
  assert.equal(fetches, 0);
});

test("stores the exact Page token as one Secret Manager version and returns a sanitized receipt", async () => {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    calls.push({ input: String(input), options });
    if (calls.length === 1) {
      return response({
        access_token: GOOGLE_TOKEN_CANARY,
        token_type: "Bearer",
        expires_in: 3599
      });
    }
    return response({
      name: `projects/${PROJECT_ID}/secrets/${META_PAGE_TOKEN_SECRET_ID}/versions/7`,
      state: "ENABLED"
    });
  };
  const store = createStore(fetchImpl);
  const result = await store(credential());

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].input,
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["Metadata-Flavor"], "Google");

  assert.equal(
    calls[1].input,
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/${META_PAGE_TOKEN_SECRET_ID}:addVersion`
  );
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(
    calls[1].options.headers.Authorization,
    `Bearer ${GOOGLE_TOKEN_CANARY}`
  );
  const body = JSON.parse(calls[1].options.body);
  assert.equal(
    Buffer.from(body.payload.data, "base64").toString("utf8"),
    PAGE_TOKEN_CANARY
  );
  assert.deepEqual(result, {
    provider: "GCP_SECRET_MANAGER",
    projectId: PROJECT_ID,
    secretId: META_PAGE_TOKEN_SECRET_ID,
    versionId: "7",
    stored: true,
    retrySafe: false
  });

  const publicMaterial = JSON.stringify({
    urls: calls.map((call) => call.input),
    result
  });
  for (const secret of [PAGE_TOKEN_CANARY, GOOGLE_TOKEN_CANARY]) {
    assert.equal(publicMaterial.includes(secret), false);
  }
});

test("credential route, identity, scope and timestamp mismatches fail before metadata access", async () => {
  const invalidCredentials = [
    credential({ provider: "OTHER" }),
    credential({ route: "INSTAGRAM_LOGIN" }),
    credential({ graphHost: "graph.instagram.com" }),
    credential({ accountId: "1265475843314999" }),
    credential({ instagramAccountId: "17841440257529999" }),
    credential({ scopes: META_PAGE_OAUTH_SCOPES.slice(1) }),
    credential({ scopes: [...META_PAGE_OAUTH_SCOPES].reverse() }),
    credential({ observedAt: "not-a-date" }),
    credential({ accessToken: ` ${PAGE_TOKEN_CANARY}` }),
    credential({ accessToken: `${PAGE_TOKEN_CANARY}\u0000` })
  ];
  let fetches = 0;
  const store = createStore(async () => {
    fetches += 1;
    return response({});
  });
  for (const value of invalidCredentials) {
    await assert.rejects(
      store(value),
      (error) => error.code === "META_CREDENTIAL_STORE_INPUT_INVALID"
    );
  }
  assert.equal(fetches, 0);
});

test("metadata failures are sanitized and make zero Secret Manager writes", async () => {
  const cases = [
    async () => { throw new Error(`network ${GOOGLE_TOKEN_CANARY}`); },
    async () => response({ error: PAGE_TOKEN_CANARY }, 503),
    async () => response("not-json"),
    async () => response({ access_token: GOOGLE_TOKEN_CANARY, token_type: "MAC", expires_in: 10 })
  ];
  for (const fetchImpl of cases) {
    let calls = 0;
    const store = createStore(async (...args) => {
      calls += 1;
      return fetchImpl(...args);
    });
    await assert.rejects(store(credential()), (error) => {
      assert.equal(error.code, "META_CREDENTIAL_STORE_IDENTITY_FAILED");
      const serialized = JSON.stringify({ code: error.code, message: error.message });
      assert.equal(serialized.includes(PAGE_TOKEN_CANARY), false);
      assert.equal(serialized.includes(GOOGLE_TOKEN_CANARY), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("definite Secret Manager rejection is sanitized and never retried", async () => {
  let calls = 0;
  const store = createStore(async () => {
    calls += 1;
    if (calls === 1) {
      return response({
        access_token: GOOGLE_TOKEN_CANARY,
        token_type: "Bearer",
        expires_in: 3600
      });
    }
    return response({ error: { message: PAGE_TOKEN_CANARY } }, 403);
  });
  await assert.rejects(store(credential()), (error) => {
    assert.equal(error.code, "META_CREDENTIAL_STORE_REJECTED");
    assert.equal(error.message.includes(PAGE_TOKEN_CANARY), false);
    assert.equal(error.message.includes(GOOGLE_TOKEN_CANARY), false);
    return true;
  });
  assert.equal(calls, 2);
});

test("ambiguous addVersion outcomes are distinct, sanitized and never retried", async () => {
  const cases = [
    async () => { throw new Error(`timeout ${PAGE_TOKEN_CANARY}`); },
    async () => response({ error: GOOGLE_TOKEN_CANARY }, 429),
    async () => response({ error: GOOGLE_TOKEN_CANARY }, 503),
    async () => response("not-json", 200),
    async () => response({ name: "projects/other/secrets/other/versions/1" }, 200)
  ];
  for (const secondCall of cases) {
    let calls = 0;
    const store = createStore(async (...args) => {
      calls += 1;
      if (calls === 1) {
        return response({
          access_token: GOOGLE_TOKEN_CANARY,
          token_type: "Bearer",
          expires_in: 3600
        });
      }
      return secondCall(...args);
    });
    await assert.rejects(store(credential()), (error) => {
      assert.equal(error.code, "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN");
      const serialized = JSON.stringify({ code: error.code, message: error.message });
      assert.equal(serialized.includes(PAGE_TOKEN_CANARY), false);
      assert.equal(serialized.includes(GOOGLE_TOKEN_CANARY), false);
      return true;
    });
    assert.equal(calls, 2);
  }
});
