import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

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
    const timeout = setTimeout(() => reject(new Error(`Server start timed out: ${stderr}`)), 15000);
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

test("real HTTP server protects and advertises the BirdieOS MCP tools", async (context) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "birdie-test-key", alg: "RS256", use: "sig" });

  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/.well-known/jwks.json") {
      return res.end(JSON.stringify({ keys: [publicJwk] }));
    }
    res.end(JSON.stringify({ success: true, data: {} }));
  });
  const upstreamPort = await listen(upstream);
  context.after(() => close(upstream));

  const agentPort = await freePort();
  const issuer = `http://127.0.0.1:${upstreamPort}/`;
  const resource = `http://127.0.0.1:${agentPort}`;
  const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(agentPort),
      OPENAI_API_KEY: "test-openai-key",
      BIRDIE_OS_API_KEY: "test-birdie-os-key",
      BIRDIE_AGENT_API_KEY: "test-agent-key",
      BIRDIE_OS_BASE: `http://127.0.0.1:${upstreamPort}`,
      BIRDIE_OAUTH_ISSUER: issuer,
      BIRDIE_OAUTH_JWKS_URL: `${issuer}.well-known/jwks.json`,
      BIRDIE_MCP_RESOURCE: resource
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGTERM"));
  await waitForServer(child);

  const endpoint = `http://127.0.0.1:${agentPort}/mcp`;
  const metadataResponse = await fetch(
    `http://127.0.0.1:${agentPort}/.well-known/oauth-protected-resource`
  );
  const metadata = await metadataResponse.json();
  assert.equal(metadataResponse.status, 200);
  assert.equal(metadata.resource, resource);
  assert.deepEqual(metadata.authorization_servers, [issuer]);
  assert.deepEqual(metadata.scopes_supported, [
    "os.read",
    "framer.read",
    "mail.read",
    "mail.write",
    "mail.send",
    "mail.delete"
  ]);

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate"),
    /oauth-protected-resource/
  );

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: "Bearer test-agent-key" } }
  });
  const client = new Client({ name: "birdie-http-test", version: "1.0.0" });
  context.after(() => client.close());
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "birdie_framer_config",
      "birdie_framer_status",
      "birdie_mail_delete",
      "birdie_mail_folders",
      "birdie_mail_get",
      "birdie_mail_health",
      "birdie_mail_list",
      "birdie_mail_move",
      "birdie_mail_send",
      "birdie_mail_update_flags",
      "birdie_os_briefing",
      "birdie_os_health",
      "birdie_os_next_task",
      "birdie_os_startup"
    ]
  );

  const oauthToken = await new SignJWT({
    scope: "mail.read",
    permissions: ["mail.read"]
  })
    .setProtectedHeader({ alg: "RS256", kid: "birdie-test-key" })
    .setIssuer(issuer)
    .setAudience(resource)
    .setSubject("auth0|kevin")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const oauthTransport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${oauthToken}` } }
  });
  const oauthClient = new Client({ name: "birdie-oauth-test", version: "1.0.0" });
  context.after(() => oauthClient.close());
  await oauthClient.connect(oauthTransport);

  const oauthTools = await oauthClient.listTools();
  assert.equal(oauthTools.tools.length, 14);

  const deniedSend = await oauthClient.callTool({
    name: "birdie_mail_send",
    arguments: {
      to: ["mama@example.com"],
      subject: "Test",
      text: "This must not be sent.",
      founderApproved: true,
      confirmation: "SEND_EMAIL"
    }
  });
  assert.equal(deniedSend.isError, true);
  assert.equal(deniedSend.content[0].text, "INSUFFICIENT_SCOPE");
  assert.match(deniedSend._meta["mcp/www_authenticate"][0], /mail\.send/);

  const deniedStartup = await oauthClient.callTool({
    name: "birdie_os_startup",
    arguments: {}
  });
  assert.equal(deniedStartup.isError, true);
  assert.equal(deniedStartup.content[0].text, "INSUFFICIENT_SCOPE");
  assert.match(deniedStartup._meta["mcp/www_authenticate"][0], /os\.read/);

  const wrongAudienceToken = await new SignJWT({ scope: "mail.read" })
    .setProtectedHeader({ alg: "RS256", kid: "birdie-test-key" })
    .setIssuer(issuer)
    .setAudience("https://wrong.example.com")
    .setSubject("auth0|kevin")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const wrongAudience = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${wrongAudienceToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })
  });
  assert.equal(wrongAudience.status, 401);
});
