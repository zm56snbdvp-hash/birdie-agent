import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
    const timeout = setTimeout(() => reject(new Error(`Server start timed out: ${stderr}`)), 5000);
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

test("real HTTP server protects and advertises the Birdie Mail MCP tools", async (context) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data: {} }));
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

  const endpoint = `http://127.0.0.1:${agentPort}/mcp`;
  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  });
  assert.equal(unauthorized.status, 401);

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: "Bearer test-agent-key" } }
  });
  const client = new Client({ name: "birdie-http-test", version: "1.0.0" });
  context.after(() => client.close());
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["birdie_mail_folders", "birdie_mail_get", "birdie_mail_health", "birdie_mail_list"]
  );
});
