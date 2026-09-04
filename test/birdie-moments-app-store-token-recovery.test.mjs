import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SQLiteD1TestDatabase } from "./helpers/sqlite-d1.mjs";
import { createD1AppStoreIntentLookup } from "../src/moments/persistence/d1-app-store-intent-lookup.mjs";

const migration005 = readFileSync(new URL("../db/005_moment_app_store_iap.sql", import.meta.url), "utf8");
const migration008 = readFileSync(new URL("../db/008_unique_app_store_purchase_tokens.sql", import.meta.url), "utf8");

function insertIntent(db, { purchaseId, userId, momentId, token }) {
  db.exec(`INSERT INTO moment_app_store_purchase_intents (
    purchase_id,user_id,moment_id,app_store_product_id,app_account_token,created_at,updated_at
  ) VALUES ('${purchaseId}','${userId}','${momentId}','configured.round','${token}','t','t')`);
}

test("App Store purchase recovery tokens are unique per intent", () => {
  const db = new SQLiteD1TestDatabase();
  try {
    db.exec(migration005);
    db.exec(migration008);
    const token = "123e4567-e89b-42d3-a456-426614174000";
    insertIntent(db, { purchaseId: "p1", userId: "u1", momentId: "m1", token });
    assert.throws(
      () => insertIntent(db, { purchaseId: "p2", userId: "u1", momentId: "m2", token }),
      /UNIQUE constraint failed|unique/i
    );
  } finally {
    db.close();
  }
});

test("legacy duplicate recovery tokens fail closed instead of choosing an arbitrary Moment", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    db.exec(migration005);
    const token = "123e4567-e89b-42d3-a456-426614174000";
    insertIntent(db, { purchaseId: "p1", userId: "u1", momentId: "m1", token });
    insertIntent(db, { purchaseId: "p2", userId: "u1", momentId: "m2", token });
    const lookup = createD1AppStoreIntentLookup({ db });
    await assert.rejects(
      lookup.getByAppAccountToken(token),
      (error) => error?.code === "APPLE_PURCHASE_INTENT_AMBIGUOUS" && error?.status === 409
    );
  } finally {
    db.close();
  }
});
