import assert from "node:assert/strict";
import test from "node:test";

import {
  META_PAGE_OAUTH_SCOPES,
  createMetaPageOAuthFlow
} from "../src/meta/oauth.mjs";
import {
  routeMetaGovernedRequest,
  routeMetaPublicRequest
} from "../src/meta/router.mjs";

const APP_ID = "1028523216674895";
const PAGE_ID = "1265475843314216";
const INSTAGRAM_ID = "17841440257520993";
const REDIRECT_URI = "https://agent.example/meta/oauth/callback";
const STATE_SECRET = "state-secret-that-is-at-least-thirty-two-bytes";
const APP_SECRET_CANARY = "APP_SECRET_CANARY";
const USER_TOKEN_CANARY = "USER_TOKEN_CANARY";
const PAGE_TOKEN_CANARY = "PAGE_TOKEN_CANARY";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function providerHarness({
  pageId = PAGE_ID,
  instagramId = INSTAGRAM_ID,
  permissions = META_PAGE_OAUTH_SCOPES
} = {}) {
  const calls = [];
  const stored = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return jsonResponse({ access_token: USER_TOKEN_CANARY });
    }
    if (url.pathname.endsWith("/me/permissions")) {
      return jsonResponse({
        data: [
          ...permissions.map((permission) => ({ permission, status: "granted" })),
          { permission: "public_profile", status: "granted" }
        ]
      });
    }
    if (url.pathname.endsWith("/me/accounts")) {
      return jsonResponse({
        data: [{
          id: pageId,
          access_token: PAGE_TOKEN_CANARY,
          instagram_business_account: { id: instagramId }
        }]
      });
    }
    if (url.pathname.endsWith(`/${PAGE_ID}`)) {
      return jsonResponse({
        id: pageId,
        instagram_business_account: { id: instagramId }
      });
    }
    throw new Error(`Unexpected test URL: ${url.origin}${url.pathname}`);
  };
  return {
    calls,
    stored,
    fetchImpl,
    async storeMetaCredential(value) {
      stored.push(value);
    }
  };
}

function createFlow(overrides = {}) {
  return createMetaPageOAuthFlow({
    appId: APP_ID,
    appSecret: APP_SECRET_CANARY,
    redirectUri: REDIRECT_URI,
    pageId: PAGE_ID,
    instagramAccountId: INSTAGRAM_ID,
    apiVersion: "v26.0",
    stateSecret: STATE_SECRET,
    randomBytesImpl: () => Buffer.alloc(32, 7),
    ...overrides
  });
}

test("OAuth start uses the exact Page scopes and fixed redirect without leaking secrets", () => {
  const h = providerHarness();
  const flow = createFlow(h);
  const result = flow.createAuthorizationUrl();
  const url = new URL(result.authorizationUrl);

  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v26.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.deepEqual(
    new Set(url.searchParams.get("scope").split(",")),
    new Set(META_PAGE_OAUTH_SCOPES)
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.ok(url.searchParams.get("state"));
  assert.equal(result.expiresInSeconds, 600);
  assert.equal(result.authorizationUrl.includes(APP_SECRET_CANARY), false);
  assert.equal(result.authorizationUrl.includes(USER_TOKEN_CANARY), false);
});

test("OAuth callback consumes state before fetch and stores only the exact Page credential", async () => {
  const h = providerHarness();
  const flow = createFlow(h);
  const start = flow.createAuthorizationUrl();
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const result = await flow.completeAuthorization(new URLSearchParams({
    state,
    code: "CODE_CANARY"
  }));

  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[0].url.pathname, "/v26.0/oauth/access_token");
  assert.equal(h.calls[0].options.method, "POST");
  assert.equal(h.calls[0].url.search, "");
  assert.equal(h.calls[0].options.redirect, "error");
  assert.equal(h.calls.slice(1).every(({ options }) => options.redirect === "error"), true);
  assert.equal(h.stored.length, 1);
  assert.equal(h.stored[0].accessToken, PAGE_TOKEN_CANARY);
  assert.equal(h.stored[0].accountId, PAGE_ID);
  assert.equal(h.stored[0].instagramAccountId, INSTAGRAM_ID);
  assert.equal(h.stored[0].graphHost, "graph.facebook.com");
  assert.deepEqual(new Set(h.stored[0].scopes), new Set(META_PAGE_OAUTH_SCOPES));

  const serialized = JSON.stringify(result);
  for (const secret of [APP_SECRET_CANARY, USER_TOKEN_CANARY, PAGE_TOKEN_CANARY, "CODE_CANARY"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(result, {
    provider: "META",
    route: "FACEBOOK_PAGE",
    accountId: PAGE_ID,
    instagramAccountId: INSTAGRAM_ID,
    graphHost: "graph.facebook.com",
    scopes: [...META_PAGE_OAUTH_SCOPES],
    credentialStored: true
  });

  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "CODE_CANARY" })),
    (error) => error.code === "META_OAUTH_STATE_REPLAYED"
  );
  assert.equal(h.calls.length, 4);
  assert.equal(h.stored.length, 1);
});

