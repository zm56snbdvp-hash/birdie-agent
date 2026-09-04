import test from "node:test";
import assert from "node:assert/strict";
import {
  AFFILIATE_PROVIDER,
  awinAdvertiserIds,
  affiliateProviderById
} from "../src/affiliate-commerce/providers/registry.mjs";

test("provider registry is fail-closed until an approved provider is explicitly enabled", () => {
  assert.deepEqual(awinAdvertiserIds(), []);
  assert.equal(Object.values(AFFILIATE_PROVIDER).every((provider) => provider.enabledByDefault === false), true);
});

test("explicit provider activation returns only the selected Awin advertiser ids", () => {
  assert.deepEqual(
    awinAdvertiserIds({ enabledProviderIds: ["golf-und-guenstig-de", "shot-scope"] }),
    ["11742"]
  );
});

test("registry lookup returns stable integration metadata", () => {
  assert.equal(affiliateProviderById("golf-house-de")?.advertiserId, "11593");
  assert.equal(affiliateProviderById("missing"), null);
});
