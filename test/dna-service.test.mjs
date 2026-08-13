import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDnaService } from "../src/dna/service.mjs";

function harness() {
  const calls = [];
  const service = createDnaService({
    async birdieOSPost(payload) {
      calls.push(payload);
      if (payload.action === "dnaGetConfig") {
        return {
          data: {
            evolutionRules: [
              { ruleId: "DNA-TIER-COMMON", tierCode: "COMMON_RARE", threshold: 0, status: "PREPARED" }
            ],
            eventScoringEnabled: false,
            principles: {
              birdieOsAuthoritative: true,
              eventLedgerAuthoritative: true,
              clientControlledEvolution: false,
              directCoinWrites: false,
              publicPassportDefault: false,
              preparedRulesDoNotScore: true
            }
          }
        };
      }
      if (payload.action === "dnaInitiateTransfer") {
        return { data: { ...payload, ownershipId: "OWN-001" } };
      }
      if (payload.action === "dnaRotateReleaseClaimToken") {
        return { data: { ...payload, transferMode: "RELEASE_TO_FLOCK" } };
      }
      return { data: { ok: true, payload } };
    }
  });
  return { service, calls };
}

test("object issuance requires founder approval and forbids client evolution", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.createObject({
      objectType: "BALL",
      serialNumber: "001",
      displayName: "Ball #001",
      physicalIdentityType: "QR",
      idempotencyKey: "dna:object:001"
    }),
    (error) => error.code === "FOUNDER_APPROVAL_REQUIRED"
  );

  await assert.rejects(
    () => service.createObject({
      objectType: "BALL",
      serialNumber: "001",
      displayName: "Ball #001",
      physicalIdentityType: "QR",
      evolutionScore: 999,
      founderApproved: true,
      idempotencyKey: "dna:object:001"
    }),
    (error) => error.code === "CLIENT_EVOLUTION_FORBIDDEN"
  );
});

test("valid object issuance maps to authoritative dnaCreateObject action", async () => {
  const { service, calls } = harness();
  await service.createObject({
    objectType: "COIN",
    editionCode: "FIRST_EDITION",
    serialNumber: "0001",
    displayName: "First Edition Coin #0001",
    ownerBirdieId: "BIRDIE-0001",
    physicalIdentityType: "QR_NFC",
    physicalIdentityRef: "public-ref-0001",
    publicPassport: true,
    founderApproved: true,
    idempotencyKey: "dna:coin:0001"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "dnaCreateObject");
  assert.equal(calls[0].founderApproved, true);
  assert.equal(calls[0].objectType, "COIN");
  assert.equal(calls[0].publicPassport, true);
});

test("public passport is privacy-off by default at object issuance", async () => {
  const { service, calls } = harness();
  await service.createObject({
    objectType: "BALL",
    serialNumber: "0002",
    displayName: "Ball #0002",
    physicalIdentityType: "QR",
    founderApproved: true,
    idempotencyKey: "dna:ball:0002"
  });
  assert.equal(calls[0].publicPassport, false);
});

test("owner-submitted event never controls points and maps as pending-capable event", async () => {
  const { service, calls } = harness();
  await service.createEvent("DNA-001", {
    eventType: "COURSE_VISIT",
    birdieId: "BIRDIE-0001",
    sourceType: "COIN_SHOP",
    sourceReference: "course:gut-wissmannshof:2026-08-12",
    courseName: "Gut Wissmannshof",
    verificationMode: "OWNER_SUBMITTED",
    idempotencyKey: "dna:event:001"
  });

  assert.equal(calls[0].action, "dnaCreateEvent");
  assert.equal(calls[0].verificationMode, "OWNER_SUBMITTED");
  assert.equal(calls[0].evolutionPoints, undefined);
});

test("founder-verified event requires founder approval", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.createEvent("DNA-001", {
      eventType: "FIRST_BIRDIE",
      birdieId: "BIRDIE-0001",
      sourceType: "FOUNDER",
      sourceReference: "first-birdie",
      verificationMode: "FOUNDER_VERIFIED",
      idempotencyKey: "dna:event:first-birdie"
    }),
    (error) => error.code === "FOUNDER_APPROVAL_REQUIRED"
  );
});

