import assert from "node:assert/strict";
import test from "node:test";

import {
  routeSupporterRequest,
  supporterCookieName
} from "../src/supporter/router.mjs";

function responseRecorder() {
  return {
    headers: {},
    status: null,
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    end(body) {
      this.body = body;
    }
  };
}

function json(res, status, body) {
  res.status = status;
  res.body = body;
}

function request(method, pathname, extraHeaders = {}) {
  return {
    method,
    headers: {
      host: "birdie.example",
      origin: "https://birdie.example",
      ...(method !== "GET" && method !== "HEAD"
        ? { "content-type": "application/json" }
        : {}),
      ...extraHeaders
    }
  };
}

function dependencies(overrides = {}) {
  const profile = {
    birdieId: "BIRDIE-OWNER",
    accountType: "PRIVATE",
    displayName: "Pilot"
  };
  return {
    readBody: async () => ({}),
    authService: {
      requestCode: async () => ({ accepted: true }),
      verifyCode: async () => ({
        sessionToken: "s".repeat(43),
        expiresInSeconds: 604800,
        expiresAt: "2026-08-17T20:00:00.000Z",
        profile
      }),
      authorize: async () => ({ profile }),
      revoke: async () => ({ revoked: true }),
      csrfToken: () => "csrf-contract-token",
      verifyCsrf: () => true
    },
    coinService: {
      getLedger: async () => ({ birdieId: profile.birdieId, transactions: [] }),
      listRewards: async () => ({ rewards: [] }),
      getConfig: () => ({ levels: [], actions: {} }),
      createClaim: async (body) => body,
      createRedemption: async (body) => body
    },
    ...overrides
  };
}

async function route({ method, pathname, headers, body, overrides } = {}) {
  const req = request(method || "GET", pathname || "/supporter", headers);
  const res = responseRecorder();
  const deps = dependencies(overrides);
  if (body !== undefined) deps.readBody = async () => body;
  const handled = await routeSupporterRequest({
    req,
    res,
    url: new URL(`https://birdie.example${pathname || "/supporter"}`),
    json,
    ...deps
  });
  return { handled, req, res, deps };
}

test("supporter assets are public but hardened", async () => {
  const { handled, res } = await route({ method: "GET", pathname: "/supporter" });

  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/html/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("every supporter write requires an exact same-origin request", async () => {
  await assert.rejects(
    route({
      method: "POST",
      pathname: "/supporter/api/auth/request-code",
      headers: { origin: "https://attacker.example" },
      body: { email: "pilot@example.com" }
    }),
    { code: "INVALID_REQUEST_ORIGIN", status: 403 }
  );
});

test("code verification sets only the hardened HttpOnly session cookie", async () => {
  const { res } = await route({
    method: "POST",
    pathname: "/supporter/api/auth/verify-code",
    body: { challengeId: "LOGIN-TEST", code: "123456" }
  });

  assert.equal(res.status, 200);
  assert.match(res.headers["set-cookie"], new RegExp(`^${supporterCookieName}=`));
  assert.match(res.headers["set-cookie"], /HttpOnly/);
  assert.match(res.headers["set-cookie"], /Secure/);
  assert.match(res.headers["set-cookie"], /SameSite=Strict/);
  assert.equal(JSON.stringify(res.body).includes("s".repeat(43)), false);
});

test("dashboard and writes bind identity to the session profile", async () => {
  const authorizeTokens = [];
  const claimBodies = [];
  const redemptionBodies = [];
  const overrides = {
    authService: {
      ...dependencies().authService,
      async authorize(token) {
        authorizeTokens.push(token);
        return {
          profile: {
            birdieId: "BIRDIE-OWNER",
            accountType: "PRIVATE",
            displayName: "Pilot"
          }
        };
      }
    },
    coinService: {
      ...dependencies().coinService,
      async createClaim(body) {
        claimBodies.push(body);
        return body;
      },
      async createRedemption(body) {
        redemptionBodies.push(body);
        return body;
      }
    }
  };
  const cookie = {
    cookie: `${supporterCookieName}=session-cookie-value`,
    "x-birdie-csrf": "csrf-contract-token"
  };

  const dashboard = await route({
    method: "GET",
    pathname: "/supporter/api/bootstrap",
    headers: cookie,
    overrides
  });
  assert.equal(dashboard.res.body.data.profile.birdieId, "BIRDIE-OWNER");

  await route({
    method: "POST",
    pathname: "/supporter/api/claims",
    headers: cookie,
    body: {
      birdieId: "BIRDIE-ATTACKER",
      actionCode: "STORY_SHARE_TAGGED",
      sourceType: "INSTAGRAM",
      sourceReference: "story:contract",
      idempotencyKey: "claim:contract"
    },
    overrides
  });
  await route({
    method: "POST",
    pathname: "/supporter/api/redemptions",
    headers: cookie,
    body: {
      birdieId: "BIRDIE-ATTACKER",
      rewardId: "RW-PRIVATE-WALLPAPER",
      idempotencyKey: "redemption:contract"
    },
    overrides
  });

  assert.deepEqual(authorizeTokens, [
    "session-cookie-value",
    "session-cookie-value",
    "session-cookie-value"
  ]);
  assert.equal(claimBodies[0].birdieId, "BIRDIE-OWNER");
  assert.equal(redemptionBodies[0].birdieId, "BIRDIE-OWNER");
});

test("logout revokes the cookie session and clears it in the browser", async () => {
  const revoked = [];
  const overrides = dependencies();
  overrides.authService = {
    ...overrides.authService,
    async revoke(token) {
      revoked.push(token);
      return { revoked: true };
    }
  };

  const { res } = await route({
    method: "POST",
    pathname: "/supporter/api/auth/logout",
    headers: {
      cookie: `${supporterCookieName}=logout-token`,
      "x-birdie-csrf": "csrf-contract-token"
    },
    overrides
  });

  assert.deepEqual(revoked, ["logout-token"]);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
});
