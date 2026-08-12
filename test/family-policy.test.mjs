import test from "node:test";
import assert from "node:assert/strict";
import {
  FAMILY_ACCESS_POLICY,
  isFamilyBlockedKey,
  sanitizeFamilyData,
  sanitizeFamilyString
} from "../src/family/family-policy.mjs";

test("family policy is strict read-only", () => {
  assert.equal(FAMILY_ACCESS_POLICY.role, "FAMILY_READ_ONLY");
  assert.equal(FAMILY_ACCESS_POLICY.readOnly, true);
  assert.deepEqual(FAMILY_ACCESS_POLICY.allowedResources, ["health", "briefing", "nextTask"]);
});

test("sensitive keys are blocked", () => {
  for (const key of [
    "FINANCE DATABASE",
    "bankBalance",
    "quotedCost",
    "api_key",
    "authToken",
    "email",
    "mailbox",
    "ACTION LOG"
  ]) {
    assert.equal(isFamilyBlockedKey(key), true, key);
  }
  assert.equal(isFamilyBlockedKey("productStatus"), false);
});

test("sanitizer removes finance/mail/secrets but preserves safe company data", () => {
  const source = {
    brand: "Birdie & Breakfast",
    productStatus: "Prototype",
    finance: { cash: 9800 },
    quotedCost: 2.32,
    contactEmail: "kevin@birdiebites.de",
    supplier: {
      name: "Example Supplier",
      phone: "+49 172 1234567",
      status: "BACKUP"
    },
    nested: {
      apiKey: "SECRET",
      publicNote: "Write to test@example.com or call +49 160 12345678"
    }
  };

  const result = sanitizeFamilyData(source);
  assert.equal(result.brand, "Birdie & Breakfast");
  assert.equal(result.productStatus, "Prototype");
  assert.equal("finance" in result, false);
  assert.equal("quotedCost" in result, false);
  assert.equal("contactEmail" in result, false);
  assert.equal(result.supplier.name, "Example Supplier");
  assert.equal("phone" in result.supplier, false);
  assert.equal("apiKey" in result.nested, false);
  assert.match(result.nested.publicNote, /\[redacted-email\]/);
  assert.match(result.nested.publicNote, /\[redacted-phone\]/);
});

test("string sanitizer masks secret-bearing URLs", () => {
  const result = sanitizeFamilyString("https://example.com?a=1&token=abc123&key=qwerty");
  assert.match(result, /token=\[redacted\]/);
  assert.match(result, /key=\[redacted\]/);
});
