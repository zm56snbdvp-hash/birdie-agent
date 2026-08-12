import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    }, 5000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
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

test("Birdie Coin HTTP contract runs through the real server", async (context) => {
  let upstreamPosts = 0;
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url, "http://127.0.0.1");
    const action = url.searchParams.get("action");
    if (req.method === "POST") upstreamPosts += 1;
    let data = payload;
    if (action === "health") data = { status: "ONLINE", version: "test" };
    if (action === "briefing") {
      data = {
        sections: Array.from({ length: 200 }, (_, index) => ({
          id: index + 1,
          content: "x".repeat(1000)
        }))
      };
    }
    if (action === "communityWorkItem") {
      data = {
        workItem: {
          workItemId: url.searchParams.get("workItemId"),
          sourceType: "INSTAGRAM",
          externalUserId: "provider.test",
          resolutionStatus: "IDENTITY_PENDING",
          matchedBirdieId: ""
        }
      };
    }
    if (action === "birdieProfiles") {
      data = {
        profiles: [
          {
            birdieId: "BIRDIE-HTTP-90",
            status: "ACTIVE",
            email: "provider@example.com",
            instagramHandle: "provider.test"
          }
        ]
      };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data }));
  });
  const upstreamPort = await listen(upstream);
  context.after(() => close(upstream));

  const agentPort = await freePort();
  const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(agentPort),
      OPENAI_API_KEY: "test-openai-key",
      BIRDIE_OS_API_KEY: "test-birdie-os-key",
      BIRDIE_AGENT_API_KEY: "test-agent-key",
      BIRDIE_OS_BASE: `http://127.0.0.1:${upstreamPort}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  await waitForServer(child);

  const baseUrl = `http://127.0.0.1:${agentPort}`;
  const rootResponse = await fetch(`${baseUrl}/`);
  const root = await rootResponse.json();
  assert.equal(root.version, "2.7.0");

  const unauthorized = await fetch(`${baseUrl}/coin/config`);
  assert.equal(unauthorized.status, 401);

  const unauthorizedEvidence = await fetch(`${baseUrl}/community/identity/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workItemId: "WORK-HTTP-90",
      providerIdentity: { provider: "INSTAGRAM" }
    })
  });
  assert.equal(unauthorizedEvidence.status, 401);

  const writesBeforeEvidence = upstreamPosts;
  const evidenceResponse = await fetch(`${baseUrl}/community/identity/evidence`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-agent-key",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workItemId: "WORK-HTTP-90",
      providerIdentity: {
        provider: "INSTAGRAM",
        verifiedEmail: "provider@example.com",
        emailVerified: true,
        sourceEventId: "IG-HTTP-90",
        observedAt: "2026-08-12T14:00:00Z"
      }
    })
  });
  const evidence = await evidenceResponse.json();
  assert.equal(evidenceResponse.status, 200);
  assert.equal(evidence.source, "PROVIDER_EVIDENCE_V1");
  assert.equal(evidence.data.confidence, 90);
  assert.equal(evidence.data.candidateCount, 1);
  assert.ok(evidence.data.integrityToken);
  assert.equal(upstreamPosts, writesBeforeEvidence);

  const invalidEvidenceResponse = await fetch(`${baseUrl}/community/identity/evidence`, {
    method: "POST",
    headers: {
      "X-Birdie-Agent-Key": "test-agent-key",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workItemId: "WORK-HTTP-90",
      providerIdentity: {
        provider: "INSTAGRAM",
        confidence: 100
      }
    })
  });
  const invalidEvidence = await invalidEvidenceResponse.json();
  assert.equal(invalidEvidenceResponse.status, 400);
  assert.equal(invalidEvidence.error, "DERIVED_PROVIDER_EVIDENCE_NOT_ALLOWED:confidence");
  assert.equal(upstreamPosts, writesBeforeEvidence);

  const startupResponse = await fetch(`${baseUrl}/startup`, {
    headers: { Authorization: "Bearer test-agent-key" }
  });
  const startup = await startupResponse.json();
  assert.equal(startupResponse.status, 200);
  assert.equal(startup.authoritative, true);
  assert.equal(startup.truncated, true);
  assert.ok(JSON.stringify(startup).length < 100_000);

  const briefingResponse = await fetch(`${baseUrl}/briefing`, {
    headers: { Authorization: "Bearer test-agent-key" }
  });
  const briefing = await briefingResponse.json();
  assert.equal(briefingResponse.status, 200);
  assert.equal(briefing.truncated, true);
  assert.ok(JSON.stringify(briefing).length < 100_000);

  const configResponse = await fetch(`${baseUrl}/coin/config`, {
    headers: { Authorization: "Bearer test-agent-key" }
  });
  const config = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(config.data.unit.singular, "Birdie");

  const profileResponse = await fetch(`${baseUrl}/coin/profiles`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-agent-key",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "Lee-Ann",
      email: "lee@example.com",
      accountType: "PRIVATE",
      idempotencyKey: "profile:lee"
    })
  });
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 201);
  assert.equal(profile.source, "BIRDIE_OS");
  assert.equal(profile.data.action, "coinCreateProfile");
  assert.equal(profile.data.email, "lee@example.com");
});
