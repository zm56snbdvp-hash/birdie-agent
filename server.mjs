import http from "node:http";
import OpenAI from "openai";

const PORT = process.env.PORT || 8080;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BIRDIE_OS_API_KEY = process.env.BIRDIE_OS_API_KEY;
const BIRDIE_OS_BASE =
  process.env.BIRDIE_OS_BASE ||
  "https://script.google.com/macros/s/AKfycbwzYXUsn0uJTeJJTmf3sWZ36KrriZg8XgLtV0N9bOmQkJ2NXI1xGmJfabocQCd5UMtSpg/exec";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing.");
}

if (!BIRDIE_OS_API_KEY) {
  throw new Error("BIRDIE_OS_API_KEY is missing.");
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function normalize(text = "") {
  return String(text).trim().toLowerCase();
}

function isNextTaskIntent(text) {
  const t = normalize(text);

  const patterns = [
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
    /today.?s priority/,
  ];

  return patterns.some((p) => p.test(t));
}

async function birdieOS(path) {
  const url = new URL(`${BIRDIE_OS_BASE}/${path}`);
  url.searchParams.set("api_key", BIRDIE_OS_API_KEY);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Birdie OS HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(
      `Birdie OS error: ${data.error || data.message || "unknown error"}`
    );
  }

  return data;
}

async function getAuthoritativeNextTask() {
  const result = await birdieOS("next-task");
  return result.data;
}

async function phraseNextTask(task) {
  if (!task?.found) {
    return task?.message || "Birdie OS hat aktuell keinen ausführbaren OPEN-Task gefunden.";
  }

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    store: false,
    instructions: `
You are Birdie, the operating agent for Birdie & Breakfast.

The JSON input is an authoritative task record from Birdie OS.

Rules:
- Never replace the task.
- Never invent or infer another task.
- Never change the meaning of taskId, task, priority, status, or nextAction.
- Do not invent blockers, deadlines, costs, sales, suppliers, or company facts.
- Respond in German.
- Keep the answer concise and operational.

Format:

NEXT TASK
[TASK-ID — task]

PRIORITY
[priority] · [status]

DO THIS NOW
[nextAction]

WHY THIS
[one short sentence based only on supplied task fields]
`,
    input: JSON.stringify(task),
  });

  return response.output_text;
}

async function generalResponse(message) {
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    store: false,
    instructions: `
You are Birdie, the Birdie & Breakfast operating agent.
Do not invent live company data.
Write access is disabled.
If the user asks for live operational data that is not connected in this route, say so clearly.
Respond in German unless asked otherwise.
`,
    input: message,
  });

  return response.output_text;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

async function handleChat(message) {
  if (!message || !String(message).trim()) {
    throw new Error("message is required");
  }

  if (isNextTaskIntent(message)) {
    const task = await getAuthoritativeNextTask();
    return {
      intent: "NEXT_TASK",
      source: "BIRDIE_OS",
      authoritative: true,
      data: task,
      answer: await phraseNextTask(task),
    };
  }

  return {
    intent: "GENERAL",
    source: "OPENAI",
    authoritative: false,
    answer: await generalResponse(message),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        success: true,
        service: "Birdie Agent",
        version: "1.0",
        status: "ONLINE",
        writeAccess: "DISABLED",
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const birdie = await birdieOS("health");
      return json(res, 200, {
        success: true,
        agent: "ONLINE",
        birdieOS: birdie,
      });
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      const body = await readBody(req);
      const result = await handleChat(body.message);
      return json(res, 200, { success: true, ...result });
    }

    return json(res, 404, {
      success: false,
      error: "NOT_FOUND",
      routes: ["GET /", "GET /health", "POST /chat"],
    });
  } catch (error) {
    return json(res, 500, {
      success: false,
      error: error.message,
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Birdie Agent listening on port ${PORT}`);
});