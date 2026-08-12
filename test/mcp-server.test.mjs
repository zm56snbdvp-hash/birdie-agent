import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBirdieMailMcpServer } from "../src/mcp-server.mjs";

function mailService(overrides = {}) {
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
    listMailFolders: async () => [{ path: "INBOX" }, { path: "Sent" }],
    updateMessageFlags: async (input) => input,
    moveMessage: async ({ uid, mailbox, destination }) => ({ uid, from: mailbox, destination }),
    sendMail: async () => ({ messageId: "mail-123", accepted: ["mama@example.com"] }),
    deleteMessage: async (input) => ({ ...input, from: input.mailbox, destination: "Trash" }),
    ...overrides
  };
}

async function connectedClient(context, service = mailService()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBirdieMailMcpServer({ service });
  const client = new Client({ name: "birdie-mail-test", version: "1.0.0" });
  context.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test("MCP exposes governed BirdieOS, Framer-read and mail tools", async (context) => {
  const client = await connectedClient(context);
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
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.birdie_os_startup.annotations.readOnlyHint, true);
  assert.equal(byName.birdie_framer_status.annotations.readOnlyHint, true);
  assert.equal(byName.birdie_mail_list.annotations.readOnlyHint, true);
  assert.equal(byName.birdie_mail_update_flags.annotations.readOnlyHint, false);
  assert.equal(byName.birdie_mail_send.annotations.openWorldHint, true);
  assert.equal(byName.birdie_mail_delete.annotations.destructiveHint, true);
  assert.deepEqual(byName.birdie_os_startup._meta.securitySchemes[0].scopes, ["os.read"]);
  assert.deepEqual(byName.birdie_framer_status._meta.securitySchemes[0].scopes, ["framer.read"]);
  assert.deepEqual(byName.birdie_mail_send._meta.securitySchemes[0].scopes, ["mail.send"]);
  assert.deepEqual(byName.birdie_mail_delete._meta.securitySchemes[0].scopes, ["mail.delete"]);
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

test("MCP passes explicit send approval to the governed mail service", async (context) => {
  let sent;
  const client = await connectedClient(context, mailService({
    sendMail: async (input) => {
      sent = input;
      return { messageId: "mail-456", accepted: input.to };
    }
  }));

  const result = await client.callTool({
    name: "birdie_mail_send",
    arguments: {
      to: ["mama@example.com"],
      subject: "Birdie & Breakfast",
      text: "Willkommen!",
      founderApproved: true,
      confirmation: "SEND_EMAIL"
    }
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.result.messageId, "mail-456");
  assert.equal(sent.confirmation, "SEND_EMAIL");
  assert.deepEqual(sent.cc, []);
});

test("MCP keeps delete approval enforcement in the governed mail service", async (context) => {
  const client = await connectedClient(context, mailService({
    deleteMessage: async (input) => {
      if (input.mode === "permanent" && input.confirmation !== "DELETE_PERMANENTLY") {
        const error = new Error("Permanent deletion approval is required");
        error.code = "FOUNDER_APPROVAL_REQUIRED";
        throw error;
      }
      return input;
    }
  }));

  const result = await client.callTool({
    name: "birdie_mail_delete",
    arguments: {
      uid: 24,
      mailbox: "INBOX",
      mode: "permanent",
      founderApproved: true,
      confirmation: "MOVE_TO_TRASH"
    }
  });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "FOUNDER_APPROVAL_REQUIRED");
});
