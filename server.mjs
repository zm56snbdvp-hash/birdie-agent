import http from "node:http";
import OpenAI from "openai";
import { createCoinService } from "./src/coin/service.mjs";
import { routeCoinRequest } from "./src/coin/router.mjs";
import { routeMailRequest } from "./src/mail-router.mjs";
import { routeFramerRequest } from "./src/framer-router.mjs";
import { routeMcpRequest } from "./src/mcp-server.mjs";
import { routeFamilyMcpRequest } from "./src/family/family-mcp.mjs";
import { routeFamilyApiRequest } from "./src/family/family-api.mjs";
import {
  authenticateMcpRequest,
  createMcpAuthConfig,
  oauthChallenge,
  protectedResourceMetadata
} from "./src/mcp-auth.mjs";

const PORT = process.env.PORT || 8080;
const BIRDIE_AGENT_VERSION = "2.7.0";
const ACTION_RESPONSE_MAX_CHARS = 60_000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const BIRDIE_OS_API_KEY = process.env.BIRDIE_OS_API_KEY;
const BIRDIE_AGENT_API_KEY = process.env.BIRDIE_AGENT_API_KEY;
const BIRDIE_FAMILY_API_KEY = process.env.BIRDIE_FAMILY_API_KEY;
const BIRDIE_OS_BASE = process.env.BIRDIE_OS_BASE || "https://script.google.com/macros/s/AKfycbyW0feMDEMYj2KRAt_kaq6SgOMQN4rZFdlFszxvJLyyExhN7_sJyEPLKRi9vobS4U2E6Q/exec";
const MCP_AUTH_CONFIG = createMcpAuthConfig();

for (const [name, value] of Object.entries({ OPENAI_API_KEY, BIRDIE_OS_API_KEY, BIRDIE_AGENT_API_KEY })) {
  if (!value) throw new Error(`${name} is missing.`);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Birdie-Agent-Key, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function jsonChars(value) {
  return JSON.stringify(value).length;
}

function compactJson(value, options, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.length <= options.maxStringChars) return value;
    return `${value.slice(0, options.maxStringChars)}… [truncated ${value.length - options.maxStringChars} chars]`;
  }

  if (typeof value !== "object") return String(value);
  if (depth >= options.maxDepth) return "[truncated: max depth]";
  if (seen.has(value)) return "[truncated: circular reference]";
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, options.maxArrayItems)
      .map((item) => compactJson(item, options, depth + 1, seen));
    if (value.length > options.maxArrayItems) {
      result.push({
        _truncated: true,
        omittedItems: value.length - options.maxArrayItems
      });
    }
    return result;
  }

  const entries = Object.entries(value);
  const result = {};
  for (const [key, item] of entries.slice(0, options.maxObjectKeys)) {
    result[key] = compactJson(item, options, depth + 1, seen);
  }
  if (entries.length > options.maxObjectKeys) {
    result._truncated = true;
    result._omittedKeys = entries.length - options.maxObjectKeys;
  }
  return result;
}

function boundActionData(value, maxChars = ACTION_RESPONSE_MAX_CHARS) {
  const originalChars = jsonChars(value);
  if (originalChars <= maxChars) {
    return { data: value, truncated: false, originalChars };
  }

  const profiles = [
    { maxDepth: 8, maxArrayItems: 40, maxObjectKeys: 80, maxStringChars: 3000 },
    { maxDepth: 6, maxArrayItems: 20, maxObjectKeys: 50, maxStringChars: 1500 },
    { maxDepth: 5, maxArrayItems: 10, maxObjectKeys: 30, maxStringChars: 750 }
  ];

  for (const options of profiles) {
    const data = compactJson(value, options);
    if (jsonChars(data) <= maxChars) {
      return { data, truncated: true, originalChars };
    }
  }

  return {
    data: {
      _truncated: true,
      message: "Birdie OS returned more data than a GPT Action may safely consume. Request a narrower resource.",
      topLevelKeys: value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).slice(0, 100)
        : []
    },
    truncated: true,
    originalChars
  };
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must contain valid JSON");
    error.code = "INVALID_JSON";
    error.status = 400;
    throw error;
  }
}

function isAgentAuthorized(req) {
  const bearer = req.headers.authorization || "";
  const customHeader = req.headers["x-birdie-agent-key"] || "";
  return bearer === `Bearer ${BIRDIE_AGENT_API_KEY}` || customHeader === BIRDIE_AGENT_API_KEY;
}

