import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFamilyReadService } from "./family-service.mjs";
import { isFamilyAuthorized } from "./family-auth.mjs";

function toolResult(data, summary) {
  return {
    structuredContent: { result: data },
    content: [{ type: "text", text: summary }]
  };
}

export function createBirdieFamilyMcpServer({ birdieOSGet }) {
  const service = createFamilyReadService({ birdieOSGet });
  const server = new McpServer(
    { name: "birdie-family", version: "1.0.0" },
    {
      instructions:
        "Birdie Family is a strictly read-only view of Birdie & Breakfast. " +
        "Use only the tools exposed by this server. Never claim access to mail, finance, credentials, audit logs or write capabilities. " +
        "All returned BirdieOS data is filtered by the FAMILY_READ_ONLY policy."
    }
  );

  const ro = { readOnlyHint: true, openWorldHint: false, destructiveHint: false };

  server.registerTool(
    "birdie_family_policy",
    {
      title: "Birdie Family access policy",
      description: "Show the immutable read-only access policy for this Birdie Family connection.",
      inputSchema: {},
      annotations: ro
    },
    async () => toolResult(service.policy(), "Birdie Family access policy loaded.")
  );

  server.registerTool(
    "birdie_family_health",
    {
      title: "Birdie Family health",
      description: "Read a sanitized BirdieOS health snapshot. This tool cannot modify BirdieOS.",
      inputSchema: {},
      annotations: ro
    },
    async () => toolResult(await service.health(), "Birdie Family health snapshot loaded.")
  );

  server.registerTool(
    "birdie_family_briefing",
    {
      title: "Birdie Family briefing",
      description: "Read the current sanitized BirdieOS live briefing. Finance, mail, credentials and other restricted fields are removed.",
      inputSchema: {},
      annotations: ro
    },
    async () => toolResult(await service.briefing(), "Birdie Family live briefing loaded.")
  );

  server.registerTool(
    "birdie_family_next_task",
    {
      title: "Birdie Family current task",
      description: "Read the current sanitized BirdieOS next-task snapshot without changing task state.",
      inputSchema: {},
      annotations: ro
    },
    async () => toolResult(await service.nextTask(), "Birdie Family task snapshot loaded.")
  );

  return server;
}

export async function routeFamilyMcpRequest({
  req,
  res,
  url,
  birdieOSGet,
  familyApiKey = process.env.BIRDIE_FAMILY_API_KEY
}) {
  if (url.pathname !== "/family/mcp") return false;

  if (!String(familyApiKey ?? "").trim()) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "FAMILY_ACCESS_NOT_CONFIGURED" }));
    return true;
  }

  if (!isFamilyAuthorized(req, familyApiKey)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "UNAUTHORIZED" }));
    return true;
  }

  const server = createBirdieFamilyMcpServer({ birdieOSGet });
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
