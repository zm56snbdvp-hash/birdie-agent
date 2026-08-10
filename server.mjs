import http from "node:http";
import OpenAI from "openai";

const PORT = process.env.PORT || 8080;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

// Birdie OS
const BIRDIE_OS_API_KEY = process.env.BIRDIE_OS_API_KEY;

const BIRDIE_OS_BASE =
  process.env.BIRDIE_OS_BASE ||
  "https://script.google.com/macros/s/AKfycbyW0feMDEMYj2KRAt_kaq6SgOMQN4rZFdlFszxvJLyyExhN7_sJyEPLKRi9vobS4U2E6Q/exec";

// Birdie GPT -> Birdie Agent
const BIRDIE_AGENT_API_KEY = process.env.BIRDIE_AGENT_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing.");
}

if (!BIRDIE_OS_API_KEY) {
  throw new Error("BIRDIE_OS_API_KEY is missing.");
}

if (!BIRDIE_AGENT_API_KEY) {
  throw new Error("BIRDIE_AGENT_API_KEY is missing.");
}

const client = new OpenAI({
  apiKey: OPENAI_API_KEY
});


// ==================================================
// JSON RESPONSE
// ==================================================

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Birdie-Agent-Key",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS"
  });

  res.end(JSON.stringify(body));
}


// ==================================================
// READ REQUEST BODY
// ==================================================

async function readBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}


// ==================================================
// AGENT AUTH
// ==================================================

function isAgentAuthorized(req) {
  const bearer =
    req.headers.authorization || "";

  const customHeader =
    req.headers["x-birdie-agent-key"] || "";

  if (
    bearer === `Bearer ${BIRDIE_AGENT_API_KEY}`
  ) {
    return true;
  }

  if (
    customHeader === BIRDIE_AGENT_API_KEY
  ) {
    return true;
  }

  return false;
}


// ==================================================
// BIRDIE OS GET
// ==================================================

async function birdieOSGet(action) {
  const url = new URL(BIRDIE_OS_BASE);

  url.searchParams.set(
    "action",
    action
  );

  url.searchParams.set(
    "api_key",
    BIRDIE_OS_API_KEY
  );

  const response =
    await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/json"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Birdie OS HTTP ${response.status}`
    );
  }

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Birdie OS returned non-JSON response: ${raw.slice(
        0,
        200
      )}`
    );
  }

  if (!data.success) {
    throw new Error(
      `Birdie OS error: ${
        data.error ||
        data.message ||
        "unknown error"
      }`
    );
  }

  return data;
}


// ==================================================
// BIRDIE OS POST
// ==================================================

async function birdieOSPost(payload) {
  const url = new URL(BIRDIE_OS_BASE);

  url.searchParams.set(
    "api_key",
    BIRDIE_OS_API_KEY
  );

  const response =
    await fetch(url.toString(), {
      method: "POST",

      /*
      Apps Script ContentService uses redirects.
      Node fetch follows them correctly here.
      */

      redirect: "follow",

      headers: {
        "Content-Type":
          "text/plain;charset=utf-8",
        Accept:
          "application/json"
      },

      body:
        JSON.stringify(payload)
    });

  if (!response.ok) {
    throw new Error(
      `Birdie OS POST HTTP ${response.status}`
    );
  }

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Birdie OS POST returned non-JSON response: ${raw.slice(
        0,
        200
      )}`
    );
  }

  if (!data.success) {
    throw new Error(
      `Birdie OS write error: ${
        data.error ||
        data.message ||
        "unknown error"
      }`
    );
  }

  return data;
}


// ==================================================
// LIVE BRIEFING
// ==================================================

async function getLiveBriefing() {
  const result =
    await birdieOSGet("briefing");

  return result.data;
}


// ==================================================
// NEXT TASK
// ==================================================

async function getAuthoritativeNextTask() {
  const result =
    await birdieOSGet("nextTask");

  return result.data;
}


// ==================================================
// PHRASE NEXT TASK
// ==================================================

async function phraseNextTask(task) {
  if (
    !task?.found &&
    !task?.taskId
  ) {
    return (
      task?.message ||
      "Birdie OS hat aktuell keinen ausführbaren OPEN-Task gefunden."
    );
  }

  const response =
    await client.responses.create({
      model: OPENAI_MODEL,

      store: false,

      instructions: `
You are Birdie, the operating agent for Birdie & Breakfast.

The JSON input is an authoritative task record from Birdie OS.

Rules:
- Never replace the task.
- Never invent another task.
- Never change taskId, task, priority, status or nextAction.
- Never invent blockers, deadlines, suppliers, costs or company facts.
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
[one sentence based only on supplied data]
`,

      input:
        JSON.stringify(task)
    });

  return response.output_text;
}


