import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as defaultMailService from "./mail-service.mjs";
import { getFramerStatus, isFramerConfigured } from "./framer-service.mjs";
import { fullMailAuthContext, oauthChallenge } from "./mcp-auth.mjs";

const MAIL_READ_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] };
const MAIL_WRITE_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.write"] }] };
const MAIL_SEND_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.send"] }] };
const MAIL_DELETE_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["mail.delete"] }] };
const OS_READ_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["os.read"] }] };
const FRAMER_READ_SECURITY = { securitySchemes: [{ type: "oauth2", scopes: ["framer.read"] }] };

function toolResult(data, summary) {
  return {
    structuredContent: { result: data },
    content: [{ type: "text", text: summary }]
  };
}

function toolError(error, meta) {
  return {
    isError: true,
    ...(meta ? { _meta: meta } : {}),
    content: [{
      type: "text",
      text: error?.code || error?.message || "BirdieOS request failed"
    }]
  };
}

function guarded(handler, { authContext, authConfig, requiredScope, label = "BirdieOS" }) {
  return async (input) => {
    if (!authContext.scopes.has(requiredScope)) {
      return toolError(
        { code: "INSUFFICIENT_SCOPE" },
        {
          "mcp/www_authenticate": [oauthChallenge(authConfig, {
            scope: requiredScope,
            error: "insufficient_scope",
            description: `${label} requires the ${requiredScope} permission`
          })]
        }
      );
    }
    try {
      return await handler(input);
    } catch (error) {
      return toolError(error);
    }
  };
}

function createBirdieOsReader(env = process.env) {
  const apiKey = env.BIRDIE_OS_API_KEY;
  const baseUrl = env.BIRDIE_OS_BASE;

  async function get(action) {
    if (!apiKey || !baseUrl) {
      const error = new Error(
        "BIRDIE_OS_API_KEY and BIRDIE_OS_BASE must be configured"
      );
      error.code = "BIRDIE_OS_NOT_CONFIGURED";
      throw error;
    }
    const url = new URL(baseUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      const error = new Error(`Birdie OS HTTP ${response.status}`);
      error.code = "BIRDIE_OS_HTTP_ERROR";
      throw error;
    }
    const data = await response.json();
    if (!data?.success) {
      const error = new Error(data?.error || data?.message || "Birdie OS returned an error");
      error.code = "BIRDIE_OS_ERROR";
      throw error;
    }
    return data;
  }

  return { get };
}

