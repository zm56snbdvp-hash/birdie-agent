import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

const COMMENT_ID = "17930197359365940";
const META_SECRET = "cycle-meta-secret";
const INSTAGRAM_ACCOUNT_ID = "17841400000000000";
const BIRDIE_ID_CLAIM = "https://birdieandbreakfast.de/birdie_id";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Birdie Agent did not start in time: ${stderr}`));
    }, 15_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Birdie Agent listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Birdie Agent exited with ${code}: ${stderr}`));
    });
  });
}

function commentPayload() {
  return {
    object: "instagram",
    entry: [{
      id: INSTAGRAM_ACCOUNT_ID,
      time: 1786500000,
      changes: [{
        field: "comments",
        value: {
          id: COMMENT_ID,
          from: { id: "17841400123456789", username: "Birdie.Fan" },
          media: { id: "17900000000000000" },
          text: "BIRDIE"
        }
      }]
    }]
  };
}

function metaSignature(raw) {
  return `sha256=${crypto
    .createHmac("sha256", META_SECRET)
    .update(raw)
    .digest("hex")}`;
}

function exactMetaReadback(event) {
  return {
    syncEventId: event.syncEventId,
    workItemId: event.workItemId,
    socialEventId: event.syncEventId,
    idempotencyKey: event.idempotencyKey,
    idempotent: false,
    repaired: false,
    readback: {
      communitySync: {
        syncEventId: event.syncEventId,
        idempotencyKey: event.idempotencyKey
      },
      communityWork: {
        workItemId: event.workItemId,
        syncEventId: event.syncEventId,
        sourceSnapshotKey: event.sourceSnapshotKey
      },
      socialCoinEvent: {
        eventId: event.syncEventId,
        points: 1,
        verificationStatus: "IDENTITY_PENDING",
        coinWriteStatus: "NOT_WRITTEN",
        idempotencyKey: event.idempotencyKey
      }
    }
  };
}

function systemResponse() {
  return {
    schemaVersion: "birdie-system-response/v1",
    responseId: "birdie-response:TX-IG-1",
    eventId: "coin:TX-IG-1",
    birdieId: "BIRDIE-1",
    kind: "COIN_EARNED",
    language: "de-DE",
    amount: 1,
    actionCode: "IG_COMMENT",
    text: "+1 Birdie ist angekommen."
  };
}