// ==================================================
// GENERAL RESPONSE
// ==================================================

async function generalResponse(
  message,
  briefing
) {
  const response =
    await client.responses.create({
      model: OPENAI_MODEL,

      store: false,

      instructions: `
You are Birdie, the operating agent for Birdie & Breakfast.

You receive:
1. The user's request.
2. The current authoritative LIVE BRIEFING from Birdie OS.

Rules:
- Treat Birdie OS as the source of truth for current company facts.
- Never invent live company data.
- Never claim an action was completed unless it was actually executed.
- External financial, legal, reputational or irreversible actions require explicit founder approval.
- Respond in German unless asked otherwise.
- Be concise and operational.
`,

      input: JSON.stringify({
        message,
        liveBriefing: briefing
      })
    });

  return response.output_text;
}


// ==================================================
// NEXT TASK INTENT
// ==================================================

function normalize(text = "") {
  return String(text)
    .trim()
    .toLowerCase();
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
    /today.?s priority/
  ];

  return patterns.some(
    (pattern) =>
      pattern.test(t)
  );
}


// ==================================================
// CHAT HANDLER
// ==================================================

async function handleChat(message) {
  if (
    !message ||
    !String(message).trim()
  ) {
    throw new Error(
      "message is required"
    );
  }

  if (
    isNextTaskIntent(message)
  ) {
    const task =
      await getAuthoritativeNextTask();

    return {
      intent: "NEXT_TASK",
      source: "BIRDIE_OS",
      authoritative: true,
      data: task,
      answer:
        await phraseNextTask(task)
    };
  }

  const briefing =
    await getLiveBriefing();

  return {
    intent: "GENERAL",
    source:
      "OPENAI+BIRDIE_OS",
    authoritative: true,

    answer:
      await generalResponse(
        message,
        briefing
      )
  };
}


// ==================================================
// CREATE IDEA
// ==================================================

async function createIdea(body) {
  if (
    !body.idea ||
    !String(body.idea).trim()
  ) {
    throw new Error(
      "idea is required"
    );
  }

  const payload = {
    action: "addIdea",

    idea:
      String(body.idea).trim(),

    category:
      body.category ||
      "GENERAL",

    status:
      body.status ||
      "BACKLOG",

    horizon:
      body.horizon ||
      "NEXT",

    productProject:
      body.productProject ||
      "",

    notes:
      body.notes ||
      "",

    source:
      "Birdie GPT",

    confirmation:
      body.confirmation ||
      ""
  };

  return await birdieOSPost(
    payload
  );
}


// ==================================================
// UPDATE TASK
// ==================================================

async function updateTask(
  taskId,
  body
) {
  if (
    !taskId ||
    !String(taskId).trim()
  ) {
    throw new Error(
      "taskId is required"
    );
  }

  if (
    !body.updates ||
    typeof body.updates !==
      "object"
  ) {
    throw new Error(
      "updates object is required"
    );
  }


  /*
  Governance:
  Only operational task fields.
  */


  const allowedFields = [
    "Status",
    "Owner",
    "Due Date",
    "Dependency",
    "Next Action",
    "Notes",
    "Priority"
  ];


  const cleanUpdates = {};


  for (
    const [
      field,
      value
    ] of Object.entries(
      body.updates
    )
  ) {

    if (
      !allowedFields.includes(
        field
      )
    ) {
      throw new Error(
        `Task field not allowed: ${field}`
      );
    }

    cleanUpdates[field] =
      value;
  }


  /*
  Founder approval protection.

  Birdie may not mark a task DONE
  if the request explicitly says
  founder approval is required.
  */


  if (
    cleanUpdates.Status ===
      "DONE" &&
    body.requiresFounderApproval ===
      true &&
    body.founderApproved !==
      true
  ) {
    throw new Error(
      "FOUNDER_APPROVAL_REQUIRED"
    );
  }


  const payload = {
    action:
      "updateTask",

    taskId:
      String(taskId).trim(),

    updates:
      cleanUpdates,

    source:
      "Birdie GPT",

    confirmation:
      body.confirmation ||
      "",

    notes:
      body.notes ||
      ""
  };


  return await birdieOSPost(
    payload
  );
}


