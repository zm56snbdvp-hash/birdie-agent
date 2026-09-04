import { MomentCommerceError } from "../commerce/contracts.mjs";

export function createD1AppStoreIntentLookup({ db }) {
  if (!db?.prepare) throw new TypeError("D1 database is required");

  return Object.freeze({
    async getByAppAccountToken(appAccountToken) {
      if (typeof appAccountToken !== "string" || !appAccountToken.trim()) {
        throw new MomentCommerceError("APPLE_ACCOUNT_TOKEN_INVALID", "appAccountToken is required", 400);
      }

      const token = appAccountToken.trim();
      const countRow = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM moment_app_store_purchase_intents
        WHERE lower(app_account_token)=lower(?1)
      `).bind(token).first();
      const count = Number(countRow?.count ?? 0);
      if (count > 1) {
        throw new MomentCommerceError(
          "APPLE_PURCHASE_INTENT_AMBIGUOUS",
          "App Store recovery token maps to multiple purchase intents",
          409
        );
      }
      if (count === 0) return null;

      const row = await db.prepare(`
        SELECT purchase_id,user_id,moment_id,app_store_product_id,app_account_token,created_at,updated_at
        FROM moment_app_store_purchase_intents
        WHERE lower(app_account_token)=lower(?1)
        LIMIT 1
      `).bind(token).first();
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
    }
  });
}
