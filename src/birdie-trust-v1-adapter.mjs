import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign
} from "node:crypto";

export const BIRDIE_TRUST_V1 = "birdie.trust/v1";

export class BirdieTrustAdapterError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "BirdieTrustAdapterError";
    this.code = code;
    this.status = status;
  }
}

export class BirdieTrustResponseLost extends Error {
  constructor() {
    super("Simulated response loss after the server transaction committed.");
    this.name = "BirdieTrustResponseLost";
    this.code = "RESPONSE_LOST";
  }
}

const opaque = (value, label) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new BirdieTrustAdapterError("INVALID_CONTRACT", `${label} is not opaque`, 400);
  }
  return value;
};

const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("base64url");
const nonce = () => randomBytes(32).toString("base64url");
const nowDate = (clock) => new Date(clock());
const utcSecond = (date) => new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
const clone = (value) => structuredClone(value);

// Trust-v1 signs the RFC8785/JCS domain. The adapter only accepts JSON values
// permitted by the contract and rejects unsafe/non-integral numbers.
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new BirdieTrustAdapterError("INVALID_CONTRACT", "Unsafe canonical number", 400);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new BirdieTrustAdapterError("INVALID_CONTRACT", "Unsupported canonical value", 400);
}

function makeReceipt({ request, requestDigest = digest(request), recordVersion, decision, outcome, auditSequence, signingKey, keyId, clock, kind = "approval" }) {
  const recordedAt = utcSecond(nowDate(clock));
  const receipt = kind === "mission"
    ? {
        contractVersion: BIRDIE_TRUST_V1,
        receiptId: `receipt-${randomUUID()}`,
        commandId: request.commandId,
        missionId: request.missionId,
        recordVersion,
        command: decision,
        outcome,
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        recordedAt,
        auditEventId: `audit-${randomUUID()}`,
        auditSequence,
        auditHeadHash: digest({ requestDigest, auditSequence }),
        serverSignature: null
      }
    : {
        contractVersion: BIRDIE_TRUST_V1,
        receiptId: `receipt-${randomUUID()}`,
        decisionId: request.decisionId,
        approvalId: request.approvalId,
        recordVersion,
        decision,
        outcome,
        executionState: decision === "approve" ? "pending" : "not_applicable",
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        recordedAt,
        auditEventId: `audit-${randomUUID()}`,
        auditSequence,
        auditHeadHash: digest({ requestDigest, auditSequence }),
        serverSignature: null
      };
  const signingPayload = { ...receipt };
  delete signingPayload.serverSignature;
  const signature = sign(null, Buffer.from(canonicalJson(signingPayload)), signingKey).toString("base64url");
  receipt.serverSignature = {
    format: "raw-ed25519-jcs",
    algorithm: "EdDSA",
    keyId,
    canonicalization: "RFC8785",
    signature,
    signedAt: recordedAt
  };
  return receipt;
}

function requireVersion(value) {
  if (value !== BIRDIE_TRUST_V1) throw new BirdieTrustAdapterError("INVALID_CONTRACT", "Unsupported Trust-v1 version", 400);
}

