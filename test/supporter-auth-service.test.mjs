import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupporterAuthService,
  supporterAuthDurations
} from "../src/supporter/auth-service.mjs";

const TEST_SECRET = "supporter-auth-contract-secret-32-bytes-minimum";

function deterministicBytes(length) {
  return Buffer.alloc(length, 7);
}

test("magic-code request persists only a hash and uses the stored profile address", async () => {
  const osCalls = [];
  const mailCalls = [];
  const sleeps = [];
  const now = Date.parse("2026-08-10T20:00:00.000Z");
  const service = createSupporterAuthService({
    secret: TEST_SECRET,
    now: () => now,
    randomBytes: deterministicBytes,
    randomInt: () => 12345,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    async birdieOSPost(payload) {
      osCalls.push(payload);
      return {
        success: true,
        data: {
          accepted: true,
          deliverable: true,
          deliveryEmail: "supporter@example.com",
          displayName: "Founding Birdie"
        }
      };
    },
    async sendLoginCode(payload) {
      mailCalls.push(payload);
    }
  });

  const response = await service.requestCode({ email: " SUPPORTER@EXAMPLE.COM " });

  assert.equal(response.accepted, true);
  assert.equal(response.expiresInSeconds, 600);
  assert.equal("code" in response, false);
  assert.equal(osCalls.length, 1);
  assert.equal(osCalls[0].email, "supporter@example.com");
  assert.match(osCalls[0].codeHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(osCalls[0]).includes("012345"), false);
  assert.deepEqual(mailCalls, [{
    to: "supporter@example.com",
    displayName: "Founding Birdie",
    code: "012345",
    expiresMinutes: 10
  }]);
  assert.deepEqual(sleeps, [600]);
});

test("magic-code delivery rejects an upstream recipient mismatch", async () => {
  let mailSent = false;
  const service = createSupporterAuthService({
    secret: TEST_SECRET,
    randomBytes: deterministicBytes,
    randomInt: () => 123456,
    sleep: async () => {},
    async birdieOSPost() {
      return {
        success: true,
        data: {
          deliverable: true,
          deliveryEmail: "different@example.com",
          displayName: "Wrong Birdie"
        }
      };
    },
    async sendLoginCode() {
      mailSent = true;
    }
  });

  await assert.rejects(
    service.requestCode({ email: "supporter@example.com" }),
    { code: "AUTH_RECIPIENT_MISMATCH", status: 409 }
  );
  assert.equal(mailSent, false);
});

test("code exchange returns a raw session only to the router and stores its hash", async () => {
  const calls = [];
  const now = Date.parse("2026-08-10T20:00:00.000Z");
  const service = createSupporterAuthService({
    secret: TEST_SECRET,
    now: () => now,
    randomBytes: deterministicBytes,
    async sendLoginCode() {},
    async birdieOSPost(payload) {
      calls.push(payload);
      if (payload.action === "coinVerifyLoginChallenge") {
        return { success: true, data: { birdieId: "BIRDIE-TEST" } };
      }
      if (payload.action === "coinCreateSupporterSession") {
        return {
          success: true,
          data: { profile: { birdieId: "BIRDIE-TEST", displayName: "Birdie" } }
        };
      }
      throw new Error(`Unexpected action: ${payload.action}`);
    }
  });

  const verified = await service.verifyCode({
    challengeId: "LOGIN-TEST",
    code: "654321"
  });

  assert.match(verified.sessionToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(verified.expiresInSeconds, 7 * 24 * 60 * 60);
  assert.equal(supporterAuthDurations.sessionSeconds, 7 * 24 * 60 * 60);
  assert.equal(calls[0].action, "coinVerifyLoginChallenge");
  assert.match(calls[0].codeHash, /^[a-f0-9]{64}$/);
  assert.equal(calls[1].action, "coinCreateSupporterSession");
  assert.match(calls[1].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(calls).includes(verified.sessionToken), false);
  assert.equal(calls[1].birdieId, "BIRDIE-TEST");
  assert.deepEqual(verified.profile, {
    birdieId: "BIRDIE-TEST",
    displayName: "Birdie"
  });
});

test("challenge and session failures are mapped to stable public errors", async () => {
  const service = createSupporterAuthService({
    secret: TEST_SECRET,
    randomBytes: deterministicBytes,
    async sendLoginCode() {},
    async birdieOSPost(payload) {
      const error = new Error(
        payload.action === "coinAuthorizeSupporterSession"
          ? "SESSION_REVOKED"
          : "LOGIN_CHALLENGE_LOCKED"
      );
      throw error;
    }
  });

  await assert.rejects(
    service.verifyCode({ challengeId: "LOGIN-TEST", code: "123456" }),
    { code: "INVALID_LOGIN_CODE", status: 401 }
  );
  await assert.rejects(
    service.authorize("a".repeat(43)),
    { code: "INVALID_SESSION", status: 401 }
  );
});
