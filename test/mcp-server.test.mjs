import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBirdieMailMcpServer } from "../src/mcp-server.mjs";

function mailService() {
  return {
    getMailHealth: async () => ({ authenticated: true, mailbox: "INBOX", exists: 24 }),
    listRecentMail: async ({ limit, unreadOnly, mailbox }) => [
      { uid: 24, subject: "Supplier quote", limit, unreadOnly, mailbox }
    ],
    getMessage: async ({ uid, mailbox }) => ({
      uid: Number(uid),
      mailbox,
      subject: "Supplier quote",
      text: "Quote body",
      attachments: []
    }),
    listMailFolders: async () => [{ path: "INBOX" }, { path: "Sent" }]
  };
}

async function connectedClient(context) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBirdieMailMcpServer({ service: mailService() });
  const client = new Client({ name: "birdie-mail-test", version: "1.0.0" });
  context.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test("MCP exposes only governed read-only mail tools", async (context) => {
  const client = await connectedClient(context);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "birdie_mail_folders",
      "birdie_mail_get",
      "birdie_mail_health",
      "birdie_mail_list"
    ]
  );
  assert.equal(tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
  assert.equal(tools.some((tool) => /send|delete|move|flag/.test(tool.name)), false);
});

test("MCP mail list and detail calls return structured data", async (context) => {
  const client = await connectedClient(context);

  const listed = await client.callTool({
    name: "birdie_mail_list",
    arguments: { limit: 10, unreadOnly: true, mailbox: "INBOX" }
  });
  assert.equal(listed.structuredContent.result[0].uid, 24);
  assert.equal(listed.structuredContent.result[0].unreadOnly, true);

  const message = await client.callTool({
    name: "birdie_mail_get",
    arguments: { uid: 24, mailbox: "INBOX" }
  });
  assert.equal(message.structuredContent.result.subject, "Supplier quote");
  assert.equal(message.structuredContent.result.text, "Quote body");
});
