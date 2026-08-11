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
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data: payload }));
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
  assert.equal(root.version, "2.5.0");

  const unauthorized = await fetch(`${baseUrl}/coin/config`);
  assert.equal(unauthorized.status, 401);

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
