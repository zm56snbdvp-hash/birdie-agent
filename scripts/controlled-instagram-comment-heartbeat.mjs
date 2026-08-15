import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PREPARE_SCHEMA = "birdie-instagram-comment-heartbeat/prepare-v1";
const FINAL_SCHEMA = "birdie-instagram-comment-heartbeat/final-v1";

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function required(value, code) {
  const result = String(value ?? "").trim();
  invariant(result, code);
  return result;
}

function normalizeHandle(value) {
  const handle = required(value, "INSTAGRAM_HANDLE_REQUIRED")
    .toLowerCase()
    .replace(/^@/, "");
  invariant(/^[a-z0-9._]{1,30}$/.test(handle), "INSTAGRAM_HANDLE_INVALID");
  return handle;
}

function exactDate(value, code) {
  const input = required(value, code);
  const time = Date.parse(input);
  invariant(Number.isFinite(time), code);
  return { input, time };
}

export function deriveHeartbeatIds(commentId) {
  const id = required(commentId, "COMMENT_ID_REQUIRED");
  invariant(/^\d{5,80}$/.test(id), "COMMENT_ID_INVALID");
  return {
    commentId: id,
    eventId: `SCE-IG-COMMENT-${id}`,
    workItemId: `WORK-IG-COMMENT-${id}`
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function equivalent(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function same(left, right, code) {
  invariant(equivalent(left, right), code);
}

function normalizeTarget(input) {
  const ids = deriveHeartbeatIds(input.commentId);
  const birdieId = required(input.birdieId, "BIRDIE_ID_REQUIRED");
  invariant(/^BIRDIE-[A-Z0-9-]{1,72}$/.test(birdieId), "BIRDIE_ID_INVALID");
  const instagramHandle = normalizeHandle(input.instagramHandle);
  const notBefore = exactDate(input.notBefore, "NOT_BEFORE_INVALID");
  return { ...ids, birdieId, instagramHandle, notBefore };
}

function validateGateReceipt(receipt, target) {
  invariant(receipt && typeof receipt === "object", "GATE_RECEIPT_REQUIRED");
  invariant(receipt.schemaVersion === "birdie-instagram-comment-gate/v1", "GATE_SCHEMA_INVALID");

  const producer = receipt.producer || {};
  invariant(producer.attested === true, "PRODUCER_ATTESTATION_REQUIRED");
  same(
    {
      commentId: String(producer.commentId ?? ""),
      eventId: producer.eventId,
      workItemId: producer.workItemId,
      sourceReference: String(producer.sourceReference ?? ""),
      instagramHandle: normalizeHandle(producer.instagramHandle)
    },
    {
      commentId: target.commentId,
      eventId: target.eventId,
      workItemId: target.workItemId,
      sourceReference: target.commentId,
      instagramHandle: target.instagramHandle
    },
    "PRODUCER_TARGET_MISMATCH"
  );
  invariant(
    exactDate(producer.createdAt, "PRODUCER_CREATED_AT_INVALID").time >= target.notBefore.time,
    "PRODUCER_EVENT_NOT_FRESH"
  );

  const workItem = receipt.workItem || {};
  invariant(workItem.attested === true, "WORK_ITEM_ATTESTATION_REQUIRED");
  same(
    {
      workItemId: workItem.workItemId,
      syncEventId: workItem.syncEventId,
      sourceType: workItem.sourceType,
      eventType: workItem.eventType,
      actionCode: workItem.actionCode,
      sourceReference: String(workItem.sourceReference ?? ""),
      externalUserId: normalizeHandle(workItem.externalUserId),
      resolutionStatus: workItem.resolutionStatus
    },
    {
      workItemId: target.workItemId,
      syncEventId: target.eventId,
      sourceType: "INSTAGRAM",
      eventType: "IG_COMMENT",
      actionCode: "IG_COMMENT",
      sourceReference: target.commentId,
      externalUserId: target.instagramHandle,
      resolutionStatus: "IDENTITY_PENDING"
    },
    "WORK_ITEM_TARGET_MISMATCH"
  );

  const catalog = receipt.catalog || {};
  invariant(catalog.attested === true, "CATALOG_ATTESTATION_REQUIRED");
  same(
    {
      actionCode: catalog.actionCode,
      defaultCoins: Number(catalog.defaultCoins),
      accountType: catalog.accountType,
      sourceTypes: catalog.sourceTypes,
      approvalMode: catalog.approvalMode,
      frequencyRule: catalog.frequencyRule,
      status: catalog.status
    },
    {
      actionCode: "IG_COMMENT",
      defaultCoins: 1,
      accountType: "PRIVATE",
      sourceTypes: "INSTAGRAM",
      approvalMode: "MANUAL_APPROVAL",
      frequencyRule: "PER_DISTINCT_COMMENT",
      status: "ACTIVE"
    },
    "CATALOG_CONTRACT_INVALID"
  );
  invariant(
    exactDate(catalog.freshReadAt, "CATALOG_READ_AT_INVALID").time >= target.notBefore.time,
    "CATALOG_READ_NOT_FRESH"
  );

  const owner = receipt.owner || {};
  invariant(owner.confirmed === true, "OWNER_CONFIRMATION_REQUIRED");
  same(
    {
      birdieId: owner.birdieId,
      instagramHandle: normalizeHandle(owner.instagramHandle)
    },
    { birdieId: target.birdieId, instagramHandle: target.instagramHandle },
    "OWNER_TARGET_MISMATCH"
  );

  return digest(receipt);
}

function ledgerBalances(balances) {
  invariant(balances && typeof balances === "object", "LEDGER_BALANCES_REQUIRED");
  const result = {};
  for (const field of ["confirmed", "reserved", "available", "lifetime"]) {
    invariant(
      Number.isSafeInteger(balances[field]),
      `LEDGER_BALANCE_${field.toUpperCase()}_INVALID`
    );
    result[field] = balances[field];
  }
  invariant(result.reserved >= 0, "LEDGER_RESERVED_NEGATIVE");
  invariant(result.lifetime >= 0, "LEDGER_LIFETIME_NEGATIVE");
  invariant(
    result.available === result.confirmed - result.reserved,
    "LEDGER_AVAILABLE_BALANCE_INVALID"
  );
  return result;
}

function ledgerSnapshot(ledger, expectedBirdieId) {
  invariant(ledger && typeof ledger === "object", "LEDGER_REQUIRED");
  const birdieId = required(ledger.birdieId, "LEDGER_BIRDIE_ID_REQUIRED");
  invariant(birdieId === expectedBirdieId, "LEDGER_BIRDIE_ID_MISMATCH");
  invariant(Array.isArray(ledger.transactions), "LEDGER_TRANSACTIONS_REQUIRED");
  const transactions = ledger.transactions
    .map((row) => {
      invariant(row && typeof row === "object", "LEDGER_TRANSACTION_INVALID");
      return {
        ...row,
        transactionId: required(row.transactionId, "TRANSACTION_ID_MISSING")
      };
    })
    .sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId)
    );
  const transactionIds = transactions.map((row) => row.transactionId);
  invariant(new Set(transactionIds).size === transactionIds.length, "DUPLICATE_TRANSACTION_ID");
  return {
    birdieId,
    balances: ledgerBalances(ledger.balances),
    transactionIds,
    transactions,
    transactionsSha256: digest(transactions)
  };
}

function publicLedgerSnapshot(ledger) {
  return {
    birdieId: ledger.birdieId,
    balances: ledger.balances,
    transactionIds: ledger.transactionIds,
    transactionsSha256: ledger.transactionsSha256
  };
}

function receiptLedgerSnapshot(ledger, expectedBirdieId) {
  invariant(ledger && typeof ledger === "object", "RECEIPT_LEDGER_REQUIRED");
  const birdieId = required(ledger.birdieId, "RECEIPT_LEDGER_BIRDIE_ID_REQUIRED");
  invariant(birdieId === expectedBirdieId, "RECEIPT_LEDGER_BIRDIE_ID_MISMATCH");
  invariant(Array.isArray(ledger.transactionIds), "RECEIPT_TRANSACTION_IDS_REQUIRED");
  const transactionIds = ledger.transactionIds.map((transactionId) =>
    required(transactionId, "RECEIPT_TRANSACTION_ID_MISSING")
  ).sort();
  invariant(
    new Set(transactionIds).size === transactionIds.length,
    "RECEIPT_DUPLICATE_TRANSACTION_ID"
  );
  const transactionsSha256 = required(
    ledger.transactionsSha256,
    "RECEIPT_TRANSACTIONS_SHA256_REQUIRED"
  );
  invariant(/^[0-9a-f]{64}$/.test(transactionsSha256), "RECEIPT_TRANSACTIONS_SHA256_INVALID");
  return {
    birdieId,
    balances: ledgerBalances(ledger.balances),
    transactionIds,
    transactionsSha256
  };
}

function validateSourceConfig(config) {
  const rule = config?.actions?.IG_COMMENT;
  same(rule, {
    accountTypes: ["PRIVATE"],
    points: 1,
    sourceTypes: ["INSTAGRAM"],
    approvalMode: "MANUAL_APPROVAL",
    frequencyRule: "PER_DISTINCT_COMMENT",
    version: "V1",
    status: "ACTIVE",
    rolloutMode: "CONTROLLED_E2E"
  }, "SOURCE_IG_COMMENT_RULE_INVALID");
}

function validateProfile(profile, target, { linked = false } = {}) {
  invariant(profile?.birdieId === target.birdieId, "PROFILE_BIRDIE_ID_MISMATCH");
  invariant(profile?.status === "ACTIVE", "PROFILE_NOT_ACTIVE");
  invariant(profile?.accountType === "PRIVATE", "PROFILE_NOT_PRIVATE");
  const handle = String(profile?.instagramHandle ?? "").trim();
  if (linked) invariant(normalizeHandle(handle) === target.instagramHandle, "PROFILE_HANDLE_NOT_LINKED");
  else if (handle) invariant(normalizeHandle(handle) === target.instagramHandle, "PROFILE_HANDLE_CONFLICT");
}

function validateEventBeforeCoinWrite(result, target, { requireResolved = false } = {}) {
  const event = result?.event;
  invariant(event?.eventId === target.eventId, "EVENT_ID_MISMATCH");
  invariant(String(event?.platform ?? "").toUpperCase() === "INSTAGRAM", "EVENT_PLATFORM_INVALID");
  invariant(event?.eventType === "IG_COMMENT", "EVENT_TYPE_INVALID");
  invariant(normalizeHandle(event?.instagramHandle) === target.instagramHandle, "EVENT_HANDLE_MISMATCH");
  invariant(String(event?.sourceReference ?? "") === target.commentId, "EVENT_SOURCE_MISMATCH");
  invariant(Number(event?.points) === 1, "EVENT_POINTS_INVALID");
  invariant(event?.coinWriteStatus === "NOT_WRITTEN", "EVENT_ALREADY_WRITTEN");
  const verificationStatus = String(event?.verificationStatus ?? "");
  const eventBirdieId = String(event?.birdieId ?? "").trim();
  if (verificationStatus === "IDENTITY_PENDING") {
    invariant(!requireResolved, "EVENT_IDENTITY_NOT_RESOLVED");
    invariant(!eventBirdieId, "PENDING_EVENT_ALREADY_BOUND");
  } else if (verificationStatus === "IDENTITY_RESOLVED") {
    invariant(eventBirdieId === target.birdieId, "EVENT_BIRDIE_ID_MISMATCH");
    required(event?.verifiedAt, "EVENT_VERIFIED_AT_MISSING");
  } else {
    throw new Error("EVENT_IDENTITY_STATE_INVALID");
  }
  invariant(
    exactDate(event?.createdAt, "EVENT_CREATED_AT_INVALID").time >= target.notBefore.time,
    "EVENT_NOT_FRESH"
  );
  return event;
}

export function createHeartbeatClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const base = required(baseUrl, "BIRDIE_AGENT_URL_REQUIRED").replace(/\/$/, "");
  invariant(/^https:\/\//.test(base), "BIRDIE_AGENT_URL_MUST_BE_HTTPS");
  const key = required(apiKey, "BIRDIE_AGENT_API_KEY_REQUIRED");

  async function request(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`NON_JSON_RESPONSE:${path}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}:${parsed?.error || path}`);
    }
    invariant(
      parsed && typeof parsed === "object" && parsed.success === true,
      `SUCCESS_ENVELOPE_REQUIRED:${path}`
    );
    if (path.startsWith("/coin/")) {
      invariant(parsed.authoritative === true, `AUTHORITATIVE_COIN_RESPONSE_REQUIRED:${path}`);
    }
    invariant(
      Object.prototype.hasOwnProperty.call(parsed, "data"),
      `RESPONSE_DATA_REQUIRED:${path}`
    );
    return parsed?.data;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body)
  };
}

