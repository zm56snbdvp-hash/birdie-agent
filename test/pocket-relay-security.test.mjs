import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  POCKET_RELAY_ALLOWLIST,
  POCKET_RELAY_COMMAND_VERSION,
  PocketRelayAction,
  describePocketRelayCommand,
  stableStringify
} from "../src/pocket-relay/contract.mjs";
import {
  base64UrlEncode,
  generateEd25519Identity,
  signEd25519
} from "../src/pocket-relay/crypto.mjs";
import {
  PocketRelaySecurity,
  createTokenProofSigningInput,
  decodeSignedReceipt
} from "../src/pocket-relay/security.mjs";

function fixture() {
  let now = Date.parse("2026-08-28T12:00:00.000Z");
  const identity = generateEd25519Identity();
  const security = new PocketRelaySecurity({
    pairingCode: "mock-pairing-2026",
    clock: () => now
  });
  const pairing = security.pair({
    pairingCode: "mock-pairing-2026",
    deviceName: "Security Test iPhone",
    platform: "ios",
    publicKey: base64UrlEncode(identity.publicKeyRaw)
  });

  function signedCommand({
    action = PocketRelayAction.OPEN_LINK,
    payload = { url: "https://example.com" },
    nonce = base64UrlEncode(randomBytes(24)),
    commandId = randomUUID(),
    idempotencyKey = randomUUID(),
    identityOverride = identity,
    approveHighRisk = false,
    approvedAtOffsetMs = 0
  } = {}) {
    const command = {
      version: POCKET_RELAY_COMMAND_VERSION,
      commandId,
      idempotencyKey,
      deviceId: pairing.deviceId,
      nonce,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      action,
      target: pairing.targetDevice,
      scope: POCKET_RELAY_ALLOWLIST[action].scope,
      payload
    };
    command.disclosure = describePocketRelayCommand(command);
    if (approveHighRisk) {
      command.approval = {
        method: "explicit_iphone_confirmation",
        commandId,
        approvedAt: new Date(now + approvedAtOffsetMs).toISOString()
      };
    }
    const bytes = Buffer.from(stableStringify(command), "utf8");
    return {
      command,
      body: {
        signedCommand: base64UrlEncode(bytes),
        signature: base64UrlEncode(signEd25519(bytes, identityOverride.privateKey))
      }
    };
  }

  return {
    identity,
    security,
    pairing,
    signedCommand,
    authorization: `Bearer ${pairing.accessToken}`,
    setNow(value) { now = value; },
    getNow() { return now; }
  };
}

function expectCode(code) {
  return (error) => error?.code === code;
}

test("pairing issues a short-lived token bound to the registered device key", () => {
  const f = fixture();
  const verified = f.security.verifySignedCommand({
    authorization: f.authorization,
    body: f.signedCommand().body
  });
  assert.equal(verified.device.deviceId, f.pairing.deviceId);

  const attacker = generateEd25519Identity();
  assert.throws(
    () => f.security.verifySignedCommand({
      authorization: f.authorization,
      body: f.signedCommand({ identityOverride: attacker }).body
    }),
    expectCode("COMMAND_SIGNATURE_INVALID")
  );
});

test("command tampering and nonce reuse for another signed effect are rejected", () => {
  const f = fixture();
  const nonce = base64UrlEncode(randomBytes(24));
  const first = f.signedCommand({ nonce });
  const verified = f.security.verifySignedCommand({ authorization: f.authorization, body: first.body });
  assert.equal(verified.exactReplay, false);
  assert.equal(
    f.security.verifySignedCommand({ authorization: f.authorization, body: first.body }).exactReplay,
    true,
    "an exact transport retry is identified without re-authorizing a new effect"
  );

  const second = f.signedCommand({ nonce });
  assert.throws(
    () => f.security.verifySignedCommand({ authorization: f.authorization, body: second.body }),
    expectCode("COMMAND_NONCE_REPLAY")
  );

  const tampered = { ...first.body, signedCommand: `${first.body.signedCommand.slice(0, -1)}A` };
  assert.throws(
    () => f.security.verifySignedCommand({ authorization: f.authorization, body: tampered }),
    (error) => ["COMMAND_SIGNATURE_INVALID", "COMMAND_JSON_INVALID"].includes(error?.code)
  );
});

test("a commandId is permanently bound to one idempotent effect", () => {
  const f = fixture();
  const commandId = randomUUID();
  const first = f.signedCommand({ commandId });
  f.security.verifySignedCommand({ authorization: f.authorization, body: first.body });
  const conflicting = f.signedCommand({
    commandId,
    payload: { url: "https://example.com/different" }
  });
  assert.throws(
    () => f.security.verifySignedCommand({ authorization: f.authorization, body: conflicting.body }),
    expectCode("COMMAND_ID_CONFLICT")
  );
});

test("device proof refreshes an expired access token once per nonce", () => {
  const f = fixture();
  f.setNow(f.getNow() + 6 * 60_000);
  assert.throws(
    () => f.security.authenticate(f.authorization),
    expectCode("ACCESS_TOKEN_EXPIRED")
  );

  const proof = {
    deviceId: f.pairing.deviceId,
    nonce: base64UrlEncode(randomBytes(24)),
    issuedAt: new Date(f.getNow()).toISOString(),
    expiresAt: new Date(f.getNow() + 60_000).toISOString()
  };
  proof.signature = base64UrlEncode(signEd25519(createTokenProofSigningInput(proof), f.identity.privateKey));
  const refreshed = f.security.refreshToken(proof);
  assert.ok(refreshed.accessToken);
  assert.doesNotThrow(() => f.security.authenticate(`Bearer ${refreshed.accessToken}`));
  assert.throws(() => f.security.refreshToken(proof), expectCode("TOKEN_PROOF_REPLAY"));
});

