-- Birdie Moments v1 / App Store integration
-- Digital Moment editions purchased inside the iOS app are verified StoreKit consumables.

CREATE TABLE IF NOT EXISTS moment_app_store_purchase_intents (
  purchase_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  app_store_product_id TEXT NOT NULL,
  app_account_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_moment_app_store_intents_user
  ON moment_app_store_purchase_intents (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moment_app_store_transactions (
  transaction_id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  original_transaction_id TEXT,
  app_store_product_id TEXT NOT NULL,
  app_account_token TEXT NOT NULL,
  environment TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  provider_price_milliunits INTEGER,
  provider_currency TEXT,
  purchase_date_ms INTEGER,
  signed_date_ms INTEGER,
  processed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_app_store_transaction_purchase
  ON moment_app_store_transactions (purchase_id);

CREATE INDEX IF NOT EXISTS ix_moment_app_store_transaction_product
  ON moment_app_store_transactions (app_store_product_id, processed_at DESC);