export async function runHeartbeatPreflight({ client, input, gateReceipt }) {
  const target = normalizeTarget(input);
  const gateReceiptSha256 = validateGateReceipt(gateReceipt, target);
  const config = await client.get("/coin/config");
  validateSourceConfig(config);
  const profile = await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}`);
  validateProfile(profile, target);
  const ledger = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  const eventResult = await client.get(`/coin/social-events/${encodeURIComponent(target.eventId)}`);
  const event = validateEventBeforeCoinWrite(eventResult, target);
  return { target, gateReceiptSha256, profile, ledger, event };
}

function profileLinkBody(target) {
  return {
    instagramHandle: target.instagramHandle,
    idempotencyKey: `task124:profile-instagram:${target.birdieId}:${target.instagramHandle}`
  };
}

function bindBody(target) {
  return {
    workItemId: target.workItemId,
    birdieId: target.birdieId,
    confirmation: "BIND_IG_COMMENT_IDENTITY"
  };
}

function claimBody(target) {
  return {
    workItemId: target.workItemId,
    birdieId: target.birdieId,
    confirmation: "CREATE_IG_COMMENT_CLAIM"
  };
}

function validateResolution(resolution, target) {
  if (resolution?.processed === false) {
    invariant(resolution?.reason === "WORK_ITEM_NOT_ELIGIBLE", "RESOLUTION_NOOP_INVALID");
    return;
  }
  invariant(resolution?.processed === true, "RESOLUTION_NOT_PROCESSED");
  same(
    {
      resolutionStatus: resolution?.resolution?.resolutionStatus,
      matchedBirdieId: resolution?.resolution?.matchedBirdieId,
      identityConfidence: Number(resolution?.resolution?.identityConfidence),
      identityDecisionMode: resolution?.resolution?.identityDecisionMode
    },
    {
      resolutionStatus: "IDENTITY_RESOLVED",
      matchedBirdieId: target.birdieId,
      identityConfidence: 100,
      identityDecisionMode: "AUTO_EXACT_LINK"
    },
    "RESOLUTION_NOT_EXACT"
  );
}

function extractClaim(result) {
  return result?.claim || result;
}

function validateClaim(claim, target, allowedStatuses = ["PENDING"]) {
  invariant(claim?.claimId, "CLAIM_ID_MISSING");
  invariant(claim?.birdieId === target.birdieId, "CLAIM_BIRDIE_ID_MISMATCH");
  invariant(claim?.actionCode === "IG_COMMENT", "CLAIM_ACTION_INVALID");
  invariant(claim?.sourceType === "INSTAGRAM", "CLAIM_SOURCE_TYPE_INVALID");
  invariant(String(claim?.sourceReference ?? "") === target.commentId, "CLAIM_SOURCE_MISMATCH");
  invariant(allowedStatuses.includes(claim?.status), "CLAIM_STATUS_INVALID");
  return claim;
}

export async function runHeartbeatPrepare({ client, input, gateReceipt }) {
  const preflight = await runHeartbeatPreflight({ client, input, gateReceipt });
  const { target } = preflight;
  const linked = await client.post(
    `/coin/profiles/${encodeURIComponent(target.birdieId)}/instagram`,
    profileLinkBody(target)
  );
  validateProfile(linked?.profile, target, { linked: true });
  validateProfile(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}`),
    target,
    { linked: true }
  );
  const ledgerAfterLink = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  same(publicLedgerSnapshot(ledgerAfterLink), publicLedgerSnapshot(preflight.ledger), "PROFILE_LINK_CHANGED_LEDGER");

  const resolution = await client.post("/community/identity/resolve", {
    workItemId: target.workItemId
  });
  validateResolution(resolution, target);
  const bound = await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/identity`,
    bindBody(target)
  );
  validateEventBeforeCoinWrite(bound, target, { requireResolved: true });

  const claim = validateClaim(extractClaim(await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/claim`,
    claimBody(target)
  )), target);
  const ledgerAfterClaim = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  same(publicLedgerSnapshot(ledgerAfterClaim), publicLedgerSnapshot(preflight.ledger), "PENDING_CLAIM_CHANGED_LEDGER");

  return {
    schemaVersion: PREPARE_SCHEMA,
    status: "PENDING_CLAIM_READY_FOR_EXACT_FOUNDER_APPROVAL",
    target: {
      commentId: target.commentId,
      eventId: target.eventId,
      workItemId: target.workItemId,
      birdieId: target.birdieId,
      instagramHandle: target.instagramHandle,
      notBefore: target.notBefore.input
    },
    claimId: claim.claimId,
    gateReceiptSha256: preflight.gateReceiptSha256,
    baselineLedger: publicLedgerSnapshot(preflight.ledger),
    preApprovalLedger: publicLedgerSnapshot(ledgerAfterClaim),
    confirmationRequired: "APPROVE_IG_COMMENT_CLAIM",
    authenticatedKeyIncluded: false
  };
}

