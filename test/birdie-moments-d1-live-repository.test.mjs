import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SQLiteD1TestDatabase } from "./helpers/sqlite-d1.mjs";
import { createD1MomentsRepository } from "../src/moments/persistence/d1-repository.mjs";

const migrations = [
  "001_birdie_moments.sql",
  "002_moment_purchases.sql",
  "003_moment_print_orders.sql",
  "004_expand_purchase_fulfillment_status.sql",
  "005_moment_app_store_iap.sql",
  "006_purchase_shipping_and_failures.sql"
];

function migrate(db) {
  for (const file of migrations) {
    const sql = readFileSync(new URL(`../db/${file}`, import.meta.url), "utf8");
    db.exec(sql);
  }
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function makeRepo(db) {
  return createD1MomentsRepository({
    db,
    idFactory: ids(),
    now: () => "2026-09-04T01:15:00Z",
    roundSource: {
      async getRound(id) { return { id }; },
      async listPreviousComparableRounds() { return []; }
    }
  });
}

test("all Birdie Moments migrations apply from scratch and real print states satisfy constraints", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    const statuses = [
      "NOT_STARTED", "READY", "AWAITING_ORDER", "SUBMITTED", "IN_PRODUCTION",
      "SHIPPED", "DELIVERED", "FULFILLING", "FULFILLED", "FULFILLMENT_FAILED", "CANCELLED"
    ];
    for (let i = 0; i < statuses.length; i += 1) {
      db.exec(`INSERT INTO moment_purchases (
        id,user_id,moment_id,product_type,payment_status,amount_minor,currency,
        fulfillment_type,fulfillment_status,created_at,updated_at
      ) VALUES ('status-${i}','u-${i}','m-${i}','PRINT_A3','PAID',3490,'EUR','PRINT','${statuses[i]}','t','t')`);
    }
    const count = db.sqlite.prepare("SELECT COUNT(*) AS count FROM moment_purchases").get().count;
    assert.equal(Number(count), statuses.length);
  } finally {
    db.close();
  }
});

test("D1 repository persists Moment render assets and idempotent purchase/payment state", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    const repo = makeRepo(db);
    const momentInput = {
      userId: "u1", roundId: "r1", momentType: "ROUND", status: "PENDING",
      templateVersion: "birdie-moment-round-v1",
      renderData: { internalRoundId: "r1", playerName: "Kevin", totalScore: 82 },
      isPersonalBest: false
    };
    const first = await repo.ensureMoment(momentInput);
    const second = await repo.ensureMoment(momentInput);
    assert.equal(first.id, second.id);

    await repo.markMomentPreviewReady({
      momentId: first.id,
      generatedAt: "2026-09-04T01:16:00Z",
      previewAsset: "private://preview.svg",
      digitalAsset: "private://digital.svg",
      printAsset: "private://print.svg"
    });
    const ready = await repo.getMoment(first.id);
    assert.equal(ready.status, "PREVIEW_READY");
    assert.equal(ready.digitalAsset, "private://digital.svg");

    const purchase = await repo.ensurePurchase({
      userId: "u1", momentId: first.id, productType: "DIGITAL_ROUND",
      paymentStatus: "PENDING", amountMinor: 690, currency: "EUR",
      fulfillmentType: "DIGITAL", fulfillmentStatus: "NOT_STARTED"
    });
    await repo.attachPaymentReference({ purchaseId: purchase.id, paymentReference: "pay-1" });
    const paid1 = await repo.confirmPaidPurchase({
      purchaseId: purchase.id, providerEventId: "evt-1", eventType: "PAYMENT_SUCCEEDED",
      paymentStatus: "PAID", entitlementGrantedAt: "paid", fulfillmentStatus: "READY", updatedAt: "paid"
    });
    const paid2 = await repo.confirmPaidPurchase({
      purchaseId: purchase.id, providerEventId: "evt-1", eventType: "PAYMENT_SUCCEEDED",
      paymentStatus: "PAID", entitlementGrantedAt: "paid", fulfillmentStatus: "READY", updatedAt: "paid"
    });
    assert.equal(paid1.duplicate, false);
    assert.equal(paid2.duplicate, true);
    assert.equal((await repo.getPurchase(purchase.id)).entitlementGrantedAt, "paid");
  } finally {
    db.close();
  }
});

