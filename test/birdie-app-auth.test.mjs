import assert from "node:assert/strict";
import test from "node:test";

import { generateKeyPair, SignJWT } from "jose";

import {
  authenticateBirdieAppRequest,
  BIRDIE_APP_SCOPE,
  createBirdieAppAuthConfig
} from "../src/app/birdie-app-auth.mjs";

const issuer = "https://auth.example.test/";
const audience = "https://birdie.example.test/api";
const birdieIdClaim = "https://birdieandbreakfast.de/birdie_id";

function request(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function configured(jwks) {
  return {
    ...createBirdieAppAuthConfig({
      BIRDIE_APP_OAUTH_ISSUER: issuer,
      BIRDIE_APP_OAUTH_AUDIENCE: audience,
      BIRDIE_APP_BIRDIE_ID_CLAIM: birdieIdClaim
    }),
    jwks
  };
}

async function token(privateKey, overrides = {}) {
  const payload = {
    scope: BIRDIE_APP_SCOPE,
    [birdieIdClaim]: "BIRDIE-1",
    ...overrides.payload
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(overrides.issuer || issuer)
    .setAudience(overrides.audience || audience)
    .setSubject(overrides.subject || "auth0|birdie-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

test("Birdie app auth remains disabled until issuer, audience and Birdie claim exist", async () => {
  const config = createBirdieAppAuthConfig({
    BIRDIE_APP_OAUTH_ISSUER: issuer
  });
  assert.equal(config.enabled, false);
  assert.deepEqual(config.missing, [
    "BIRDIE_APP_OAUTH_AUDIENCE",
    "BIRDIE_APP_BIRDIE_ID_CLAIM"
  ]);
  await assert.rejects(
    authenticateBirdieAppRequest(request("agent-api-key"), { config }),
    { code: "BIRDIE_APP_AUTH_NOT_CONFIGURED", status: 503 }
  );
  assert.throws(
    () => createBirdieAppAuthConfig({
      BIRDIE_APP_OAUTH_ISSUER: "http://identity.example.test/",
      BIRDIE_APP_OAUTH_AUDIENCE: audience,
      BIRDIE_APP_BIRDIE_ID_CLAIM: birdieIdClaim
    }),
    /must use HTTPS/
  );
});

test("a signed scoped token yields only its exact Birdie identity", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const config = configured(publicKey);
  const auth = await authenticateBirdieAppRequest(
    request(await token(privateKey)),
    { config }
  );

  assert.equal(auth.type, "oauth");
  assert.equal(auth.subject, "auth0|birdie-1");
  assert.equal(auth.birdieId, "BIRDIE-1");
  assert.equal(auth.scopes.has(BIRDIE_APP_SCOPE), true);
});

test("agent keys, wrong audience, missing scope and invalid Birdie claims fail closed", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const config = configured(publicKey);

  await assert.rejects(
    authenticateBirdieAppRequest(request("agent-api-key"), { config }),
    { code: "BIRDIE_APP_TOKEN_INVALID", status: 401 }
  );
  await assert.rejects(
    authenticateBirdieAppRequest(
      request(await token(privateKey, { audience: "https://wrong.example.test" })),
      { config }
    ),
    { code: "BIRDIE_APP_TOKEN_INVALID", status: 401 }
  );
  await assert.rejects(
    authenticateBirdieAppRequest(
      request(await token(privateKey, { payload: { scope: "os.read" } })),
      { config }
    ),
    { code: "BIRDIE_APP_SCOPE_REQUIRED", status: 403 }
  );
  await assert.rejects(
    authenticateBirdieAppRequest(
      request(await token(privateKey, {
        payload: { [birdieIdClaim]: "BIRDIE 2" }
      })),
      { config }
    ),
    { code: "BIRDIE_APP_BIRDIE_ID_REQUIRED", status: 403 }
  );
});