test("signed Instagram intake, scoped world read, response ACK and reconcile cross the real server", async (context) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "birdie-app-test", alg: "RS256", use: "sig" });
  const upstreamCalls = [];

  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/.well-known/jwks.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ keys: [publicJwk] }));
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    const action = req.method === "GET"
      ? url.searchParams.get("action")
      : payload.action;
    upstreamCalls.push({ method: req.method, action, payload, url });

    let data = {};
    if (action === "coinGetLedger") {
      data = {
        birdieId: url.searchParams.get("birdieId"),
        balances: { confirmed: 1, reserved: 0, available: 1, lifetime: 1 },
        transactions: [{
          transactionId: "TX-IG-1",
          birdieId: "BIRDIE-1",
          amount: 1,
          transactionType: "EARN",
          actionCode: "IG_COMMENT",
          sourceType: "INSTAGRAM",
          sourceReference: COMMENT_ID,
          status: "APPROVED",
          createdAt: "2026-08-14T10:00:00.000Z",
          approvedAt: "2026-08-14T10:01:00.000Z"
        }]
      };
    } else if (action === "appendCommunitySyncEvent") {
      data = exactMetaReadback(payload.event);
    } else if (action === "worldLeaseResponses") {
      data = {
        response: systemResponse(),
        leaseId: payload.leaseId,
        leaseExpiresAt: payload.leaseExpiresAt
      };
    } else if (action === "worldAckResponse") {
      data = {
        acknowledged: true,
        idempotent: false,
        birdieId: "BIRDIE-1",
        responseId: "birdie-response:TX-IG-1",
        acknowledgedAt: payload.acknowledgedAt
      };
    } else if (action === "worldReconcileLedger") {
      data = {
        scanned: 1,
        eligible: 1,
        projectionsCreated: 1,
        responsesCreated: 1
      };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data }));
  });
  const upstreamPort = await listen(upstream);
  context.after(() => close(upstream));

  const agentPort = await freePort();
  const issuer = `http://127.0.0.1:${upstreamPort}/`;
  const audience = `http://127.0.0.1:${agentPort}/birdie-app`;
  const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(agentPort),
      OPENAI_API_KEY: "test-openai-key",
      BIRDIE_OS_API_KEY: "test-birdie-os-key",
      BIRDIE_AGENT_API_KEY: "test-agent-key",
      BIRDIE_OS_BASE: `http://127.0.0.1:${upstreamPort}`,
      META_APP_SECRET: META_SECRET,
      META_WEBHOOK_VERIFY_TOKEN: "cycle-verify-token",
      META_INSTAGRAM_USERNAME: "birdieandbreakfast",
      META_INSTAGRAM_ACCOUNT_ID: INSTAGRAM_ACCOUNT_ID,
      BIRDIE_APP_OAUTH_ISSUER: issuer,
      BIRDIE_APP_OAUTH_AUDIENCE: audience,
      BIRDIE_APP_BIRDIE_ID_CLAIM: BIRDIE_ID_CLAIM,
      BIRDIE_APP_OAUTH_JWKS_URL: `${issuer}.well-known/jwks.json`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  await waitForServer(child);

  const base = `http://127.0.0.1:${agentPort}`;
  const root = await (await fetch(`${base}/`)).json();
  assert.equal(root.birdieWorld, "AUTHENTICATED_LEDGER_PROJECTION");

  const challenge = await fetch(
    `${base}/meta/webhook?hub.mode=subscribe&hub.verify_token=cycle-verify-token&hub.challenge=cycle-ok`
  );
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), "cycle-ok");

  const foreignPayload = commentPayload();
  foreignPayload.entry[0].id = "17841400999999999";
  const foreignRaw = JSON.stringify(foreignPayload);
  const foreignResponse = await fetch(`${base}/meta/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": metaSignature(foreignRaw)
    },
    body: foreignRaw
  });
  assert.equal(foreignResponse.status, 403);
  assert.equal(
    upstreamCalls.filter((call) => call.action === "appendCommunitySyncEvent").length,
    0
  );

  const rawMeta = JSON.stringify(commentPayload());
  const ingestionResponse = await fetch(`${base}/meta/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": metaSignature(rawMeta)
    },
    body: rawMeta
  });
  const ingestion = await ingestionResponse.json();
  assert.equal(ingestionResponse.status, 200);
  assert.equal(ingestion.eventCount, 1);
  assert.equal(
    ingestion.events[0].syncEventId,
    `SCE-IG-COMMENT-${COMMENT_ID}`
  );

  const appToken = await new SignJWT({
    scope: "birdie-world:access",
    [BIRDIE_ID_CLAIM]: "BIRDIE-1"
  })
    .setProtectedHeader({ alg: "RS256", kid: "birdie-app-test" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("auth0|birdie-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const appHeaders = { Authorization: `Bearer ${appToken}` };

  const agentKeyRejected = await fetch(`${base}/birdie-app/v1/world`, {
    headers: { Authorization: "Bearer test-agent-key" }
  });
  assert.equal(agentKeyRejected.status, 401);

  const worldResponse = await fetch(`${base}/birdie-app/v1/world`, {
    headers: appHeaders
  });
  const world = await worldResponse.json();
  assert.equal(worldResponse.status, 200);
  assert.deepEqual(world.data.appliedEventIds, ["coin:TX-IG-1"]);
  assert.equal(world.data.approvedEarnedBirdies, 1);

  const leaseResponse = await fetch(`${base}/birdie-app/v1/responses/lease`, {
    method: "POST",
    headers: { ...appHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const lease = await leaseResponse.json();
  assert.equal(leaseResponse.status, 200);
  assert.equal(lease.data.response.text, "+1 Birdie ist angekommen.");
  assert.match(lease.data.leaseId, /^lease-request:/);

  const ackResponse = await fetch(
    `${base}/birdie-app/v1/responses/birdie-response%3ATX-IG-1/ack`,
    {
      method: "POST",
      headers: { ...appHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: lease.data.leaseId })
    }
  );
  const ack = await ackResponse.json();
  assert.equal(ackResponse.status, 200);
  assert.equal(ack.data.acknowledged, true);

  const noConfirmation = await fetch(`${base}/admin/birdie-app/v1/reconcile`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-agent-key",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(noConfirmation.status, 403);

  const reconcileResponse = await fetch(`${base}/admin/birdie-app/v1/reconcile`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-agent-key",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ confirmation: "RECONCILE_BIRDIE_WORLD_V1" })
  });
  const reconcile = await reconcileResponse.json();
  assert.equal(reconcileResponse.status, 200);
  assert.equal(reconcile.data.responsesCreated, 1);

  const leaseCall = upstreamCalls.find((call) => call.action === "worldLeaseResponses");
  const ackCall = upstreamCalls.find((call) => call.action === "worldAckResponse");
  assert.equal(leaseCall.payload.authBirdieId, "BIRDIE-1");
  assert.equal(leaseCall.payload.authSubject, "auth0|birdie-1");
  assert.equal(ackCall.payload.leaseId, leaseCall.payload.leaseId);
});
