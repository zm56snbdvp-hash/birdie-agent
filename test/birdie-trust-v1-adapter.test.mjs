import assert from "node:assert/strict";
import test from "node:test";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  BIRDIE_TRUST_V1,
  BirdieTrustAdapterError,
  BirdieTrustResponseLost,
  canonicalJson,
  createBirdieTrustV1LocalAdapter
} from "../src/birdie-trust-v1-adapter.mjs";

const id = (prefix) => `${prefix}-${"x".repeat(20)}`;
const baseApproval = () => ({ approvalId: id("approval"), recordVersion: 1, status: "pending" });
const baseMission = () => ({ missionId: id("mission"), recordVersion: 1, status: "running" });
const localAuth = (digest) => ({ success: true, method: "not_required", policy: "low_risk_only", contextDigest: digest });
const assertion = (digest) => ({ provider: "local_mock_only", keyId: id("key"), clientDataHash: digest, assertion: id("assertion") });

test("local adapter is opt-in and canonical JSON rejects unsafe numbers", () => {
  assert.throws(() => createBirdieTrustV1LocalAdapter(), /allowLocalMock/);
  assert.equal(canonicalJson({ z: 1, a: "x" }), '{"a":"x","z":1}');
  assert.throws(() => canonicalJson({ unsafe: Number.MAX_SAFE_INTEGER + 1 }), /Unsafe canonical number/);
});

test("approval decision commits once and exact retry recovers a lost response", () => {
  const approval = baseApproval();
  const adapter = createBirdieTrustV1LocalAdapter({ allowLocalMock: true, approvals: [approval], dropNextResponse: true });
  const actionDigest = "a".repeat(43);
  const challenge = adapter.createApprovalChallenge({
    contractVersion: BIRDIE_TRUST_V1, approvalId: approval.approvalId, recordVersion: 1,
    actionDigest, idempotencyKey: id("decision"), deviceBindingId: id("device")
  });
  const request = {
    contractVersion: BIRDIE_TRUST_V1, decisionId: id("decision-id"), approvalId: approval.approvalId,
    recordVersion: 1, idempotencyKey: challenge.idempotencyKey, challengeId: challenge.challengeId,
    nonce: challenge.nonce, actionDigest, deviceBindingId: challenge.deviceBindingId,
    localAuthorization: localAuth(actionDigest), deviceAssertion: assertion(actionDigest),
    decision: "approve", intent: { decision: "approve" }, clientDecidedAt: challenge.issuedAt
  };
  assert.throws(() => adapter.submitApprovalDecision(request), BirdieTrustResponseLost);
  const receipt = adapter.submitApprovalDecision(request);
  assert.equal(receipt.recordVersion, 2);
  assert.equal(adapter.lookupDecisionReceipt({ approvalId: approval.approvalId, decisionId: request.decisionId }).receiptId, receipt.receiptId);
  assert.equal(adapter.debugState().approvals[0].status, "approved");
  assert.throws(() => adapter.submitApprovalDecision({ ...request, decision: "reject" }), (error) => error instanceof BirdieTrustAdapterError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("mission command is versioned, signed, and idempotent", () => {
  const mission = baseMission();
  const adapter = createBirdieTrustV1LocalAdapter({ allowLocalMock: true, missions: [mission] });
  const challenge = adapter.createMissionChallenge({
    contractVersion: BIRDIE_TRUST_V1, missionId: mission.missionId, recordVersion: 1,
    idempotencyKey: id("mission-command"), deviceBindingId: id("device"), actionDigest: "b".repeat(43), command: "pause"
  });
  const request = {
    contractVersion: BIRDIE_TRUST_V1, commandId: id("command"), missionId: mission.missionId,
    recordVersion: 1, idempotencyKey: challenge.idempotencyKey, challengeId: challenge.challengeId,
    nonce: challenge.nonce, actionDigest: challenge.actionDigest, deviceBindingId: challenge.deviceBindingId,
    command: "pause", localAuthorization: localAuth(challenge.actionDigest), deviceAssertion: assertion(challenge.actionDigest)
  };
  const response = adapter.submitMissionCommand(request);
  assert.equal(response.mission.status, "paused");
  assert.deepEqual(adapter.submitMissionCommand(request), response);
  const key = adapter.publicVerificationKey();
  const payload = { ...response.receipt };
  delete payload.serverSignature;
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.rawRepresentation]),
    format: "der",
    type: "spki"
  });
  assert.equal(verifySignature(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(response.receipt.serverSignature.signature, "base64url")), true);
});