export function createBirdieTrustV1LocalAdapter({
  allowLocalMock = false,
  now = () => Date.now(),
  approvals = [],
  missions = [],
  dropNextResponse = false
} = {}) {
  if (!allowLocalMock) {
    throw new BirdieTrustAdapterError(
      "PRODUCTION_ADAPTER_NOT_CONFIGURED",
      "The Trust-v1 local adapter requires explicit allowLocalMock=true",
      500
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const publicRaw = publicDer.subarray(publicDer.length - 32);
  const keyId = "local-ed25519-v1";
  const state = {
    approvals: new Map(approvals.map((item) => [item.approvalId, clone(item)])),
    missions: new Map(missions.map((item) => [item.missionId, clone(item)])),
    approvalChallenges: new Map(),
    missionChallenges: new Map(),
    registrationChallenges: new Map(),
    receiptsByIdempotency: new Map(),
    registrationAcks: new Map(),
    auditSequence: 0,
    dropNextResponse
  };

  const maybeDrop = () => {
    if (state.dropNextResponse) {
      state.dropNextResponse = false;
      throw new BirdieTrustResponseLost();
    }
  };

  function createRegistrationChallenge(request) {
    requireVersion(request.contractVersion);
    opaque(request.registrationId, "registrationId");
    opaque(request.idempotencyKey, "idempotencyKey");
    if (state.registrationChallenges.has(request.idempotencyKey)) {
      const existing = state.registrationChallenges.get(request.idempotencyKey);
      if (digest(existing.request) !== digest(request)) throw new BirdieTrustAdapterError("IDEMPOTENCY_CONFLICT", "Registration challenge key reused", 409);
      return clone(existing.challenge);
    }
    const issuedAt = nowDate(now);
    const challenge = {
      contractVersion: BIRDIE_TRUST_V1,
      registrationId: request.registrationId,
      challengeId: `registration-challenge-${randomUUID()}`,
      idempotencyKey: request.idempotencyKey,
      keyId: request.keyId,
      nonce: nonce(),
      issuedAt: utcSecond(issuedAt),
      expiresAt: utcSecond(new Date(issuedAt.getTime() + 90_000)),
      maxAttempts: 1,
      consumed: false
    };
    state.registrationChallenges.set(request.idempotencyKey, { request: clone(request), challenge });
    return clone(challenge);
  }

  function registerAppAttestKey(request) {
    requireVersion(request.contractVersion);
    opaque(request.registrationId, "registrationId");
    opaque(request.challengeId, "challengeId");
    opaque(request.idempotencyKey, "idempotencyKey");
    if (state.registrationAcks.has(request.idempotencyKey)) {
      const cached = state.registrationAcks.get(request.idempotencyKey);
      if (cached.requestDigest !== digest(request)) throw new BirdieTrustAdapterError("IDEMPOTENCY_CONFLICT", "Registration key reused", 409);
      return clone(cached.ack);
    }
    const record = state.registrationChallenges.get(request.idempotencyKey);
    if (!record || record.challenge.challengeId !== request.challengeId || record.challenge.nonce !== request.nonce) {
      throw new BirdieTrustAdapterError("INVALID_CHALLENGE", "Registration is not bound to its challenge", 409);
    }
    const registeredAt = utcSecond(nowDate(now));
    const ack = {
      contractVersion: BIRDIE_TRUST_V1,
      acknowledgementId: `registration-ack-${randomUUID()}`,
      registrationId: request.registrationId,
      deviceBindingId: `local-device-binding-${randomUUID()}`,
      keyId: request.keyId,
      registeredAt,
      serverSignature: null
    };
    const signingPayload = { ...ack };
    delete signingPayload.serverSignature;
    ack.serverSignature = {
      format: "raw-ed25519-jcs",
      algorithm: "EdDSA",
      keyId,
      canonicalization: "RFC8785",
      signature: sign(null, Buffer.from(canonicalJson(signingPayload)), privateKey).toString("base64url"),
      signedAt: registeredAt
    };
    state.registrationAcks.set(request.idempotencyKey, { requestDigest: digest(request), ack });
    maybeDrop();
    return clone(ack);
  }

  function createApprovalChallenge(request) {
    requireVersion(request.contractVersion);
    const approval = state.approvals.get(request.approvalId);
    if (!approval) throw new BirdieTrustAdapterError("NOT_FOUND", "Approval not found", 404);
    if (approval.recordVersion !== request.recordVersion || approval.status !== "pending") throw new BirdieTrustAdapterError("VERSION_CONFLICT", "Approval is stale", 409);
    if (state.approvalChallenges.has(request.idempotencyKey)) return clone(state.approvalChallenges.get(request.idempotencyKey));
    const issuedAt = nowDate(now);
    const challenge = {
      contractVersion: BIRDIE_TRUST_V1,
      challengeId: `approval-challenge-${randomUUID()}`,
      resourceType: "approval",
      resourceId: request.approvalId,
      recordVersion: request.recordVersion,
      idempotencyKey: request.idempotencyKey,
      actionDigest: request.actionDigest,
      nonce: nonce(),
      deviceBindingId: request.deviceBindingId,
      issuedAt: utcSecond(issuedAt),
      expiresAt: utcSecond(new Date(issuedAt.getTime() + 90_000)),
      maxAttempts: 1,
      consumed: false
    };
    state.approvalChallenges.set(request.idempotencyKey, challenge);
    return clone(challenge);
  }

  function submitApprovalDecision(request) {
    requireVersion(request.contractVersion);
    const requestDigest = digest(request);
    const cached = state.receiptsByIdempotency.get(request.idempotencyKey);
    if (cached) {
      if (cached.requestDigest !== requestDigest) throw new BirdieTrustAdapterError("IDEMPOTENCY_CONFLICT", "Decision key reused with different payload", 409);
      return clone(cached.receipt);
    }
    const challenge = state.approvalChallenges.get(request.idempotencyKey);
    const approval = state.approvals.get(request.approvalId);
    if (!challenge || !approval || challenge.challengeId !== request.challengeId || challenge.nonce !== request.nonce || challenge.actionDigest !== request.actionDigest || approval.recordVersion !== request.recordVersion || approval.status !== "pending") {
      throw new BirdieTrustAdapterError("INVALID_CHALLENGE", "Decision is not atomically bound to approval", 409);
    }
    if (request.localAuthorization?.contextDigest !== request.actionDigest) throw new BirdieTrustAdapterError("LOCAL_AUTH_REQUIRED", "Local authorization context is not bound", 403);
    if (request.deviceAssertion?.provider !== "local_mock_only") throw new BirdieTrustAdapterError("DEVICE_ASSERTION_REQUIRED", "Local adapter accepts only explicit test assertions", 403);
    const nextStatus = request.decision === "approve" ? "approved" : request.decision === "reject" ? "rejected" : "changes_requested";
    const nextVersion = approval.recordVersion + 1;
    const nextAudit = state.auditSequence + 1;
    const receipt = makeReceipt({ request, recordVersion: nextVersion, decision: request.decision, outcome: "accepted", auditSequence: nextAudit, signingKey: privateKey, keyId, clock: now });
    // Single commit point: all fallible validation/signing is complete.
    state.approvals.set(approval.approvalId, { ...approval, recordVersion: nextVersion, status: nextStatus });
    state.auditSequence = nextAudit;
    state.receiptsByIdempotency.set(request.idempotencyKey, { requestDigest, receipt });
    challenge.consumed = true;
    maybeDrop();
    return clone(receipt);
  }

  function lookupDecisionReceipt({ approvalId, decisionId }) {
    for (const { receipt } of state.receiptsByIdempotency.values()) {
      if (receipt.approvalId === approvalId && receipt.decisionId === decisionId) return clone(receipt);
    }
    return null;
  }

  function createMissionChallenge(request) {
    requireVersion(request.contractVersion);
    const mission = state.missions.get(request.missionId);
    if (!mission) throw new BirdieTrustAdapterError("NOT_FOUND", "Mission not found", 404);
    if (mission.recordVersion !== request.recordVersion) throw new BirdieTrustAdapterError("VERSION_CONFLICT", "Mission is stale", 409);
    if (state.missionChallenges.has(request.idempotencyKey)) return clone(state.missionChallenges.get(request.idempotencyKey));
    const issuedAt = nowDate(now);
    const challenge = {
      contractVersion: BIRDIE_TRUST_V1,
      challengeId: `mission-challenge-${randomUUID()}`,
      resourceType: "mission",
      resourceId: request.missionId,
      recordVersion: request.recordVersion,
      idempotencyKey: request.idempotencyKey,
      deviceBindingId: request.deviceBindingId,
      actionDigest: request.actionDigest,
      nonce: nonce(),
      issuedAt: utcSecond(issuedAt),
      expiresAt: utcSecond(new Date(issuedAt.getTime() + 90_000)),
      maxAttempts: 1,
      consumed: false
    };
    state.missionChallenges.set(request.idempotencyKey, challenge);
    return clone(challenge);
  }

  function submitMissionCommand(request) {
    requireVersion(request.contractVersion);
    const requestDigest = digest(request);
    const cached = state.receiptsByIdempotency.get(request.idempotencyKey);
    if (cached) {
      if (cached.requestDigest !== requestDigest) throw new BirdieTrustAdapterError("IDEMPOTENCY_CONFLICT", "Mission key reused with different payload", 409);
      return clone(cached.response);
    }
    const challenge = state.missionChallenges.get(request.idempotencyKey);
    const mission = state.missions.get(request.missionId);
    if (!challenge || !mission || challenge.challengeId !== request.challengeId || challenge.nonce !== request.nonce || challenge.actionDigest !== request.actionDigest || mission.recordVersion !== request.recordVersion) {
      throw new BirdieTrustAdapterError("INVALID_CHALLENGE", "Command is not atomically bound to mission", 409);
    }
    const nextStatus = request.command === "pause" ? "paused" : request.command === "resume" ? "running" : "cancelled";
    const nextVersion = mission.recordVersion + 1;
    const nextAudit = state.auditSequence + 1;
    const receipt = makeReceipt({ request, requestDigest, recordVersion: nextVersion, decision: request.command, outcome: "accepted", auditSequence: nextAudit, signingKey: privateKey, keyId, clock: now, kind: "mission" });
    const updatedMission = { ...mission, recordVersion: nextVersion, status: nextStatus };
    const response = { contractVersion: BIRDIE_TRUST_V1, receipt, mission: updatedMission };
    state.missions.set(mission.missionId, updatedMission);
    state.auditSequence = nextAudit;
    state.receiptsByIdempotency.set(request.idempotencyKey, { requestDigest, response });
    challenge.consumed = true;
    maybeDrop();
    return clone(response);
  }

  return {
    contractVersion: BIRDIE_TRUST_V1,
    createRegistrationChallenge,
    registerAppAttestKey,
    createApprovalChallenge,
    submitApprovalDecision,
    lookupDecisionReceipt,
    createMissionChallenge,
    submitMissionCommand,
    publicVerificationKey: () => ({ keyId, rawRepresentation: Buffer.from(publicRaw) }),
    debugState: () => clone({ approvals: [...state.approvals.values()], missions: [...state.missions.values()], auditSequence: state.auditSequence })
  };
}