async function parseBirdieResponse(response, label) {
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${raw.slice(0, 200)}`);
  }
  if (!data.success) throw new Error(`${label} error: ${data.error || data.message || "unknown error"}`);
  return data;
}

async function birdieOSGet(action) {
  const url = new URL(BIRDIE_OS_BASE);
  url.searchParams.set("action", action);
  url.searchParams.set("api_key", BIRDIE_OS_API_KEY);
  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "application/json" }
  });
  return parseBirdieResponse(response, "Birdie OS");
}

async function birdieOSPost(payload) {
  const url = new URL(BIRDIE_OS_BASE);
  url.searchParams.set("api_key", BIRDIE_OS_API_KEY);
  const response = await fetch(url.toString(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  return parseBirdieResponse(response, "Birdie OS POST");
}

const coinService = createCoinService({ birdieOSPost });

async function getLiveBriefing() {
  return (await birdieOSGet("briefing")).data;
}

async function getAuthoritativeNextTask() {
  return (await birdieOSGet("nextTask")).data;
}

async function phraseNextTask(task) {
  if (!task?.found && !task?.taskId) {
    return task?.message || "Birdie OS hat aktuell keinen ausführbaren OPEN-Task gefunden.";
  }

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    store: false,
    instructions: `You are Birdie, the operating agent for Birdie & Breakfast.\nThe JSON input is an authoritative task record from Birdie OS.\nRules:\n- Never replace the task.\n- Never invent another task.\n- Never change taskId, task, priority, status or nextAction.\n- Never invent blockers, deadlines, suppliers, costs or company facts.\n- Respond in German.\n- Keep the answer concise and operational.\n\nFormat:\nNEXT TASK\n[TASK-ID — task]\n\nPRIORITY\n[priority] · [status]\n\nDO THIS NOW\n[nextAction]\n\nWHY THIS\n[one sentence based only on supplied data]`,
    input: JSON.stringify(task)
  });

  return response.output_text;
}

async function generalResponse(message, briefing) {
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    store: false,
    instructions: `You are Birdie, the operating agent for Birdie & Breakfast.\nYou receive the user's request and the current authoritative LIVE BRIEFING from Birdie OS.\nRules:\n- Treat Birdie OS as the source of truth for current company facts.\n- Never invent live company data.\n- Never claim an action was completed unless it was actually executed.\n- External financial, legal, reputational or irreversible actions require explicit founder approval.\n- Respond in German unless asked otherwise.\n- Be concise and operational.`,
    input: JSON.stringify({ message, liveBriefing: briefing })
  });
  return response.output_text;
}

function isNextTaskIntent(text = "") {
  const t = String(text).trim().toLowerCase();
  return [
    /gib mir (meinen|den) nächsten task/,
    /was ist mein nächster task/,
    /was soll ich als nächstes machen/,
    /was soll ich jetzt machen/,
    /was ist jetzt am wichtigsten/,
    /was ist heute am wichtigsten/,
    /nächste aufgabe/,
    /nächster task/,
    /next task/,
    /what should i do next/,
    /what is my next task/,
    /today.?s priority/
  ].some((pattern) => pattern.test(t));
}

async function handleChat(message) {
  if (!message || !String(message).trim()) throw new Error("message is required");

  if (isNextTaskIntent(message)) {
    const task = await getAuthoritativeNextTask();
    return {
      intent: "NEXT_TASK",
      source: "BIRDIE_OS",
      authoritative: true,
      data: task,
      answer: await phraseNextTask(task)
    };
  }

  const briefing = await getLiveBriefing();
  return {
    intent: "GENERAL",
    source: "OPENAI+BIRDIE_OS",
    authoritative: true,
    answer: await generalResponse(message, briefing)
  };
}

async function createIdea(body) {
  if (!body.idea || !String(body.idea).trim()) throw new Error("idea is required");
  return birdieOSPost({
    action: "addIdea",
    idea: String(body.idea).trim(),
    category: body.category || "GENERAL",
    status: body.status || "BACKLOG",
    horizon: body.horizon || "NEXT",
    productProject: body.productProject || "",
    notes: body.notes || "",
    source: "Birdie GPT",
    confirmation: body.confirmation || ""
  });
}

async function updateTask(taskId, body) {
  if (!taskId || !String(taskId).trim()) throw new Error("taskId is required");
  if (!body.updates || typeof body.updates !== "object") throw new Error("updates object is required");

  const allowedFields = ["Status", "Owner", "Due Date", "Dependency", "Next Action", "Notes", "Priority"];
  const cleanUpdates = {};
  for (const [field, value] of Object.entries(body.updates)) {
    if (!allowedFields.includes(field)) throw new Error(`Task field not allowed: ${field}`);
    cleanUpdates[field] = value;
  }

  if (cleanUpdates.Status === "DONE" && body.requiresFounderApproval === true && body.founderApproved !== true) {
    throw new Error("FOUNDER_APPROVAL_REQUIRED");
  }

  return birdieOSPost({
    action: "updateTask",
    taskId: String(taskId).trim(),
    updates: cleanUpdates,
    source: "Birdie GPT",
    confirmation: body.confirmation || "",
    notes: body.notes || ""
  });
}

