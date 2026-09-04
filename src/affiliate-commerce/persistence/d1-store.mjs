export function createD1AffiliateCommerceStore({
  db,
  now = () => new Date().toISOString()
}) {
  if (!db?.prepare) throw new TypeError("A Cloudflare D1 binding is required");

  const clickSink = {
    async record(event) {
      await db.prepare(`
        INSERT OR IGNORE INTO affiliate_clicks (
          id,user_id,product_id,provider,network,advertiser_id,category,placement,
          network_click_ref,tracking_consent,occurred_at,created_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      `).bind(
        event.clickId,
        event.userId,
        event.productId,
        event.provider,
        event.network ?? "DIRECT",
        event.advertiserId ?? null,
        event.category ?? null,
        event.placement,
        event.networkClickRef ?? null,
        event.trackingConsent === null || event.trackingConsent === undefined
          ? null
          : event.trackingConsent === true ? 1 : 0,
        event.occurredAt,
        now()
      ).run();
      return event.clickId;
    }
  };

  const conversionSink = {
    async upsert(conversion) {
      await db.prepare(`
        INSERT INTO affiliate_conversions (
          network,network_transaction_id,click_id,advertiser_id,status,
          sale_amount,sale_currency,commission_amount,commission_currency,
          transaction_at,validation_at,transaction_type,last_seen_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
        ON CONFLICT(network,network_transaction_id) DO UPDATE SET
          click_id=excluded.click_id,
          advertiser_id=excluded.advertiser_id,
          status=excluded.status,
          sale_amount=excluded.sale_amount,
          sale_currency=excluded.sale_currency,
          commission_amount=excluded.commission_amount,
          commission_currency=excluded.commission_currency,
          transaction_at=excluded.transaction_at,
          validation_at=excluded.validation_at,
          transaction_type=excluded.transaction_type,
          last_seen_at=excluded.last_seen_at
      `).bind(
        conversion.network,
        conversion.networkTransactionId,
        conversion.clickId ?? null,
        conversion.advertiserId ?? null,
        conversion.status,
        conversion.saleAmount ?? null,
        conversion.saleCurrency ?? null,
        conversion.commissionAmount ?? null,
        conversion.commissionCurrency ?? null,
        conversion.transactionAt ?? null,
        conversion.validationAt ?? null,
        conversion.transactionType ?? null,
        now()
      ).run();
      return `${conversion.network}:${conversion.networkTransactionId}`;
    }
  };

  return {
    clickSink,
    conversionSink,
    async getClick(clickId) {
      return db.prepare("SELECT * FROM affiliate_clicks WHERE id=?1 LIMIT 1").bind(clickId).first();
    },
    async getConversion(network, networkTransactionId) {
      return db.prepare(`
        SELECT * FROM affiliate_conversions
        WHERE network=?1 AND network_transaction_id=?2
        LIMIT 1
      `).bind(network, networkTransactionId).first();
    }
  };
}