function validatePrepareReceipt(receipt, input, gateReceipt) {
  invariant(receipt?.schemaVersion === PREPARE_SCHEMA, "PREPARE_RECEIPT_SCHEMA_INVALID");
  invariant(receipt?.status === "PENDING_CLAIM_READY_FOR_EXACT_FOUNDER_APPROVAL", "PREPARE_RECEIPT_STATUS_INVALID");
  const target = normalizeTarget(receipt.target || {});
  if (input.commentId !== undefined) invariant(String(input.commentId) === target.commentId, "APPROVAL_COMMENT_ID_MISMATCH");
  if (input.birdieId !== undefined) invariant(String(input.birdieId) === target.birdieId, "APPROVAL_BIRDIE_ID_MISMATCH");
  if (input.instagramHandle !== undefined) invariant(normalizeHandle(input.instagramHandle) === target.instagramHandle, "APPROVAL_HANDLE_MISMATCH");
  invariant(required(input.expectedClaimId, "EXPECTED_CLAIM_ID_REQUIRED") === receipt.claimId, "APPROVAL_CLAIM_ID_MISMATCH");
  invariant(input.confirmation === "APPROVE_IG_COMMENT_CLAIM", "EXACT_APPROVAL_CONFIRMATION_REQUIRED");
  const gateReceiptSha256 = validateGateReceipt(gateReceipt, target);
  invariant(
    required(receipt.gateReceiptSha256, "PREPARE_GATE_RECEIPT_SHA256_REQUIRED") === gateReceiptSha256,
    "GATE_RECEIPT_DIGEST_MISMATCH"
  );
  const baseline = receiptLedgerSnapshot(receipt.baselineLedger, target.birdieId);
  const preApproval = receiptLedgerSnapshot(receipt.preApprovalLedger, target.birdieId);
  same(baseline, preApproval, "PREPARE_RECEIPT_LEDGER_DRIFT");
  return { target, claimId: receipt.claimId, baseline };
}