test("system-verified event requires an explicit trusted-system assertion", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.createEvent("DNA-001", {
      eventType: "INSTAGRAM_TAG_VERIFIED",
      birdieId: "BIRDIE-0001",
      sourceType: "INSTAGRAM",
      sourceReference: "ig:media:001",
      verificationMode: "SYSTEM_VERIFIED",
      idempotencyKey: "dna:event:ig:001"
    }),
    (error) => error.code === "SYSTEM_VERIFICATION_REQUIRED"
  );
});

test("release into flock cannot preselect a recipient", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.initiateTransfer("DNA-001", {
      fromBirdieId: "BIRDIE-0001",
      toBirdieId: "BIRDIE-0002",
      transferMode: "RELEASE_TO_FLOCK",
      idempotencyKey: "dna:transfer:release:001"
    }),
    (error) => error.code === "RECIPIENT_NOT_ALLOWED"
  );
});

test("release into flock returns raw token once but sends only its SHA-256 hash to BirdieOS", async () => {
  const { service, calls } = harness();
  const result = await service.initiateTransfer("DNA-001", {
    fromBirdieId: "BIRDIE-0001",
    transferMode: "RELEASE_TO_FLOCK",
    idempotencyKey: "dna:release:001"
  });

  assert.equal(calls[0].action, "dnaInitiateTransfer");
  assert.match(calls[0].claimTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].claimToken, undefined);
  assert.equal(result.claimTokenOneTime, true);
  assert.ok(result.claimToken.length >= 40);
  assert.equal(result.claimTokenHash, undefined);
  assert.equal(
    createHash("sha256").update(result.claimToken, "utf8").digest("hex"),
    calls[0].claimTokenHash
  );
});

test("release claim-token rotation sends only a fresh hash and returns raw token once", async () => {
  const { service, calls } = harness();
  const result = await service.rotateReleaseClaimToken("OWN-001", {
    fromBirdieId: "BIRDIE-0001",
    idempotencyKey: "dna:release:rotate:001"
  });

  assert.equal(calls[0].action, "dnaRotateReleaseClaimToken");
  assert.match(calls[0].claimTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].claimToken, undefined);
  assert.equal(result.claimTokenOneTime, true);
  assert.ok(result.claimToken.length >= 40);
  assert.equal(result.claimTokenHash, undefined);
});

test("release acceptance hashes the raw claim token before BirdieOS", async () => {
  const { service, calls } = harness();
  const rawToken = "claim-token-only-the-client-sees";
  await service.acceptTransfer("OWN-001", {
    toBirdieId: "BIRDIE-0002",
    claimToken: rawToken,
    idempotencyKey: "dna:release:accept:001"
  });

  assert.equal(calls[0].action, "dnaAcceptTransfer");
  assert.equal(calls[0].claimToken, undefined);
  assert.equal(
    calls[0].claimTokenHash,
    createHash("sha256").update(rawToken, "utf8").digest("hex")
  );
});

test("direct transfer requires recipient and acceptance is a separate action", async () => {
  const { service, calls } = harness();
  await service.initiateTransfer("DNA-001", {
    fromBirdieId: "BIRDIE-0001",
    toBirdieId: "BIRDIE-0002",
    transferMode: "DIRECT",
    idempotencyKey: "dna:transfer:001"
  });
  await service.acceptTransfer("OWN-001", {
    toBirdieId: "BIRDIE-0002",
    idempotencyKey: "dna:transfer:accept:001"
  });

  assert.equal(calls[0].action, "dnaInitiateTransfer");
  assert.equal(calls[1].action, "dnaAcceptTransfer");
  assert.equal(calls[0].claimTokenHash, undefined);
  assert.equal(calls[1].claimTokenHash, undefined);
});

test("config is read from BirdieOS and prepared rules do not imply active scoring", async () => {
  const { service, calls } = harness();
  const config = await service.getConfig();
  assert.equal(calls[0].action, "dnaGetConfig");
  assert.equal(config.principles.birdieOsAuthoritative, true);
  assert.equal(config.principles.eventLedgerAuthoritative, true);
  assert.equal(config.principles.clientControlledEvolution, false);
  assert.equal(config.principles.directCoinWrites, false);
  assert.equal(config.principles.publicPassportDefault, false);
  assert.equal(config.principles.preparedRulesDoNotScore, true);
  assert.equal(config.eventScoringEnabled, false);
});