test("D1 repository atomically binds one App Store transaction to one Moment purchase", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    const repo = makeRepo(db);
    const moment = await repo.ensureMoment({
      userId: "u1", roundId: "r1", momentType: "ROUND", status: "PREVIEW_READY",
      templateVersion: "birdie-moment-round-v1", renderData: {}, isPersonalBest: false
    });
    const purchase = await repo.ensurePurchase({
      userId: "u1", momentId: moment.id, productType: "DIGITAL_ROUND", paymentStatus: "PENDING",
      amountMinor: 690, currency: "EUR", fulfillmentType: "DIGITAL", fulfillmentStatus: "NOT_STARTED"
    });
    await repo.ensureAppStorePurchaseIntent({
      purchaseId: purchase.id, userId: "u1", momentId: moment.id,
      appStoreProductId: "configured.round", appAccountToken: "123e4567-e89b-42d3-a456-426614174000",
      createdAt: "t", updatedAt: "t"
    });
    const input = {
      purchaseId: purchase.id, transactionId: "apple-tx-1", originalTransactionId: "apple-tx-1",
      appStoreProductId: "configured.round", appAccountToken: "123e4567-e89b-42d3-a456-426614174000",
      environment: "Sandbox", quantity: 1, providerPriceMilliunits: 6900,
      providerCurrency: "EUR", purchaseDateMs: 1, signedDateMs: 2,
      paymentReference: "apple-tx-1", paymentStatus: "PAID", entitlementGrantedAt: "paid",
      fulfillmentStatus: "READY", processedAt: "paid", updatedAt: "paid"
    };
    const first = await repo.confirmAppStorePaidPurchase(input);
    const duplicate = await repo.confirmAppStorePaidPurchase(input);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await repo.getPurchase(purchase.id)).paymentReference, "apple-tx-1");
  } finally {
    db.close();
  }
});

test("D1 repository retains validated print shipping and tracking through fulfillment", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    const repo = makeRepo(db);
    const moment = await repo.ensureMoment({
      userId: "u1", roundId: "r1", momentType: "ROUND", status: "PREVIEW_READY",
      templateVersion: "birdie-moment-round-v1", renderData: {}, isPersonalBest: false
    });
    const address = {
      recipientName: "Kevin Test", email: "kevin@example.com", line1: "Test 1",
      postalCode: "12345", city: "Berlin", countryCode: "DE"
    };
    const purchase = await repo.ensurePurchase({
      userId: "u1", momentId: moment.id, productType: "PRINT_A3", paymentStatus: "PAID",
      amountMinor: 3490, currency: "EUR", fulfillmentType: "PRINT",
      fulfillmentStatus: "AWAITING_ORDER", shippingAddress: address
    });
    assert.deepEqual((await repo.getPurchase(purchase.id)).shippingAddress, address);

    const order = await repo.ensurePrintOrder({
      purchaseId: purchase.id, userId: "u1", momentId: moment.id, productType: "PRINT_A3",
      providerName: "GELATO", status: "PENDING_SUBMISSION", recipientName: "Kevin Test",
      address, printAsset: "private://print.svg", internalOrderKey: `birdie-moment-print:${purchase.id}`,
      createdAt: "t", updatedAt: "t"
    });
    await repo.markPrintOrderSubmitted({
      orderId: order.id, providerOrderId: "gelato-1", status: "SUBMITTED",
      fulfillmentStatus: "SUBMITTED", updatedAt: "t2"
    });
    await repo.updatePrintOrderStatus({
      orderId: order.id, purchaseId: purchase.id, status: "SHIPPED", fulfillmentStatus: "SHIPPED",
      trackingReference: "https://carrier.example/track", updatedAt: "t3"
    });
    const shipped = await repo.getPrintOrderByPurchaseId(purchase.id);
    assert.equal(shipped.status, "SHIPPED");
    assert.equal(shipped.trackingReference, "https://carrier.example/track");
    assert.equal((await repo.getPurchase(purchase.id)).fulfillmentStatus, "SHIPPED");
  } finally {
    db.close();
  }
});
