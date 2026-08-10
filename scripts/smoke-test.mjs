const baseUrl = (process.env.BIRDIE_AGENT_URL || "").replace(/\/$/, "");
const apiKey = process.env.BIRDIE_AGENT_API_KEY || "";

if (!baseUrl) {
  throw new Error("BIRDIE_AGENT_URL is required");
}

if (!apiKey) {
  throw new Error("BIRDIE_AGENT_API_KEY is required");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || body.success === false) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log("1/4 root");
const rootResponse = await fetch(`${baseUrl}/`, {
  headers: { Accept: "application/json" }
});
const root = await rootResponse.json();
assert(rootResponse.ok && root.success === true, "Root status failed");

console.log("2/4 health");
const health = await request("/health");
assert(health.agent === "ONLINE", "Birdie Agent is not ONLINE");

console.log("3/4 next task");
const nextTask = await request("/next-task");
assert(nextTask.authoritative === true, "Next task is not authoritative");
assert(nextTask.source === "BIRDIE_OS", "Next task source is not BIRDIE_OS");

console.log("4/4 chat roundtrip");
const chat = await request("/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Gib mir meinen nächsten Task" })
});
assert(chat.intent === "NEXT_TASK", "Chat intent is not NEXT_TASK");
assert(chat.authoritative === true, "Chat response is not authoritative");
assert(chat.source === "BIRDIE_OS", "Chat source is not BIRDIE_OS");
assert(typeof chat.answer === "string" && chat.answer.trim(), "Chat answer is empty");

console.log("BIRDIE BRIDGE SMOKE TEST: PASS");
console.log(JSON.stringify({
  service: root.service,
  version: root.version,
  health: health.agent,
  intent: chat.intent,
  source: chat.source,
  authoritative: chat.authoritative
}, null, 2));