const routes = [
  "GET /",
  "GET /health",
  "GET /startup",
  "GET /briefing",
  "GET /next-task",
  "POST /ideas",
  "POST /tasks/{taskId}",
  "POST /chat",
  "POST /mcp",
  "POST /family/mcp",
  "GET /family/api/policy",
  "GET /family/api/health",
  "GET /family/api/briefing",
  "GET /family/api/next-task",
  "GET /mail/health",
  "GET /mail/messages",
  "GET /mail/messages/{uid}",
  "GET /mail/messages/{uid}/attachments/{index}",
  "GET /mail/folders",
  "POST /mail/folders/bootstrap",
  "PATCH /mail/messages/{uid}",
  "POST /mail/messages/{uid}/move",
  "DELETE /mail/messages/{uid}",
  "POST /mail/send",
  "GET /coin/config",
  "POST /coin/profiles",
  "GET /coin/profiles/{birdieId}",
  "GET /coin/profiles/{birdieId}/ledger",
  "POST /coin/profiles/{birdieId}/badges",
  "POST /coin/claims",
  "POST /coin/claims/{claimId}/decision",
  "GET /coin/rewards",
  "GET /coin/admin/queue",
  "POST /coin/redemptions",
  "POST /coin/redemptions/{redemptionId}/decision",
  "POST /coin/opening-balances",
  "GET /framer/config",
  "GET /framer/status",
  "POST /framer/preview",
  "POST /framer/deploy"
];

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Birdie-Agent-Key, Mcp-Session-Id, Last-Event-ID",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (await routeFamilyApiRequest({
      req,
      res,
      url,
      birdieOSGet,
      familyApiKey: BIRDIE_FAMILY_API_KEY
    })) return;

    if (await routeFamilyMcpRequest({
      req,
      res,
      url,
      birdieOSGet,
      familyApiKey: BIRDIE_FAMILY_API_KEY
    })) return;

    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        success: true,
        service: "Birdie Agent",
        version: BIRDIE_AGENT_VERSION,
        status: "ONLINE",
        birdieOS: "CONNECTED",
        writeAccess: "CONTROLLED",
        mail: "FULL_CONTROL_GOVERNED",
        framer: "GOVERNED_ADAPTER",
        mcp: "AUTH0_GOVERNED_FULL_MAIL_TOOLS"
      });
    }

    if (
      req.method === "GET" &&
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp"
      ].includes(url.pathname)
    ) {
      return json(res, 200, protectedResourceMetadata(MCP_AUTH_CONFIG));
    }

    if (url.pathname === "/mcp") {
      const authContext = await authenticateMcpRequest(req, {
        apiKey: BIRDIE_AGENT_API_KEY,
        config: MCP_AUTH_CONFIG
      });
      if (!authContext) {
        return json(
          res,
          401,
          { success: false, error: "UNAUTHORIZED" },
          { "WWW-Authenticate": oauthChallenge(MCP_AUTH_CONFIG) }
        );
      }
      if (await routeMcpRequest({
        req,
        res,
        url,
        authContext,
        authConfig: MCP_AUTH_CONFIG
      })) return;
    }

    if (!isAgentAuthorized(req)) {
      return json(res, 401, { success: false, error: "UNAUTHORIZED" });
    }

    if (await routeCoinRequest({ req, res, url, json, readBody, service: coinService })) return;
    if (await routeMailRequest({ req, res, url, json, readBody })) return;
    if (await routeFramerRequest({ req, res, url, json, readBody })) return;

    if (req.method === "GET" && url.pathname === "/health") {
      const birdie = await birdieOSGet("health");
      const bounded = boundActionData(birdie, 10_000);
      return json(res, 200, {
        success: true,
        agent: "ONLINE",
        birdieOS: bounded.data,
        truncated: bounded.truncated
      });
    }

    if (req.method === "GET" && url.pathname === "/startup") {
      const birdie = await birdieOSGet("health");
      const briefing = await getLiveBriefing();
      const bounded = boundActionData({ health: birdie, liveBriefing: briefing });
      return json(res, 200, {
        success: true,
        authoritative: true,
        source: "BIRDIE_OS",
        truncated: bounded.truncated,
        data: bounded.data
      });
    }

    if (req.method === "GET" && url.pathname === "/briefing") {
      const briefing = await getLiveBriefing();
      const bounded = boundActionData(briefing);
      return json(res, 200, {
        success: true,
        authoritative: true,
        source: "BIRDIE_OS",
        truncated: bounded.truncated,
        data: bounded.data
      });
    }

    if (req.method === "GET" && url.pathname === "/next-task") {
      const task = await getAuthoritativeNextTask();
      return json(res, 200, {
        success: true,
        authoritative: true,
        source: "BIRDIE_OS",
        data: task,
        answer: await phraseNextTask(task)
      });
    }

    if (req.method === "POST" && url.pathname === "/ideas") {
      const result = await createIdea(await readBody(req));
      return json(res, 200, { success: true, source: "BIRDIE_OS", data: result.data });
    }

    if (req.method === "POST" && url.pathname.startsWith("/tasks/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/tasks/".length));
      const result = await updateTask(taskId, await readBody(req));
      return json(res, 200, { success: true, source: "BIRDIE_OS", data: result.data });
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      const body = await readBody(req);
      const result = await handleChat(body.message);
      return json(res, 200, { success: true, ...result });
    }

    return json(res, 404, { success: false, error: "NOT_FOUND", routes });
  } catch (error) {
    console.error(error);
    return json(res, Number(error.status) || 500, {
      success: false,
      error: error.code || error.message || String(error),
      message: error.message || String(error)
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Birdie Agent listening on port ${PORT}`);
});