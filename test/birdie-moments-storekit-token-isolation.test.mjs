import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SQLiteD1TestDatabase } from "./helpers/sqlite-d1.mjs";

const migrations = [
  "001_birdie_moments.sql",
  "002_moment_purchases.sql",
  "003_moment_print_orders.sql",
  "004_expand_purchase_fulfillment_status.sql",
  "005_moment_app_store_iap.sql",
  "006_purchase_shipping_and_failures.sql",
  "007_unique_app_store_purchase_tokens.sql"
];

function migrate(db) {
  for (const file of migrations) {
    db.exec(readFileSync(new URL(`../db/${file}`, import.meta.url), "utf8"));
  }
}

test("complete migration chain enforces one appAccountToken per Moment purchase intent", () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    const token = "123e4567-e89b-42d3-a456-426614174000";
    db.exec(`INSERT INTO moment_app_store_purchase_intents
      (purchase_id,user_id,moment_id,app_store_product_id,app_account_token,created_at,updated_at)
      VALUES ('p1','u1','m1','configured.round','${token}','t','t')`);

    assert.throws(() => {
      db.exec(`INSERT INTO moment_app_store_purchase_intents
        (purchase_id,user_id,moment_id,app_store_product_id,app_account_token,created_at,updated_at)
        VALUES ('p2','u1','m2','configured.round','${token}','t','t')`);
    }, /UNIQUE/i);
  } finally {
    db.close();
  }
});
