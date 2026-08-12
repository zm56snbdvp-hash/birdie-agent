import test from "node:test";
import assert from "node:assert/strict";
import { createDnaService } from "../src/dna/service.mjs";

function harness() {
  const calls = [];
  const service = createDnaService({
    async birdieOSPost(payload) {
      calls.push(payload);
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
});

test("config declares append-only evolution principles and no direct coin writes", () => {
  const { service } = harness();
  const config = service.getConfig();
  assert.equal(config.principles.eventLedgerAuthoritative, true);
  assert.equal(config.principles.clientControlledEvolution, false);
  assert.equal(config.principles.directCoinWrites, false);
  assert.deepEqual(
    config.evolutionTiers.map((tier) => tier.code),
    ["COMMON_RARE", "FLOCK_RARE", "NIGHT_OWL_RARE", "STAY_RARE", "LEGACY_RARE"]
  );
});