// ==================================================
// SERVER
// ==================================================

const server =
  http.createServer(
    async (req, res) => {

      try {

        // ------------------------------------------
        // CORS
        // ------------------------------------------

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(204, {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Birdie-Agent-Key",

            "Access-Control-Allow-Methods":
              "GET,POST,OPTIONS"
          });

          return res.end();
        }


        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
          );


        // ------------------------------------------
        // PUBLIC ROOT
        // ------------------------------------------

        if (
          req.method === "GET" &&
          url.pathname === "/"
        ) {
          return json(
            res,
            200,
            {
              success: true,
              service:
                "Birdie Agent",
              version:
                "2.0",
              status:
                "ONLINE",
              birdieOS:
                "CONNECTED",
              writeAccess:
                "CONTROLLED"
            }
          );
        }


        // ------------------------------------------
        // AUTH GATE
        // Everything below requires Birdie Agent key
        // ------------------------------------------

        if (
          !isAgentAuthorized(req)
        ) {
          return json(
            res,
            401,
            {
              success: false,
              error:
                "UNAUTHORIZED"
            }
          );
        }


        // ------------------------------------------
        // HEALTH
        // ------------------------------------------

        if (
          req.method === "GET" &&
          url.pathname ===
            "/health"
        ) {
          const birdie =
            await birdieOSGet(
              "health"
            );

          return json(
            res,
            200,
            {
              success: true,
              agent:
                "ONLINE",
              birdieOS:
                birdie
            }
          );
        }


        // ------------------------------------------
        // LIVE BRIEFING
        // ------------------------------------------

        if (
          req.method === "GET" &&
          url.pathname ===
            "/briefing"
        ) {
          const briefing =
            await getLiveBriefing();

          return json(
            res,
            200,
            {
              success: true,
              authoritative:
                true,
              source:
                "BIRDIE_OS",
              data:
                briefing
            }
          );
        }


        // ------------------------------------------
        // NEXT TASK
        // ------------------------------------------

        if (
          req.method === "GET" &&
          url.pathname ===
            "/next-task"
        ) {
          const task =
            await getAuthoritativeNextTask();

          return json(
            res,
            200,
            {
              success: true,
              authoritative:
                true,
              source:
                "BIRDIE_OS",
              data:
                task,
              answer:
                await phraseNextTask(
                  task
                )
            }
          );
        }


        // ------------------------------------------
        // CREATE IDEA
        // ------------------------------------------

        if (
          req.method === "POST" &&
          url.pathname ===
            "/ideas"
        ) {
          const body =
            await readBody(req);

          const result =
            await createIdea(
              body
            );

          return json(
            res,
            200,
            {
              success: true,
              source:
                "BIRDIE_OS",
              data:
                result.data
            }
          );
        }


        // ------------------------------------------
        // UPDATE TASK
        // POST /tasks/TASK-020
        // ------------------------------------------

        if (
          req.method === "POST" &&
          url.pathname.startsWith(
            "/tasks/"
          )
        ) {
          const taskId =
            decodeURIComponent(
              url.pathname
                .slice(
                  "/tasks/".length
                )
            );

          const body =
            await readBody(req);

          const result =
            await updateTask(
              taskId,
              body
            );

          return json(
            res,
            200,
            {
              success: true,
              source:
                "BIRDIE_OS",
              data:
                result.data
            }
          );
        }


        // ------------------------------------------
        // CHAT
        // ------------------------------------------

        if (
          req.method === "POST" &&
          url.pathname ===
            "/chat"
        ) {
          const body =
            await readBody(req);

          const result =
            await handleChat(
              body.message
            );

          return json(
            res,
            200,
            {
              success: true,
              ...result
            }
          );
        }


        // ------------------------------------------
        // NOT FOUND
        // ------------------------------------------

        return json(
          res,
          404,
          {
            success: false,
            error:
              "NOT_FOUND",
            routes: [
              "GET /",
              "GET /health",
              "GET /briefing",
              "GET /next-task",
              "POST /ideas",
              "POST /tasks/{taskId}",
              "POST /chat"
            ]
          }
        );


      } catch (error) {

        console.error(error);

        return json(
          res,
          500,
          {
            success: false,
            error:
              error.message ||
              String(error)
          }
        );

      }
    }
  );


// ==================================================
// LISTEN
// ==================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Birdie Agent listening on port ${PORT}`
    );
  }
);
