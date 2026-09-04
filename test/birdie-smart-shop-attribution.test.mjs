import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAffiliateCommerceService } from "../src/affiliate-commerce/service.mjs";
import {
  buildAwinAttributedDestination,
  isTrustedAwinTrackingUrl
} from "../src/affiliate-commerce/providers/awin-attribution.mjs";
import {
  createAwinTransactionClient,
  normalizeAwinTransaction,
  reconcileAwinTransactions
} from "../src/affiliate-commerce/providers/awin-transactions.mjs";
import { createD1AffiliateCommerceStore } from "../src/affiliate-commerce/persistence/d1-store.mjs";

const awinProduct = {
  id: "awin:11593:p-1",
  provider: "awin:11593",
  title: "Premium Golf Balls",
  category: "BALLS",
  price: 39.99,
  currency: "EUR",
  active: true,
  available: true,
  regions: ["DE"],
  affiliateUrl: "https://www.awin1.com/cread.php?awinmid=11593&awinaffid=123&ued=https%3A%2F%2Fshop.example%2Fballs"
};

test("Awin attribution accepts only trusted tracking hosts", () => {
  assert.equal(isTrustedAwinTrackingUrl(awinProduct.affiliateUrl), true);
  assert.equal(isTrustedAwinTrackingUrl("https://evil.example/cread.php"), false);
});

test("Awin attribution adds private clickref2 and explicit no-consent by default", () => {
  const url = new URL(buildAwinAttributedDestination({
    affiliateUrl: awinProduct.affiliateUrl,
    clickId: "click-123"
  }));
  assert.equal(url.searchParams.get("clickref2"), "click-123");
  assert.equal(url.searchParams.get("cons"), "0");
  assert.equal(url.searchParams.get("clickref"), null);
});

test("commerce service gets consent server-side and records Awin attribution", async () => {
  const recorded = [];
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [awinProduct]; } },
    playerContextProvider: { async getContext() { return { region: "DE" }; } },
    consentProvider: { async getAwinTrackingConsent(userId) { return userId === "u-1"; } },
    clickSink: { async record(event) { recorded.push(event); } },
    clickIdFactory: async () => "click-abc"
  });

  const result = await commerce.createOutboundClick({ authUserId: "u-1", productId: awinProduct.id });
  const outbound = new URL(result.destinationUrl);
  assert.equal(outbound.searchParams.get("clickref2"), "click-abc");
  assert.equal(outbound.searchParams.get("cons"), "1");
  assert.equal(recorded[0].network, "AWIN");
  assert.equal(recorded[0].advertiserId, "11593");
  assert.equal(recorded[0].networkClickRef, "click-abc");
  assert.equal(recorded[0].trackingConsent, true);
});

test("missing consent adapter fails privacy-safe to cons=0", async () => {
  const commerce = createAffiliateCommerceService({
    catalogProvider: { async listProducts() { return [awinProduct]; } },
    playerContextProvider: { async getContext() { return { region: "DE" }; } },
    clickIdFactory: async () => "click-safe"
  });
  const result = await commerce.createOutboundClick({ authUserId: "u-1", productId: awinProduct.id });
  assert.equal(new URL(result.destinationUrl).searchParams.get("cons"), "0");
});

test("Awin transaction normalizer maps private clickRef2 back to BirdieWorld click", () => {
  const tx = normalizeAwinTransaction({
    id: 999,
    advertiserId: 11593,
    status: "pending",
    clickRef2: "click-abc",
    saleAmount: { amount: 199.9, currency: "EUR" },
    commissionAmount: { amount: 13.99, currency: "EUR" },
    transactionDate: "2026-09-04T10:00:00",
    type: "Sale"
  });
  assert.equal(tx.networkTransactionId, "999");
  assert.equal(tx.clickId, "click-abc");
  assert.equal(tx.saleAmount, "199.9");
  assert.equal(tx.commissionAmount, "13.99");
});

test("Awin transaction client keeps token out of URL and enforces 31-day window", async () => {
  const requests = [];
  const client = createAwinTransactionClient({
    publisherId: "123",
    accessToken: "secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, async json() { return []; } };
    }
  });
  await client.listTransactions({
    startDate: "2026-09-01T00:00:00Z",
    endDate: "2026-09-04T00:00:00Z",
    advertiserIds: [11593]
  });
  assert.equal(requests[0].url.includes("secret-token"), false);
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret-token");
  await assert.rejects(
    client.listTransactions({ startDate: "2026-01-01T00:00:00Z", endDate: "2026-03-01T00:00:00Z" }),
    (error) => error.code === "AWIN_TRANSACTION_WINDOW_EXCEEDS_31_DAYS"
  );
});

test("Awin transaction window converts UTC instants into the declared Europe/Berlin timezone", async () => {
  let requestedUrl = null;
  const client = createAwinTransactionClient({
    publisherId: "123",
    accessToken: "secret-token",
    timezone: "Europe/Berlin",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, async json() { return []; } };
    }
  });
  await client.listTransactions({
    startDate: "2026-09-04T00:00:00Z",
    endDate: "2026-09-04T01:00:00Z"
  });
  assert.equal(requestedUrl.searchParams.get("timezone"), "Europe/Berlin");
  assert.equal(requestedUrl.searchParams.get("startDate"), "2026-09-04T02:00:00");
  assert.equal(requestedUrl.searchParams.get("endDate"), "2026-09-04T03:00:00");
});

test("reconciler deduplicates transaction ids and persists latest view", async () => {
  const upserts = [];
  const client = {
    async listTransactions({ status }) {
      return [{
        network: "AWIN",
        networkTransactionId: "99",
        clickId: "click-abc",
        advertiserId: "11593",
        status: status || "pending"
      }];
    }
  };
  const result = await reconcileAwinTransactions({
    client,
    conversionSink: { async upsert(row) { upserts.push(row); } },
    startDate: "2026-09-01",
    endDate: "2026-09-04",
    statuses: ["pending", "approved"]
  });
  assert.equal(result.seen, 1);
  assert.equal(result.withClickRef, 1);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].status, "approved");
});

test("D1 store binds click and conversion data without persisting destination URL", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() { calls.push({ sql, params }); return { success: true }; },
            async first() { return null; }
          };
        }
      };
    }
  };
  const store = createD1AffiliateCommerceStore({ db, now: () => "2026-09-04T12:00:00Z" });
  await store.clickSink.record({
    clickId: "click-abc",
    userId: "u-1",
    productId: awinProduct.id,
    provider: awinProduct.provider,
    network: "AWIN",
    advertiserId: "11593",
    category: "BALLS",
    placement: "post-round",
    networkClickRef: "click-abc",
    trackingConsent: false,
    occurredAt: "2026-09-04T11:00:00Z",
    destinationUrl: "https://www.awin1.com/secret"
  });
  await store.conversionSink.upsert({
    network: "AWIN",
    networkTransactionId: "99",
    clickId: "click-abc",
    advertiserId: "11593",
    status: "pending",
    saleAmount: "199.9",
    saleCurrency: "EUR"
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.includes("https://www.awin1.com/secret"), false);
});

test("affiliate conversion schema preserves network transactions even without a local click row", async () => {
  const sql = await readFile(new URL("../db/009_affiliate_commerce.sql", import.meta.url), "utf8");
  const conversionTable = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS affiliate_conversions"));
  assert.equal(/FOREIGN KEY\s*\(click_id\)/i.test(conversionTable), false);
  assert.match(conversionTable, /click_id TEXT/);
});
