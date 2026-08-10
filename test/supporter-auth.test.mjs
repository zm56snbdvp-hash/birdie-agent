import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupporterAuthService,
  supporterAuthDurations
} from "../src/supporter/auth-service.mjs";

const secret = "supporter-auth-test-secret-that-is-at-least-32-characters";

test("known login requests store only a keyed hash and send the fixed code internally", async () => {
  const posts = [];
  const deliveries = [];
  const service = createSupporterAuthService({
    secret,
    now: () => Date.parse("2026-08-10T21:00:00.000Z"),
    randomBytes: (length) => Buffer.alloc(length, 1),
    randomInt: () => 123456,
    sleep: async () => {},
    birdieOSPost: async (payload) => {
      posts.push(payload);
      return {
        data: {
          accepted: true,
          deliverable: true,
          deliveryEmail: "lee@example.com",
          displayName: "Lee-Ann"
        }
      };
    },
    sendLoginCode: async (delivery) => deliveries.push(delivery)
  });

  const response = await service.requestCode({ email: " Lee@Example.com " });

  assert.equal(response.accepted, true);
  assert.equal(response.expiresInSeconds, 600);
  assert.equal(JSON.stringify(response).includes("123456"), false);
  assert.equal(posts[0].action, "coinCreateLoginChallenge");
  assert.equal(posts[0].email, "lee@example.com");
  assert.match(posts[0].codeHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(posts[0]).includes("123456"), false);
  assert.deepEqual(deliveries, [{
    to: "lee@example.com",
    displayName: "Lee-Ann",
    code: "123456",
    expiresMinutes: 10
  }]);
});

test("known and unknown emails receive the same public response shape", async () => {
  function build(deliverable) {
    return createSupporterAuthService({
      secret,
      now: () => Date.parse("2026-08-10T21:00:00.000Z"),
      randomBytes: (length) => Buffer.alloc(length, deliverable ? 2 : 3),
      randomInt: () => 111111,
      sleep: async () => {},
      birdieOSPost: async () => ({
        data: deliverable
          ? { deliverable: true, deliveryEmail: "pilot@example.com", displayName: "Pilot" }
          : { deliverable: false }
      }),
      sendLoginCode: async () => {}
    });
  }

  const known = await build(true).requestCode({ email: "pilot@example.com" });
  const unknown = await build(false).requestCode({ email: "unknown@example.com" });

  assert.deepEqual(Object.keys(known), Object.keys(unknown));
  assert.equal(known.message, unknown.message);
  assert.equal(known.expiresInSeconds, unknown.expiresInSeconds);
});

test("verification creates a seven-day opaque session and never forwards the raw token", async () => {
  const posts = [];
  let randomCall = 0;
  const now = Date.parse("2026-08-10T21:00:00.000Z");
  const service = createSupporterAuthService({
    secret,
    now: () => now,
    randomBytes: (length) => {
      randomCall += 1;
      return Buffer.alloc(length, randomCall + 3);
    },
    birdieOSPost: async (payload) => {
      posts.push(payload);
      if (payload.action === "coinVerifyLoginChallenge") {
        return { data: { birdieId: "BIRDIE-LEE" } };
      }
      if (payload.action === "coinCreateSupporterSession") {
        return {
          data: {
            profile: {
              birdieId: "BIRDIE-LEE",
              displayName: "Lee-Ann",
              accountType: "PRIVATE"
            }
          }
        };
      }
      throw new Error(`Unexpected action ${payload.action}`);
    },
    sendLoginCode: async () => {}
  });

  const result = await service.verifyCode({
    challengeId: "LOGIN-010203",
    code: "654321"
  });

  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(result.expiresInSeconds, 7 * 24 * 60 * 60);
  assert.equal(Date.parse(result.expiresAt) - now, supporterAuthDurations.sessionSeconds * 1000);
  assert.match(posts[1].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(posts).includes(result.sessionToken), false);
  assert.equal(posts[1].birdieId, "BIRDIE-LEE");
});

test("CSRF tokens are bound to a session token and compared safely", () => {
  const service = createSupporterAuthService({
    secret,
    birdieOSPost: async () => ({ data: {} }),
    sendLoginCode: async () => {}
  });
  const session = Buffer.alloc(32, 9).toString("base64url");
  const csrf = service.csrfToken(session);

  assert.match(csrf, /^[a-f0-9]{64}$/);
  assert.equal(service.verifyCsrf(session, csrf), true);
  assert.throws(
    () => service.verifyCsrf(session, "0".repeat(64)),
    (error) => error.code === "INVALID_CSRF_TOKEN" && error.status === 403
  );
});

test("malformed codes and short auth secrets fail closed", async () => {
  const unconfigured = createSupporterAuthService({
    secret: "short",
    birdieOSPost: async () => ({ data: {} }),
    sendLoginCode: async () => {}
  });
  await assert.rejects(
    () => unconfigured.requestCode({ email: "pilot@example.com" }),
    (error) => error.code === "SUPPORTER_AUTH_NOT_CONFIGURED" && error.status === 503
  );

  const configured = createSupporterAuthService({
    secret,
    birdieOSPost: async () => ({ data: {} }),
    sendLoginCode: async () => {}
  });
  await assert.rejects(
    () => configured.verifyCode({ challengeId: "LOGIN-1", code: "12ab" }),
    (error) => error.code === "INVALID_LOGIN_CODE" && error.status === 401
  );
});
