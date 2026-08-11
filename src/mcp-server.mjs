import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as defaultMailService from "./mail-service.mjs";

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
    { name: "birdie-mail", version: "1.0.0" },
    {
      instructions:
        "Read Birdie & Breakfast mail only through these governed IONOS tools. " +
        "Use birdie_mail_list before birdie_mail_get unless the user supplied a UID. " +
        "Never invent messages, suppliers, prices, recipients or attachment contents. " +
        "This MCP surface is read-only; sending, moving, flagging and deletion are intentionally unavailable."
    }
  );

  server.registerTool(
    "birdie_mail_health",
    {
      title: "Check Birdie mailbox",
      description:
        "Check whether the governed kevin@birdiebites.de IONOS mailbox is configured and authenticated.",
      inputSchema: {},
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