function baselineWithCurrentRows(baseline, current) {
  const baselineIds = new Set(baseline.transactionIds);
  const transactions = current.transactions.filter((row) => baselineIds.has(row.transactionId));
  invariant(transactions.length === baseline.transactionIds.length, "BASELINE_TRANSACTION_MISSING");
  invariant(
    digest(transactions) === baseline.transactionsSha256,
    "BASELINE_TRANSACTION_HISTORY_CHANGED"
  );
  return { ...baseline, transactions };
}

function validateApprovedLedger(before, after, target, claimId) {
  const newIds = after.transactionIds.filter((id) => !before.transactionIds.includes(id));
  invariant(newIds.length === 1, "APPROVAL_MUST_CREATE_EXACTLY_ONE_TRANSACTION");
  invariant(after.transactionIds.length === before.transactionIds.length + 1, "TRANSACTION_SET_DELTA_INVALID");
  const transaction = after.transactions.find((row) => row.transactionId === newIds[0]);
  same(
    {
      birdieId: transaction?.birdieId,
      amount: Number(transaction?.amount),
      transactionType: transaction?.transactionType,
      actionCode: transaction?.actionCode,
      sourceType: transaction?.sourceType,
      sourceReference: String(transaction?.sourceReference ?? ""),
      status: transaction?.status,
      idempotencyKey: transaction?.idempotencyKey
    },
    {
      birdieId: target.birdieId,
      amount: 1,
      transactionType: "EARN",
      actionCode: "IG_COMMENT",
      sourceType: "INSTAGRAM",
      sourceReference: target.commentId,
      status: "APPROVED",
      idempotencyKey: `claim:${claimId}`
    },
    "APPROVED_TRANSACTION_INVALID"
  );
  same(after.balances, {
    confirmed: before.balances.confirmed + 1,
    reserved: before.balances.reserved,
    available: before.balances.available + 1,
    lifetime: before.balances.lifetime + 1
  }, "APPROVED_BALANCE_DELTA_INVALID");
  return transaction;
}