test("tampered, expired and provider-rejected states fail before provider fetch", async () => {
  const h = providerHarness();
  let current = 1_000;
  const flow = createFlow({
    ...h,
    now: () => current,
    stateTtlMs: 10
  });
  const state = new URL(flow.createAuthorizationUrl().authorizationUrl).searchParams.get("state");

  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state: `${state}x`, code: "code" })),
    (error) => error.code === "META_OAUTH_STATE_INVALID"
  );
  assert.equal(h.calls.length, 0);

  current = 1_011;
  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "code" })),
    (error) => error.code === "META_OAUTH_STATE_EXPIRED"
  );
  assert.equal(h.calls.length, 0);

  const h2 = providerHarness();
  const flow2 = createFlow({
    ...h2,
    randomBytesImpl: () => Buffer.alloc(32, 8)
  });
  const state2 = new URL(flow2.createAuthorizationUrl().authorizationUrl).searchParams.get("state");
  await assert.rejects(
    flow2.completeAuthorization(new URLSearchParams({
      state: state2,
      error: "access_denied",
      error_description: PAGE_TOKEN_CANARY
    })),
    (error) => {
      assert.equal(error.code, "META_OAUTH_PROVIDER_REJECTED");
      assert.equal(error.message.includes(PAGE_TOKEN_CANARY), false);
      return true;
    }
  );
  assert.equal(h2.calls.length, 0);
});

test("missing scope, wrong Page and wrong Instagram account make zero credential writes", async () => {
  const cases = [
    {
      harness: providerHarness({ permissions: META_PAGE_OAUTH_SCOPES.slice(1) }),
      code: "META_OAUTH_SCOPE_MISMATCH"
    },
    {
      harness: providerHarness({ pageId: "1265475843314999" }),
      code: "META_OAUTH_PAGE_MISMATCH"
    },
    {
      harness: providerHarness({ instagramId: "17841440257529999" }),
      code: "META_OAUTH_INSTAGRAM_ACCOUNT_MISMATCH"
    }
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const flow = createFlow({
      ...item.harness,
      randomBytesImpl: () => Buffer.alloc(32, 20 + index)
    });
    const state = new URL(flow.createAuthorizationUrl().authorizationUrl).searchParams.get("state");
    await assert.rejects(
      flow.completeAuthorization(new URLSearchParams({ state, code: "code" })),
      (error) => error.code === item.code
    );
    assert.equal(item.harness.stored.length, 0);
  }
});

test("OAuth start fails closed when no governed credential sink is injected", () => {
  let fetched = false;
  const flow = createFlow({
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse({});
    }
  });
  assert.throws(
    () => flow.createAuthorizationUrl(),
    (error) => error.code === "META_OAUTH_CREDENTIAL_SINK_MISSING" && error.status === 503
  );
  assert.equal(fetched, false);
});

test("credential sink failures are sanitized and never expose provider secrets", async () => {
  const h = providerHarness();
  const flow = createFlow({
    ...h,
    async storeMetaCredential() {
      throw new Error(`sink rejected ${PAGE_TOKEN_CANARY} ${APP_SECRET_CANARY}`);
    },
    randomBytesImpl: () => Buffer.alloc(32, 31)
  });
  const state = new URL(flow.createAuthorizationUrl().authorizationUrl)
    .searchParams.get("state");

  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "CODE_CANARY" })),
    (error) => {
      assert.equal(error.code, "META_OAUTH_CREDENTIAL_STORE_FAILED");
      const serialized = JSON.stringify({
        message: error.message,
        code: error.code,
        details: error.details
      });
      for (const secret of [
        PAGE_TOKEN_CANARY,
        USER_TOKEN_CANARY,
        APP_SECRET_CANARY,
        "CODE_CANARY"
      ]) {
        assert.equal(serialized.includes(secret), false);
      }
      return true;
    }
  );
  assert.equal(h.calls.length, 4);
});

