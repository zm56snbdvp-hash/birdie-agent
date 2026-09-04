import { MomentCommerceError } from "../commerce/contracts.mjs";

function userIdFrom(user) {
  const id = user?.id ?? user?.userId;
  if (typeof id !== "string" || !id.trim()) {
    throw new MomentCommerceError("AUTH_REQUIRED", "Authenticated user id is required", 401);
  }
  return id.trim();
}

export function createD1AppAccountTokenProvider({
  db,
  uuidFactory = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString()
}) {
  if (!db?.prepare) throw new TypeError("D1 database is required");

  return Object.freeze({
    async getOrCreateForUser(user) {
      const userId = userIdFrom(user);
      const existing = await db.prepare(`
        SELECT app_account_token FROM moment_app_store_account_tokens WHERE user_id=?1 LIMIT 1
      `).bind(userId).first();
      if (existing?.app_account_token) return existing.app_account_token;

      const token = uuidFactory();
      await db.prepare(`
        INSERT OR IGNORE INTO moment_app_store_account_tokens (user_id,app_account_token,created_at)
        VALUES (?1,?2,?3)
      `).bind(userId, token, now()).run();

      const persisted = await db.prepare(`
        SELECT app_account_token FROM moment_app_store_account_tokens WHERE user_id=?1 LIMIT 1
      `).bind(userId).first();
      if (!persisted?.app_account_token) {
        throw new MomentCommerceError("APPLE_ACCOUNT_TOKEN_CREATE_FAILED", "Could not persist App Store account token", 503);
      }
      return persisted.app_account_token;
    }
  });
}
