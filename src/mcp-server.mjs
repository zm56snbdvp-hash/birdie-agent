import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as defaultMailService from "./mail-service.mjs";

const READ_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] };
const WRITE_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.write"] }] };
const SEND_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.send"] }] };
const DELETE_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.delete"] }] };

function toolResult(data, summary) {
  return {
    structuredContent: { result: data },
    content: [{ type: "text", text: summary }]
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: error?.code || error?.message || "Birdie Mail request failed"
    }]
  };
}

function guarded(handler) {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return toolError(error);
    }
  };
}

export function createBirdieMailMcpServer({ service = defaultMailService } = {}) {
  const server = new McpServer(
    { name: "birdie-mail", version: "1.1.0" },
    {
      instructions:
        "Use these governed IONOS tools for the Birdie & Breakfast mailbox. " +
        "Use birdie_mail_list before birdie_mail_get unless the user supplied a UID. " +
        "Never invent messages, suppliers, prices, recipients or attachment contents. " +
        "Never send or delete without the user's explicit approval of that exact action. " +
        "Prefer moving to trash over permanent deletion. Permanent deletion is allowed only when the user explicitly asks for irreversible deletion."
    }
  );

  server.registerTool(
    "birdie_mail_health",
    {
      title: "Check Birdie mailbox",
      description:
        "Check whether the governed kevin@birdiebites.de IONOS mailbox is configured and authenticated.",
      inputSchema: {},
      _meta: READ_SECURITY,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async () => {
      const health = await service.getMailHealth();
      return toolResult(health, "Birdie mailbox health checked.");
    })
  );

  server.registerTool(
    "birdie_mail_list",
    {
      title: "List Birdie emails",
      description:
        "List recent Birdie & Breakfast emails with stable IMAP UIDs. Use this to find supplier messages before reading a full message.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20),
        unreadOnly: z.boolean().default(false),
        mailbox: z.string().min(1).max(255).default("INBOX")
      },
      _meta: READ_SECURITY,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async ({ limit, unreadOnly, mailbox }) => {
      const messages = await service.listRecentMail({ limit, unreadOnly, mailbox });
      return toolResult(messages, `Found ${messages.length} Birdie email(s).`);
    })
  );

  server.registerTool(
    "birdie_mail_get",
    {
      title: "Read Birdie email",
      description:
        "Read one Birdie & Breakfast email by the exact IMAP UID returned by birdie_mail_list, including plain-text body and attachment metadata.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX")
      },
      _meta: READ_SECURITY,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async ({ uid, mailbox }) => {
      const message = await service.getMessage({ uid, mailbox });
      return toolResult(message, `Read Birdie email UID ${message.uid}.`);
    })
  );

  server.registerTool(
    "birdie_mail_folders",
    {
      title: "List Birdie mail folders",
      description:
        "List the available IONOS mailbox folders without changing mailbox state.",
      inputSchema: {},
      _meta: READ_SECURITY,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async () => {
      const folders = await service.listMailFolders();
      return toolResult(folders, `Found ${folders.length} Birdie mail folder(s).`);
    })
  );

  server.registerTool(
    "birdie_mail_update_flags",
    {
      title: "Update Birdie email status",
      description:
        "Mark one Birdie email as read or unread and/or flagged or unflagged. This changes mailbox state but does not send or delete mail.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        read: z.boolean().optional(),
        flagged: z.boolean().optional()
      },
      _meta: WRITE_SECURITY,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async ({ uid, mailbox, read, flagged }) => {
      const result = await service.updateMessageFlags({ uid, mailbox, read, flagged });
      return toolResult(result, `Updated Birdie email UID ${result.uid}.`);
    })
  );

  server.registerTool(
    "birdie_mail_move",
    {
      title: "Move Birdie email",
      description:
        "Move one Birdie email to an existing mailbox folder. Use birdie_mail_folders first when the exact destination path is unknown.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        destination: z.string().min(1).max(255)
      },
      _meta: WRITE_SECURITY,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      }
    },
    guarded(async ({ uid, mailbox, destination }) => {
      const result = await service.moveMessage({ uid, mailbox, destination });
      return toolResult(result, `Moved Birdie email UID ${result.uid} to ${result.destination}.`);
    })
  );

  server.registerTool(
    "birdie_mail_send",
    {
      title: "Send Birdie email",
      description:
        "Send an email as kevin@birdiebites.de only after the user explicitly approves the exact recipients, subject and content. Set founderApproved=true and confirmation=SEND_EMAIL only after that approval.",
      inputSchema: {
        to: z.array(z.string().email().max(320)).min(1).max(20),
        cc: z.array(z.string().email().max(320)).max(20).default([]),
        bcc: z.array(z.string().email().max(320)).max(20).default([]),
        subject: z.string().min(1).max(998),
        text: z.string().max(100000).optional(),
        html: z.string().max(200000).optional(),
        founderApproved: z.literal(true),
        confirmation: z.literal("SEND_EMAIL")
      },
      _meta: SEND_SECURITY,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false
      }
    },
    guarded(async (input) => {
      const result = await service.sendMail(input);
      return toolResult(result, `Sent Birdie email ${result.messageId}.`);
    })
  );

  server.registerTool(
    "birdie_mail_delete",
    {
      title: "Delete Birdie email",
      description:
        "Delete one Birdie email only after explicit user approval. Prefer mode=trash with confirmation=MOVE_TO_TRASH. Use mode=permanent with confirmation=DELETE_PERMANENTLY only when the user explicitly requests irreversible deletion.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        mode: z.enum(["trash", "permanent"]).default("trash"),
        founderApproved: z.literal(true),
        confirmation: z.enum(["MOVE_TO_TRASH", "DELETE_PERMANENTLY"])
      },
      _meta: DELETE_SECURITY,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true
      }
    },
    guarded(async (input) => {
      const result = await service.deleteMessage(input);
      const summary = result.mode === "permanent"
        ? `Permanently deleted Birdie email UID ${result.uid}.`
        : `Moved Birdie email UID ${result.uid} to trash.`;
      return toolResult(result, summary);
    })
  );

  return server;
}

export async function routeMcpRequest({ req, res, url, service = defaultMailService }) {
  if (url.pathname !== "/mcp") return false;

  const server = createBirdieMailMcpServer({ service });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  const cleanup = () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  };
  res.once("close", cleanup);

  await server.connect(transport);
  await transport.handleRequest(req, res);
  return true;
}