test("ambiguous credential storage remains distinct and sanitized", async () => {
  const h = providerHarness();
  const flow = createFlow({
    ...h,
    async storeMetaCredential() {
      const error = new Error(`unknown ${PAGE_TOKEN_CANARY}`);
      error.code = "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN";
      throw error;
    },
    randomBytesImpl: () => Buffer.alloc(32, 32)
  });
  const state = new URL(flow.createAuthorizationUrl().authorizationUrl)
    .searchParams.get("state");

  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "CODE_CANARY" })),
    (error) => {
      assert.equal(error.code, "META_OAUTH_CREDENTIAL_STORE_OUTCOME_UNKNOWN");
      assert.equal(error.message.includes(PAGE_TOKEN_CANARY), false);
      return true;
    }
  );
  assert.equal(h.calls.length, 4);

  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "CODE_CANARY" })),
    (error) => error.code === "META_OAUTH_CREDENTIAL_STORE_VERIFICATION_REQUIRED"
  );
  assert.equal(h.calls.length, 4);
});

test("unknown storage outcome blocks every new OAuth attempt until operator verification", async () => {
  const h = providerHarness();
  const flow = createFlow({
    ...h,
    async storeMetaCredential() {
      const error = new Error("unknown");
      error.code = "META_CREDENTIAL_STORE_OUTCOME_UNKNOWN";
      throw error;
    },
    randomBytesImpl: () => Buffer.alloc(32, 33)
  });
  const state = new URL(flow.createAuthorizationUrl().authorizationUrl)
    .searchParams.get("state");
  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "code" })),
    (error) => error.code === "META_OAUTH_CREDENTIAL_STORE_OUTCOME_UNKNOWN"
  );
  assert.throws(
    () => flow.createAuthorizationUrl(),
    (error) =>
      error.code === "META_OAUTH_CREDENTIAL_STORE_VERIFICATION_REQUIRED" &&
      error.status === 503
  );
  await assert.rejects(
    flow.completeAuthorization(new URLSearchParams({ state, code: "code" })),
    (error) => error.code === "META_OAUTH_CREDENTIAL_STORE_VERIFICATION_REQUIRED"
  );
  assert.equal(h.calls.length, 4);
});

function responseHarness() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("OAuth and conversations routers enforce method, confirmation and no-store output", async () => {
  const callbackResponse = responseHarness();
  const callbackHandled = await routeMetaPublicRequest({
    req: { method: "GET", headers: {} },
    res: callbackResponse,
    url: new URL("https://agent.example/meta/oauth/callback?state=s&code=c"),
    service: {
      async completeOAuth() {
        return { connected: true };
      }
    }
  });
  assert.equal(callbackHandled, true);
  assert.equal(callbackResponse.status, 200);
  assert.equal(callbackResponse.headers["Cache-Control"], "no-store");
  assert.equal(callbackResponse.headers["Referrer-Policy"], "no-referrer");
  assert.match(callbackResponse.headers["Content-Security-Policy"], /default-src 'none'/);

  const wrongMethod = responseHarness();
  await routeMetaPublicRequest({
    req: { method: "POST", headers: {} },
    res: wrongMethod,
    url: new URL("https://agent.example/meta/oauth/callback"),
    service: {}
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.Allow, "GET");

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };
  const startResponse = responseHarness();
  await routeMetaGovernedRequest({
    req: { method: "POST", headers: {} },
    res: startResponse,
    url: new URL("https://agent.example/meta/oauth/start"),
    json,
    readBody: async () => ({ confirmation: "START_META_PAGE_OAUTH" }),
    service: {
      startOAuth() {
        return { authorizationUrl: "https://www.facebook.com/oauth", expiresInSeconds: 600 };
      }
    }
  });
  assert.equal(startResponse.status, 200);
  assert.equal(startResponse.headers["Cache-Control"], "no-store");

  let reads = 0;
  const conversationsResponse = responseHarness();
  await routeMetaGovernedRequest({
    req: { method: "GET", headers: {} },
    res: conversationsResponse,
    url: new URL("https://agent.example/meta/conversations?limit=1"),
    json,
    readBody: async () => {
      throw new Error("GET must not read a body");
    },
    service: {
      async listInstagramConversations() {
        reads += 1;
        return { count: 0, conversations: [], hasNext: false, nextCursor: null };
      }
    }
  });
  assert.equal(reads, 1);
  assert.equal(conversationsResponse.status, 200);

  const conversationsWrongMethod = responseHarness();
  await routeMetaGovernedRequest({
    req: { method: "POST", headers: {} },
    res: conversationsWrongMethod,
    url: new URL("https://agent.example/meta/conversations"),
    json,
    readBody: async () => ({}),
    service: {}
  });
  assert.equal(conversationsWrongMethod.status, 405);
  assert.equal(conversationsWrongMethod.headers.Allow, "GET");
});
