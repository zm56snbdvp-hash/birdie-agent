import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBirdieFolderPaths,
  normalizeMailbox,
  normalizeUid,
  requireFounderApproval
} from "../src/mail-policy.mjs";

test("Birdie folder paths preserve the OS hierarchy and server delimiter", () => {
  const paths = buildBirdieFolderPaths(".");
  assert.equal(paths[0], "Birdie OS");
  assert.ok(paths.includes("Birdie OS.00 COMMAND CENTER.FOUNDER DECISION"));
  assert.ok(paths.includes("Birdie OS.01 PRODUCTS.Starter Kit"));
  assert.ok(paths.includes("Birdie OS.02 SUPPLIERS.Production"));
  assert.ok(paths.includes("Birdie OS.05 COMMUNITY.Early Bird - Tanja"));
  assert.ok(paths.includes("Birdie OS.99 ARCHIVE"));
  assert.equal(new Set(paths).size, paths.length);
});

test("founder approval requires both boolean approval and exact confirmation", () => {
  assert.throws(
    () => requireFounderApproval({ founderApproved: true }, "SEND_EMAIL"),
    (error) => error.code === "FOUNDER_APPROVAL_REQUIRED" && error.status === 403
  );
  assert.throws(
    () => requireFounderApproval({ founderApproved: false, confirmation: "SEND_EMAIL" }, "SEND_EMAIL"),
    (error) => error.code === "FOUNDER_APPROVAL_REQUIRED"
  );
  assert.doesNotThrow(() => requireFounderApproval(
    { founderApproved: true, confirmation: "SEND_EMAIL" },
    "SEND_EMAIL"
  ));
});

test("UID and mailbox inputs reject unsafe values", () => {
  assert.equal(normalizeUid("284"), 284);
  assert.throws(() => normalizeUid("0"), (error) => error.code === "INVALID_UID");
  assert.equal(normalizeMailbox("Birdie OS/01 PRODUCTS"), "Birdie OS/01 PRODUCTS");
  assert.throws(() => normalizeMailbox("INBOX\nInjected"), (error) => error.code === "INVALID_MAILBOX");
});