async function replayAndProve({ client, target, claimId, expectedLedger }) {
  await client.post(
    `/coin/profiles/${encodeURIComponent(target.birdieId)}/instagram`,
    profileLinkBody(target)
  );
  const resolution = await client.post("/community/identity/resolve", { workItemId: target.workItemId });
  invariant(
    resolution?.processed === false && resolution?.reason === "WORK_ITEM_NOT_ELIGIBLE",
    "REPLAY_RESOLVER_NOT_NOOP"
  );
  await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/identity`,
    bindBody(target)
  );
  const replayClaim = validateClaim(extractClaim(await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/claim`,
    claimBody(target)
  )), target, ["APPROVED"]);
  invariant(replayClaim.claimId === claimId, "REPLAY_CLAIM_ID_DRIFT");
  await client.post(`/coin/claims/${encodeURIComponent(claimId)}/decision`, {
    decision: "APPROVE",
    eventId: target.eventId,
    workItemId: target.workItemId,
    birdieId: target.birdieId,
    confirmation: "APPROVE_IG_COMMENT_CLAIM",
    reason: "Controlled TASK-124 heartbeat",
    actor: "Birdie TASK-124 One-Shot",
    idempotencyKey: `task124:approve:${claimId}`
  });
  const written = await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/written`,
    {
      workItemId: target.workItemId,
      birdieId: target.birdieId,
      claimId,
      confirmation: "MARK_IG_COMMENT_WRITTEN"
    }
  );
  invariant(written?.event?.coinWriteStatus === "WRITTEN", "REPLAY_EVENT_NOT_WRITTEN");
  const replayLedger = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  same(publicLedgerSnapshot(replayLedger), publicLedgerSnapshot(expectedLedger), "REPLAY_CHANGED_LEDGER");
}

export async function runHeartbeatApprove({ client, input, prepareReceipt, gateReceipt }) {
  const { target, claimId, baseline } = validatePrepareReceipt(
    prepareReceipt,
    input,
    gateReceipt
  );
  const claim = validateClaim(extractClaim(await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/claim`,
    claimBody(target)
  )), target, ["PENDING", "APPROVED"]);
  invariant(claim.claimId === claimId, "CLAIM_READBACK_ID_MISMATCH");

  const ledgerBeforeDecision = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  const isUnchangedBaseline = equivalent(
    publicLedgerSnapshot(ledgerBeforeDecision),
    baseline
  );
  if (!isUnchangedBaseline) {
    validateApprovedLedger(
      baselineWithCurrentRows(baseline, ledgerBeforeDecision),
      ledgerBeforeDecision,
      target,
      claimId
    );
  }
  if (claim.status === "APPROVED") {
    invariant(!isUnchangedBaseline, "APPROVED_CLAIM_LEDGER_MISSING");
    invariant(Number(claim.approvedAmount) === 1, "APPROVED_AMOUNT_INVALID");
  }

  const decision = extractClaim(await client.post(`/coin/claims/${encodeURIComponent(claimId)}/decision`, {
    decision: "APPROVE",
    eventId: target.eventId,
    workItemId: target.workItemId,
    birdieId: target.birdieId,
    confirmation: "APPROVE_IG_COMMENT_CLAIM",
    reason: "Controlled TASK-124 heartbeat",
    actor: "Birdie TASK-124 One-Shot",
    idempotencyKey: `task124:approve:${claimId}`
  }));
  validateClaim(decision, target, ["APPROVED"]);
  invariant(Number(decision.approvedAmount) === 1, "APPROVED_AMOUNT_INVALID");

  const approvedLedger = ledgerSnapshot(
    await client.get(`/coin/profiles/${encodeURIComponent(target.birdieId)}/ledger`),
    target.birdieId
  );
  const transaction = validateApprovedLedger(
    baselineWithCurrentRows(baseline, approvedLedger),
    approvedLedger,
    target,
    claimId
  );

  const written = await client.post(
    `/coin/social-events/${encodeURIComponent(target.eventId)}/instagram-comment/written`,
    {
      workItemId: target.workItemId,
      birdieId: target.birdieId,
      claimId,
      confirmation: "MARK_IG_COMMENT_WRITTEN"
    }
  );
  invariant(written?.event?.coinWriteStatus === "WRITTEN", "EVENT_NOT_WRITTEN");
  invariant(written?.event?.birdieId === target.birdieId, "WRITTEN_EVENT_BIRDIE_ID_MISMATCH");
  invariant(written?.transaction?.transactionId === transaction.transactionId, "WRITTEN_TRANSACTION_MISMATCH");
  const eventReadback = await client.get(`/coin/social-events/${encodeURIComponent(target.eventId)}`);
  invariant(eventReadback?.event?.coinWriteStatus === "WRITTEN", "EVENT_READBACK_NOT_WRITTEN");

  await replayAndProve({ client, target, claimId, expectedLedger: approvedLedger });

  return {
    schemaVersion: FINAL_SCHEMA,
    status: "DOWNSTREAM_COIN_REPLAY_VERIFIED_PRODUCER_REPLAY_PENDING",
    target: prepareReceipt.target,
    claimId,
    transactionId: transaction.transactionId,
    before: baseline,
    after: publicLedgerSnapshot(approvedLedger),
    replayCreatedTransactions: 0,
    coinShopReadback: "REQUIRED_SEPARATE_CANONICAL_RECEIPT",
    authenticatedKeyIncluded: false
  };
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const values = { mode };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    invariant(flag?.startsWith("--") && rest[index + 1] !== undefined, `INVALID_ARGUMENT:${flag || "missing"}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    invariant(!["amount", "points", "action", "source", "approvedAmount"].includes(key), `FORBIDDEN_ARGUMENT:${flag}`);
    values[key] = rest[index + 1];
  }
  invariant(["preflight", "prepare", "approve"].includes(mode), "MODE_MUST_BE_PREFLIGHT_PREPARE_OR_APPROVE");
  return values;
}

function jsonFile(path, code) {
  const file = required(path, code);
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const client = createHeartbeatClient({
    baseUrl: env.BIRDIE_AGENT_URL,
    apiKey: env.BIRDIE_AGENT_API_KEY
  });
  if (args.mode === "approve") {
    return runHeartbeatApprove({
      client,
      input: args,
      prepareReceipt: jsonFile(args.prepareReceipt, "PREPARE_RECEIPT_PATH_REQUIRED"),
      gateReceipt: jsonFile(args.gateReceipt, "GATE_RECEIPT_PATH_REQUIRED")
    });
  }
  const gateReceipt = jsonFile(args.gateReceipt, "GATE_RECEIPT_PATH_REQUIRED");
  if (args.mode === "prepare") {
    return runHeartbeatPrepare({ client, input: args, gateReceipt });
  }
  const result = await runHeartbeatPreflight({ client, input: args, gateReceipt });
  return {
    schemaVersion: "birdie-instagram-comment-heartbeat/preflight-v1",
    status: "PREFLIGHT_PASS_ZERO_WRITES",
    target: {
      commentId: result.target.commentId,
      eventId: result.target.eventId,
      workItemId: result.target.workItemId,
      birdieId: result.target.birdieId,
      instagramHandle: result.target.instagramHandle,
      notBefore: result.target.notBefore.input
    },
    gateReceiptSha256: result.gateReceiptSha256,
    ledger: publicLedgerSnapshot(result.ledger),
    authenticatedKeyIncluded: false
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main()
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`HEARTBEAT_BLOCKED:${error.message}\n`);
      process.exitCode = 1;
    });
}
