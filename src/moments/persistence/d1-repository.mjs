import { MomentCommerceError } from "../commerce/contracts.mjs";

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("crypto.randomUUID() is required");
}

function rows(result) {
  return result?.results ?? [];
}

function changes(result) {
  return Number(result?.meta?.changes ?? 0);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function momentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    roundId: row.round_id,
    momentType: row.moment_type,
    status: row.status,
    generatedAt: row.generated_at,
    templateVersion: row.template_version,
    renderData: parseJson(row.render_data, {}),
    previewAsset: row.preview_asset,
    digitalAsset: row.digital_asset,
    printAsset: row.print_asset,
    isPersonalBest: Boolean(row.is_personal_best),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function purchaseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    momentId: row.moment_id,
    productType: row.product_type,
    paymentReference: row.payment_reference,
    paymentStatus: row.payment_status,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    fulfillmentType: row.fulfillment_type,
    fulfillmentStatus: row.fulfillment_status,
    fulfillmentReference: row.fulfillment_reference,
    entitlementGrantedAt: row.entitlement_granted_at,
    shippingAddress: parseJson(row.shipping_address_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function printOrderFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    userId: row.user_id,
    momentId: row.moment_id,
    productType: row.product_type,
    providerName: row.provider_name,
    providerOrderId: row.provider_order_id,
    status: row.status,
    recipientName: row.recipient_name,
    address: parseJson(row.address_json, null),
    printAsset: row.print_asset,
    internalOrderKey: row.internal_order_key,
    trackingReference: row.tracking_reference,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Concrete persistence for Birdie Moments-owned tables.
 * The canonical BirdieWorld round store stays injected via roundSource because
 * the recovered browser bundle proves the /api/round contract, not its private D1 table layout.
 */
export function createD1MomentsRepository({
  db,
  roundSource,
  idFactory = defaultIdFactory,
  now = () => new Date().toISOString()
}) {
  if (!db?.prepare || !db?.batch) throw new TypeError("A Cloudflare D1 binding is required");
  if (!roundSource?.getRound || !roundSource?.listPreviousComparableRounds) {
    throw new TypeError("roundSource.getRound/listPreviousComparableRounds are required");
  }

  const repo = {
    async getRound(roundId) {
      return roundSource.getRound(roundId);
    },

    async listPreviousComparableRounds(query) {
      return roundSource.listPreviousComparableRounds(query);
    },

    async ensureMoment(input) {
      const id = idFactory();
      const timestamp = now();
      await db.prepare(`
        INSERT OR IGNORE INTO birdie_moments (
          id,user_id,round_id,moment_type,status,generated_at,template_version,render_data,
          preview_asset,digital_asset,print_asset,is_personal_best,created_at,updated_at
        ) VALUES (?1,?2,?3,?4,?5,NULL,?6,?7,NULL,NULL,NULL,?8,?9,?9)
      `).bind(
        id, input.userId, input.roundId, input.momentType, input.status,
        input.templateVersion, JSON.stringify(input.renderData ?? {}), input.isPersonalBest ? 1 : 0,
        timestamp
      ).run();
      const row = await db.prepare(`
        SELECT * FROM birdie_moments
        WHERE round_id=?1 AND moment_type=?2 AND template_version=?3
        LIMIT 1
      `).bind(input.roundId, input.momentType, input.templateVersion).first();
      return momentFromRow(row);
    },

    async getMoment(momentId) {
      return momentFromRow(await db.prepare("SELECT * FROM birdie_moments WHERE id=?1 LIMIT 1").bind(momentId).first());
    },

    async listMomentsForRound(roundId) {
      const result = await db.prepare("SELECT * FROM birdie_moments WHERE round_id=?1 ORDER BY created_at ASC").bind(roundId).all();
      return rows(result).map(momentFromRow);
    },

    async setMomentStatus(momentId, status) {
      await db.prepare("UPDATE birdie_moments SET status=?1, updated_at=?2 WHERE id=?3").bind(status, now(), momentId).run();
    },

    async markMomentPreviewReady({ momentId, generatedAt, previewAsset, digitalAsset, printAsset }) {
      await db.prepare(`
        UPDATE birdie_moments
        SET status='PREVIEW_READY', generated_at=?1, preview_asset=?2, digital_asset=?3, print_asset=?4, updated_at=?1
        WHERE id=?5
      `).bind(generatedAt, previewAsset, digitalAsset, printAsset, momentId).run();
      return repo.getMoment(momentId);
    },

    async markMomentFailed({ momentId, error }) {
      const timestamp = now();
      await db.prepare("UPDATE birdie_moments SET status='FAILED', updated_at=?1 WHERE id=?2").bind(timestamp, momentId).run();
      await repo.recordMomentFailure({
        stage: "RENDERING",
        code: error?.code ?? error?.name ?? "RENDER_FAILED",
        message: String(error?.message ?? error),
        momentId
      });
    },

    async recordMomentEvaluationFailure({ roundId, stage = "EVALUATION", error }) {
      return repo.recordMomentFailure({
        stage,
        code: error?.code ?? error?.name ?? "EVALUATION_FAILED",
        message: String(error?.message ?? error),
        roundId
      });
    },

    async recordMomentFailure(failure) {
      const id = idFactory();
      await db.prepare(`
        INSERT INTO moment_failures (
          id,stage,code,message,round_id,moment_id,purchase_id,product_type,fulfillment_type,created_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      `).bind(
        id, failure.stage ?? "UNKNOWN", failure.code ?? "UNKNOWN_ERROR", failure.message ?? "Unknown error",
        failure.roundId ?? null, failure.momentId ?? null, failure.purchaseId ?? null,
        failure.productType ?? null, failure.fulfillmentType ?? null, now()
      ).run();
      return id;
    },

    async ensurePurchase(input) {
      const id = idFactory();
      const timestamp = now();
      await db.prepare(`
        INSERT OR IGNORE INTO moment_purchases (
          id,user_id,moment_id,product_type,payment_reference,payment_status,amount_minor,currency,
          fulfillment_type,fulfillment_status,fulfillment_reference,entitlement_granted_at,
          created_at,updated_at,shipping_address_json
        ) VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,NULL,NULL,?10,?10,?11)
      `).bind(
        id, input.userId, input.momentId, input.productType, input.paymentStatus,
        input.amountMinor, input.currency, input.fulfillmentType, input.fulfillmentStatus,
        timestamp, input.shippingAddress ? JSON.stringify(input.shippingAddress) : null
      ).run();
      const row = await db.prepare(`
        SELECT * FROM moment_purchases
        WHERE user_id=?1 AND moment_id=?2 AND product_type=?3 AND fulfillment_type=?4
        LIMIT 1
      `).bind(input.userId, input.momentId, input.productType, input.fulfillmentType).first();
      return purchaseFromRow(row);
    },

    async getPurchase(purchaseId) {
      return purchaseFromRow(await db.prepare("SELECT * FROM moment_purchases WHERE id=?1 LIMIT 1").bind(purchaseId).first());
    },

    async attachPaymentReference({ purchaseId, paymentReference }) {
      await db.prepare("UPDATE moment_purchases SET payment_reference=?1, updated_at=?2 WHERE id=?3")
        .bind(paymentReference, now(), purchaseId).run();
    },

    async getPurchaseByPaymentReference(reference) {
      return purchaseFromRow(await db.prepare("SELECT * FROM moment_purchases WHERE payment_reference=?1 LIMIT 1").bind(reference).first());
    },

    async getPurchaseForProduct({ userId, momentId, productType, fulfillmentType }) {
      return purchaseFromRow(await db.prepare(`
        SELECT * FROM moment_purchases
        WHERE user_id=?1 AND moment_id=?2 AND product_type=?3 AND fulfillment_type=?4
        LIMIT 1
      `).bind(userId, momentId, productType, fulfillmentType).first());
    },

    async confirmPaidPurchase(input) {
      const timestamp = input.updatedAt ?? now();
      const result = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO moment_payment_events (provider_event_id,purchase_id,event_type,processed_at)
          VALUES (?1,?2,?3,?4)
        `).bind(input.providerEventId, input.purchaseId, input.eventType, timestamp),
        db.prepare(`
          UPDATE moment_purchases
          SET payment_status=?1, entitlement_granted_at=?2, fulfillment_status=?3, updated_at=?4
          WHERE id=?5
            AND EXISTS (
              SELECT 1 FROM moment_payment_events
              WHERE provider_event_id=?6 AND purchase_id=?5
            )
        `).bind(
          input.paymentStatus, input.entitlementGrantedAt ?? null, input.fulfillmentStatus,
          timestamp, input.purchaseId, input.providerEventId
        )
      ]);
      const event = await db.prepare("SELECT purchase_id FROM moment_payment_events WHERE provider_event_id=?1")
        .bind(input.providerEventId).first();
      if (!event || String(event.purchase_id) !== String(input.purchaseId)) {
        throw new MomentCommerceError("PAYMENT_EVENT_REUSED", "Provider event belongs to another purchase", 409);
      }
      return { duplicate: changes(result[0]) === 0, purchase: await repo.getPurchase(input.purchaseId) };
    },

    async markPurchaseFailed({ purchaseId, providerEventId, failedAt }) {
      const timestamp = failedAt ?? now();
      if (providerEventId) {
        await db.batch([
          db.prepare(`INSERT OR IGNORE INTO moment_payment_events (provider_event_id,purchase_id,event_type,processed_at)
                      VALUES (?1,?2,'PAYMENT_FAILED',?3)`).bind(providerEventId, purchaseId, timestamp),
          db.prepare("UPDATE moment_purchases SET payment_status='FAILED', updated_at=?1 WHERE id=?2")
            .bind(timestamp, purchaseId)
        ]);
      } else {
        await db.prepare("UPDATE moment_purchases SET payment_status='FAILED', updated_at=?1 WHERE id=?2")
          .bind(timestamp, purchaseId).run();
      }
    },

    async ensureAppStorePurchaseIntent(input) {
      await db.prepare(`
        INSERT OR IGNORE INTO moment_app_store_purchase_intents (
          purchase_id,user_id,moment_id,app_store_product_id,app_account_token,created_at,updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7)
      `).bind(
        input.purchaseId, input.userId, input.momentId, input.appStoreProductId,
        input.appAccountToken, input.createdAt ?? now(), input.updatedAt ?? now()
      ).run();
      const intent = await repo.getAppStorePurchaseIntent(input.purchaseId);
      if (
        !intent ||
        String(intent.userId) !== String(input.userId) ||
        String(intent.momentId) !== String(input.momentId) ||
        String(intent.appStoreProductId) !== String(input.appStoreProductId) ||
        String(intent.appAccountToken).toLowerCase() !== String(input.appAccountToken).toLowerCase()
      ) {
        throw new MomentCommerceError("APPLE_PURCHASE_INTENT_CONFLICT", "Existing App Store purchase intent conflicts", 409);
      }
      return intent;
    },

    async getAppStorePurchaseIntent(purchaseId) {
      const row = await db.prepare("SELECT * FROM moment_app_store_purchase_intents WHERE purchase_id=?1 LIMIT 1")
        .bind(purchaseId).first();
      if (!row) return null;
      return {
        purchaseId: row.purchase_id,
        userId: row.user_id,
        momentId: row.moment_id,
        appStoreProductId: row.app_store_product_id,
        appAccountToken: row.app_account_token,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    },

    async confirmAppStorePaidPurchase(input) {
      const timestamp = input.processedAt ?? now();
      const batch = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO moment_app_store_transactions (
            transaction_id,purchase_id,original_transaction_id,app_store_product_id,app_account_token,
            environment,quantity,provider_price_milliunits,provider_currency,purchase_date_ms,signed_date_ms,processed_at
          ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
        `).bind(
          input.transactionId, input.purchaseId, input.originalTransactionId, input.appStoreProductId,
          input.appAccountToken, input.environment, input.quantity, input.providerPriceMilliunits,
          input.providerCurrency, input.purchaseDateMs, input.signedDateMs, timestamp
        ),
        db.prepare(`
          UPDATE moment_purchases
          SET payment_reference=?1,payment_status=?2,entitlement_granted_at=?3,fulfillment_status=?4,updated_at=?5
          WHERE id=?6
            AND EXISTS (
              SELECT 1 FROM moment_app_store_transactions
              WHERE transaction_id=?1 AND purchase_id=?6
            )
        `).bind(
          input.paymentReference, input.paymentStatus, input.entitlementGrantedAt,
          input.fulfillmentStatus, input.updatedAt ?? timestamp, input.purchaseId
        )
      ]);

      const transaction = await db.prepare(`
        SELECT transaction_id,purchase_id FROM moment_app_store_transactions
        WHERE transaction_id=?1 OR purchase_id=?2
        ORDER BY CASE WHEN transaction_id=?1 THEN 0 ELSE 1 END
        LIMIT 1
      `).bind(input.transactionId, input.purchaseId).first();
      if (!transaction) throw new MomentCommerceError("APPLE_TRANSACTION_NOT_RECORDED", "App Store transaction was not recorded", 500);
      if (String(transaction.purchase_id) !== String(input.purchaseId)) {
        throw new MomentCommerceError("APPLE_TRANSACTION_REUSED", "App Store transaction belongs to another purchase", 409);
      }
      if (String(transaction.transaction_id) !== String(input.transactionId)) {
        throw new MomentCommerceError("APPLE_PURCHASE_ALREADY_BOUND", "Purchase is already bound to another App Store transaction", 409);
      }
      return { duplicate: changes(batch[0]) === 0, purchase: await repo.getPurchase(input.purchaseId) };
    },

    async getPrintOrderByPurchaseId(purchaseId) {
      return printOrderFromRow(await db.prepare("SELECT * FROM moment_print_orders WHERE purchase_id=?1 LIMIT 1").bind(purchaseId).first());
    },

    async ensurePrintOrder(input) {
      await db.prepare(`
        INSERT OR IGNORE INTO moment_print_orders (
          id,purchase_id,user_id,moment_id,product_type,provider_name,provider_order_id,status,
          recipient_name,address_json,print_asset,internal_order_key,failure_code,failure_message,created_at,updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,?8,?9,?10,?11,NULL,NULL,?12,?13)
      `).bind(
        idFactory(), input.purchaseId, input.userId, input.momentId, input.productType, input.providerName,
        input.status, input.recipientName, JSON.stringify(input.address), input.printAsset,
        input.internalOrderKey, input.createdAt ?? now(), input.updatedAt ?? now()
      ).run();
      return repo.getPrintOrderByPurchaseId(input.purchaseId);
    },

    async markPrintOrderSubmitted(input) {
      const timestamp = input.updatedAt ?? now();
      await db.batch([
        db.prepare(`UPDATE moment_print_orders SET provider_order_id=?1,status=?2,updated_at=?3 WHERE id=?4`)
          .bind(input.providerOrderId, input.status, timestamp, input.orderId),
        db.prepare(`UPDATE moment_purchases SET fulfillment_status=?1,fulfillment_reference=?2,updated_at=?3 WHERE id=(SELECT purchase_id FROM moment_print_orders WHERE id=?4)`)
          .bind(input.fulfillmentStatus, input.providerOrderId, timestamp, input.orderId)
      ]);
      return repo.getPrintOrderByPurchaseId((await db.prepare("SELECT purchase_id FROM moment_print_orders WHERE id=?1").bind(input.orderId).first())?.purchase_id);
    },

    async markPrintOrderFailed(input) {
      const timestamp = input.updatedAt ?? now();
      await db.batch([
        db.prepare(`
          UPDATE moment_print_orders
          SET status=?1,failure_code=?2,failure_message=?3,updated_at=?4 WHERE id=?5
        `).bind(input.status, input.failureCode ?? null, input.failureMessage ?? null, timestamp, input.orderId),
        db.prepare("UPDATE moment_purchases SET fulfillment_status=?1,updated_at=?2 WHERE id=?3")
          .bind(input.fulfillmentStatus, timestamp, input.purchaseId)
      ]);
    },

    async claimPrintProviderEvent(input) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO moment_print_provider_events (
          provider_name,provider_event_id,provider_order_id,event_type,processed_at
        ) VALUES (?1,?2,?3,?4,?5)
      `).bind(
        input.providerName, input.providerEventId, input.providerOrderId ?? null,
        input.eventType, input.processedAt ?? now()
      ).run();
      return { duplicate: changes(result) === 0 };
    },

    async getPrintOrderByProviderOrderId(providerName, providerOrderId) {
      return printOrderFromRow(await db.prepare(`
        SELECT * FROM moment_print_orders
        WHERE provider_name=?1 AND provider_order_id=?2 LIMIT 1
      `).bind(providerName, providerOrderId).first());
    },

    async updatePrintOrderStatus(input) {
      const timestamp = input.updatedAt ?? now();
      await db.batch([
        db.prepare(`
          UPDATE moment_print_orders
          SET status=?1,tracking_reference=?2,failure_code=?3,failure_message=?4,updated_at=?5
          WHERE id=?6
        `).bind(
          input.status, input.trackingReference ?? null, input.failureCode ?? null,
          input.failureMessage ?? null, timestamp, input.orderId
        ),
        db.prepare("UPDATE moment_purchases SET fulfillment_status=?1,updated_at=?2 WHERE id=?3")
          .bind(input.fulfillmentStatus, timestamp, input.purchaseId)
      ]);
      return repo.getPrintOrderByPurchaseId(input.purchaseId);
    }
  };

  return Object.freeze(repo);
}