test("remote revoke and host kill switch fail closed", () => {
  const f = fixture();
  assert.equal(f.security.revokeDevice(f.pairing.deviceId), true);
  assert.throws(() => f.security.authenticate(f.authorization), expectCode("DEVICE_REVOKED"));
  assert.throws(
    () => f.security.pair({
      pairingCode: "mock-pairing-2026",
      deviceName: "Revoked Device",
      platform: "ios",
      publicKey: base64UrlEncode(f.identity.publicKeyRaw)
    }),
    expectCode("DEVICE_REVOKED")
  );

  const enabled = fixture();
  enabled.security.setKillSwitch(true);
  assert.throws(() => enabled.security.authenticate(enabled.authorization), expectCode("RELAY_KILL_SWITCH_ACTIVE"));
  assert.throws(
    () => enabled.security.pair({
      pairingCode: "mock-pairing-2026",
      deviceName: "Other",
      platform: "ios",
      publicKey: base64UrlEncode(generateEd25519Identity().publicKeyRaw)
    }),
    expectCode("RELAY_KILL_SWITCH_ACTIVE")
  );
});

test("effect leases abort on revoke and kill switch and expire before commit", () => {
  const revoked = fixture();
  const revokedVerified = revoked.security.verifySignedCommand({
    authorization: revoked.authorization,
    body: revoked.signedCommand().body
  });
  const revokedLease = revoked.security.createEffectLease(revokedVerified);
  assert.equal(revokedLease.signal.aborted, false);
  revoked.security.revokeDevice(revoked.pairing.deviceId);
  assert.equal(revokedLease.signal.aborted, true);
  assert.throws(() => revokedLease.assertActive(), expectCode("DEVICE_REVOKED"));
  revokedLease.close();

  const colliding = fixture();
  const shared = colliding.signedCommand({ commandId: randomUUID() });
  const firstVerified = colliding.security.verifySignedCommand({
    authorization: colliding.authorization,
    body: shared.body
  });
  const secondVerified = colliding.security.verifySignedCommand({
    authorization: colliding.authorization,
    body: shared.body
  });
  const firstLease = colliding.security.createEffectLease(firstVerified);
  const secondLease = colliding.security.createEffectLease(secondVerified);
  colliding.security.revokeDevice(colliding.pairing.deviceId);
  assert.equal(firstLease.signal.aborted, true);
  assert.equal(secondLease.signal.aborted, true);
  firstLease.close();
  secondLease.close();

  const killed = fixture();
  const killedVerified = killed.security.verifySignedCommand({
    authorization: killed.authorization,
    body: killed.signedCommand().body
  });
  const killedLease = killed.security.createEffectLease(killedVerified);
  killed.security.setKillSwitch(true);
  assert.equal(killedLease.signal.aborted, true);
  assert.throws(() => killedLease.assertActive(), expectCode("RELAY_KILL_SWITCH_ACTIVE"));
  killedLease.close();

  const expired = fixture();
  const expiredVerified = expired.security.verifySignedCommand({
    authorization: expired.authorization,
    body: expired.signedCommand().body
  });
  const expiredLease = expired.security.createEffectLease(expiredVerified);
  expired.setNow(expired.getNow() + 60_000);
  assert.throws(() => expiredLease.assertActive(), expectCode("COMMAND_EFFECT_LEASE_EXPIRED"));
  expiredLease.close();

  const staleApproval = fixture();
  const staleApprovalCommand = staleApproval.signedCommand({
    action: PocketRelayAction.LOCK_PC,
    payload: { confirmation: "LOCK_PC" },
    approveHighRisk: true,
    approvedAtOffsetMs: -149_000
  });
  const staleApprovalVerified = staleApproval.security.verifySignedCommand({
    authorization: staleApproval.authorization,
    body: staleApprovalCommand.body
  });
  const staleApprovalLease = staleApproval.security.createEffectLease(staleApprovalVerified);
  staleApproval.setNow(staleApproval.getNow() + 1_000);
  assert.throws(() => staleApprovalLease.assertActive(), expectCode("IPHONE_APPROVAL_EXPIRED"));
  staleApprovalLease.close();
});

test("low-level audit receipt signature decode is tamper evident", () => {
  const f = fixture();
  const receipt = {
    version: "pocket-relay.audit-receipt.v1",
    commandId: randomUUID(),
    state: "completed"
  };
  const signed = f.security.signReceipt(receipt);
  assert.deepEqual(decodeSignedReceipt(signed, f.security.receiptIdentity.publicKeyRaw), receipt);

  const last = signed.receipt.at(-1);
  const tampered = { ...signed, receipt: `${signed.receipt.slice(0, -1)}${last === "A" ? "B" : "A"}` };
  assert.throws(
    () => decodeSignedReceipt(tampered, f.security.receiptIdentity.publicKeyRaw),
    expectCode("RECEIPT_SIGNATURE_INVALID")
  );
});
