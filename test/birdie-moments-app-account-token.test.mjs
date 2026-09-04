import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SQLiteD1TestDatabase } from "./helpers/sqlite-d1.mjs";
import { createD1AppAccountTokenProvider } from "../src/moments/integration/d1-app-account-token.mjs";

const migrations = [
  "001_birdie_moments.sql",
  "002_moment_purchases.sql",
  "003_moment_print_orders.sql",
  "004_expand_purchase_fulfillment_status.sql",
  "005_moment_app_store_iap.sql",
  "006_purchase_shipping_and_failures.sql",
  "007_app_store_account_tokens.sql"
];

function migrate(db) {
  for (const file of migrations) {
    db.exec(readFileSync(new URL(`../db/${file}`, import.meta.url), "utf8"));
  }
}

test("server persists one stable appAccountToken per BirdieWorld user", async () => {
  const db = new SQLiteD1TestDatabase();
  try {
    migrate(db);
    let sequence = 0;
    const provider = createD1AppAccountTokenProvider({
      db,
      uuidFactory: () => `123e4567-e89b-42d3-a456-42661417400${sequence++}`,
      now: () => "2026-09-04T01:30:00Z"
    });
    const first = await provider.getOrCreateForUser({ id: "u1" });
    const second = await provider.getOrCreateForUser({ id: "u1" });
    const other = await provider.getOrCreateForUser({ id: "u2" });
    assert.equal(first, second);
    assert.notEqual(first, other);
    const count = db.sqlite.prepare("SELECT COUNT(*) AS count FROM moment_app_store_account_tokens").get().count;
    assert.equal(Number(count), 2);
  } finally {
    db.close();
  }
});
