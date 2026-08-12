const TARGET_WORK_ITEM_ID = "WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011";
const EXPECTED_EXTERNAL_USER_ID = "schulli.birdie";
const EXPECTED_RESULT = {
  resolutionStatus: "IDENTITY_PENDING",
  matchedBirdieId: "",
  decision: "NO_PROFILE_MATCH",
  identityConfidence: 0,
  identityConflict: false,
  identityDecisionMode: "FOUNDER_REVIEW_LOW_CONFIDENCE"
};

const agentBase = String(process.env.BIRDIE_AGENT_BASE || "").replace(/\/$/, "");
const agentKey = process.env.BIRDIE_AGENT_API_KEY;
const osBase = process.env.BIRDIE_OS_BASE;
const osKey = process.env.BIRDIE_OS_API_KEY;
const confirmation = process.env.E2E_CONFIRM;

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

required("BIRDIE_AGENT_BASE", agentBase);
required("BIRDIE_AGENT_API_KEY", agentKey);
required("BIRDIE_OS_BASE", osBase);
required("BIRDIE_OS_API_KEY", osKey);

if (confirmation !== "RUN_IDENTITY_E2E") {
  throw new Error("E2E_CONFIRM must equal RUN_IDENTITY_E2E");
}

async function parseJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function getWorkItem() {
  const url = new URL(osBase);
  url.searchParams.set("action", "communityWorkItem");
  url.searchParams.set("workItemId", TARGET_WORK_ITEM_ID);
  url.searchParams.set("api_key", osKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow" });
  const body = await parseJson(response, "Birdie OS communityWorkItem");
  const workItem = body?.data?.workItem || body?.data;
  if (!workItem || workItem.workItemId !== TARGET_WORK_ITEM_ID) {
    throw new Error("Target work item was not returned exactly");
  }
  return workItem;
}

function assertPrecondition(workItem) {
  if (workItem.externalUserId !== EXPECTED_EXTERNAL_USER_ID) {
    throw new Error(`Unexpected externalUserId: ${workItem.externalUserId}`);
  }
  if (!["PENDING_IDENTITY", "IDENTITY_PENDING"].includes(workItem.resolutionStatus)) {
    throw new Error(`Unexpected pre-test resolutionStatus: ${workItem.resolutionStatus}`);
  }
  if (String(workItem.matchedBirdieId || "") !== "") {
    throw new Error("Target already has matchedBirdieId; refusing E2E write");
  }
}

function assertResult(workItem) {
  for (const [key, expected] of Object.entries(EXPECTED_RESULT)) {
    const actual = key === "matchedBirdieId" ? String(workItem[key] || "") : workItem[key];
    if (actual !== expected) {
      throw new Error(`Verification failed for ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
}

const before = await getWorkItem();
assertPrecondition(before);

const resolveResponse = await fetch(`${agentBase}/community/identity/resolve`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${agentKey}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  },
  body: JSON.stringify({ workItemId: TARGET_WORK_ITEM_ID })
});
const resolveBody = await parseJson(resolveResponse, "Birdie Agent identity resolver");
if (resolveBody?.success !== true) throw new Error("Resolver did not return success=true");

const after = await getWorkItem();
assertResult(after);

console.log(JSON.stringify({
  success: true,
  workItemId: TARGET_WORK_ITEM_ID,
  before: {
    resolutionStatus: before.resolutionStatus,
    matchedBirdieId: before.matchedBirdieId || ""
  },
  after: {
    resolutionStatus: after.resolutionStatus,
    matchedBirdieId: after.matchedBirdieId || "",
    decision: after.decision,
    identityConfidence: after.identityConfidence,
    identityConflict: after.identityConflict,
    identityDecisionMode: after.identityDecisionMode
  }
}, null, 2));