export function createBirdieMailMcpServer({
  service = defaultMailService,
  authContext = fullMailAuthContext(),
  authConfig = {
    metadataUrl: "https://birdie-agent-893591677320.europe-west3.run.app/.well-known/oauth-protected-resource"
  },
  birdieOsReader = createBirdieOsReader(),
  framer = { isConfigured: isFramerConfigured, getStatus: getFramerStatus }
} = {}) {
  const server = new McpServer(
    { name: "birdie-os", version: "1.0.0" },
    {
      instructions:
        "This is the governed BirdieOS control surface for Birdie & Breakfast. " +
        "On explicit BirdieOS startup requests, use birdie_os_startup first. " +
        "Treat BirdieOS as authoritative for current company facts. " +
        "Framer tools exposed in this version are read-only. " +
        "Mail writes, sends and deletes retain their exact approval requirements. " +
        "Never expose secrets, tokens, API keys or runtime credentials."
    }
  );

  server.registerTool(
    "birdie_os_startup",
    {
      title: "Start BirdieOS",
      description:
        "Load the canonical BirdieOS health state and live briefing for a new Birdie session. This is read-only and should be the first tool used after 'Birdie, starte das OS'.",
      inputSchema: {},
      _meta: OS_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const [health, briefing] = await Promise.all([
        birdieOsReader.get("health"),
        birdieOsReader.get("briefing")
      ]);
      return toolResult({
        authoritative: true,
        source: "BIRDIE_OS",
        health: health.data ?? health,
        liveBriefing: briefing.data ?? briefing
      }, "BirdieOS started from the canonical live source.");
    }, { authContext, authConfig, requiredScope: "os.read", label: "BirdieOS" })
  );

  server.registerTool(
    "birdie_os_health",
    {
      title: "Check BirdieOS health",
      description: "Read the canonical BirdieOS health response without changing any state.",
      inputSchema: {},
      _meta: OS_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const result = await birdieOsReader.get("health");
      return toolResult(result.data ?? result, "BirdieOS health checked.");
    }, { authContext, authConfig, requiredScope: "os.read", label: "BirdieOS" })
  );

  server.registerTool(
    "birdie_os_briefing",
    {
      title: "Read BirdieOS briefing",
      description: "Read the canonical live Birdie & Breakfast briefing from BirdieOS.",
      inputSchema: {},
      _meta: OS_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const result = await birdieOsReader.get("briefing");
      return toolResult(result.data ?? result, "BirdieOS live briefing loaded.");
    }, { authContext, authConfig, requiredScope: "os.read", label: "BirdieOS" })
  );

  server.registerTool(
    "birdie_os_next_task",
    {
      title: "Get BirdieOS next task",
      description: "Read the authoritative next actionable task selected by BirdieOS.",
      inputSchema: {},
      _meta: OS_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const result = await birdieOsReader.get("nextTask");
      return toolResult(result.data ?? result, "BirdieOS next task loaded.");
    }, { authContext, authConfig, requiredScope: "os.read", label: "BirdieOS" })
  );

  server.registerTool(
    "birdie_framer_config",
    {
      title: "Check Framer connection",
      description: "Check whether the governed Framer Server API adapter is configured. Does not expose credentials.",
      inputSchema: {},
      _meta: FRAMER_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
    },
    guarded(async () => toolResult({
      configured: Boolean(framer.isConfigured()),
      secretExposed: false
    }, "Framer configuration checked without exposing secrets."), {
      authContext,
      authConfig,
      requiredScope: "framer.read",
      label: "Birdie Framer"
    })
  );

  server.registerTool(
    "birdie_framer_status",
    {
      title: "Read Framer status",
      description: "Read Framer project info, publish info and changed paths through the governed Server API adapter. No publish or deploy occurs.",
      inputSchema: {},
      _meta: FRAMER_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
    },
    guarded(async () => {
      const result = await framer.getStatus();
      return toolResult(result, "Framer project and publish status loaded read-only.");
    }, {
      authContext,
      authConfig,
      requiredScope: "framer.read",
      label: "Birdie Framer"
    })
  );

  server.registerTool(
    "birdie_mail_health",
    {
      title: "Check Birdie mailbox",
      description: "Check whether the governed kevin@birdiebites.de IONOS mailbox is configured and authenticated.",
      inputSchema: {},
      _meta: MAIL_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const health = await service.getMailHealth();
      return toolResult(health, "Birdie mailbox health checked.");
    }, { authContext, authConfig, requiredScope: "mail.read", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_list",
    {
      title: "List Birdie emails",
      description: "List recent Birdie & Breakfast emails with stable IMAP UIDs. Use this to find supplier messages before reading a full message.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20),
        unreadOnly: z.boolean().default(false),
        mailbox: z.string().min(1).max(255).default("INBOX")
      },
      _meta: MAIL_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async ({ limit, unreadOnly, mailbox }) => {
      const messages = await service.listRecentMail({ limit, unreadOnly, mailbox });
      return toolResult(messages, `Found ${messages.length} Birdie email(s).`);
    }, { authContext, authConfig, requiredScope: "mail.read", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_get",
    {
      title: "Read Birdie email",
      description: "Read one Birdie & Breakfast email by the exact IMAP UID returned by birdie_mail_list, including plain-text body and attachment metadata.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX")
      },
      _meta: MAIL_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async ({ uid, mailbox }) => {
      const message = await service.getMessage({ uid, mailbox });
      return toolResult(message, `Read Birdie email UID ${message.uid}.`);
    }, { authContext, authConfig, requiredScope: "mail.read", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_folders",
    {
      title: "List Birdie mail folders",
      description: "List the available IONOS mailbox folders without changing mailbox state.",
      inputSchema: {},
      _meta: MAIL_READ_SECURITY,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    guarded(async () => {
      const folders = await service.listMailFolders();
      return toolResult(folders, `Found ${folders.length} Birdie mail folder(s).`);
    }, { authContext, authConfig, requiredScope: "mail.read", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_update_flags",
    {
      title: "Update Birdie email status",
      description: "Mark one Birdie email as read or unread and/or flagged or unflagged. This changes mailbox state but does not send or delete mail.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        read: z.boolean().optional(),
        flagged: z.boolean().optional()
      },
      _meta: MAIL_WRITE_SECURITY,
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    guarded(async ({ uid, mailbox, read, flagged }) => {
      const result = await service.updateMessageFlags({ uid, mailbox, read, flagged });
      return toolResult(result, `Updated Birdie email UID ${result.uid}.`);
    }, { authContext, authConfig, requiredScope: "mail.write", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_move",
    {
      title: "Move Birdie email",
      description: "Move one Birdie email to an existing mailbox folder. Use birdie_mail_folders first when the exact destination path is unknown.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        destination: z.string().min(1).max(255)
      },
      _meta: MAIL_WRITE_SECURITY,
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    guarded(async ({ uid, mailbox, destination }) => {
      const result = await service.moveMessage({ uid, mailbox, destination });
      return toolResult(result, `Moved Birdie email UID ${result.uid} to ${result.destination}.`);
    }, { authContext, authConfig, requiredScope: "mail.write", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_send",
    {
      title: "Send Birdie email",
      description: "Send an email as kevin@birdiebites.de only after the user explicitly approves the exact recipients, subject and content. Set founderApproved=true and confirmation=SEND_EMAIL only after that approval.",
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
      _meta: MAIL_SEND_SECURITY,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    guarded(async (input) => {
      const result = await service.sendMail(input);
      return toolResult(result, `Sent Birdie email ${result.messageId}.`);
    }, { authContext, authConfig, requiredScope: "mail.send", label: "Birdie Mail" })
  );

  server.registerTool(
    "birdie_mail_delete",
    {
      title: "Delete Birdie email",
      description: "Delete one Birdie email only after explicit user approval. Prefer mode=trash with confirmation=MOVE_TO_TRASH. Use mode=permanent with confirmation=DELETE_PERMANENTLY only when the user explicitly requests irreversible deletion.",
      inputSchema: {
        uid: z.union([z.string().min(1).max(32), z.number().int().positive()]),
        mailbox: z.string().min(1).max(255).default("INBOX"),
        mode: z.enum(["trash", "permanent"]).default("trash"),
        founderApproved: z.literal(true),
        confirmation: z.enum(["MOVE_TO_TRASH", "DELETE_PERMANENTLY"])
      },
      _meta: MAIL_DELETE_SECURITY,
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true }
    },
    guarded(async (input) => {
      const result = await service.deleteMessage(input);
      const summary = result.mode === "permanent"
        ? `Permanently deleted Birdie email UID ${result.uid}.`
        : `Moved Birdie email UID ${result.uid} to trash.`;
      return toolResult(result, summary);
    }, { authContext, authConfig, requiredScope: "mail.delete", label: "Birdie Mail" })
  );

  return server;
}

export const createBirdieOsMcpServer = createBirdieMailMcpServer;

export async function routeMcpRequest({
  req,
  res,
  url,
  service = defaultMailService,
  authContext,
  authConfig
}) {
  if (url.pathname !== "/mcp") return false;

  const server = createBirdieMailMcpServer({ service, authContext, authConfig });
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
