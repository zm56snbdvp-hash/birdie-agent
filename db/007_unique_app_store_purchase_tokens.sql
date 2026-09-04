-- Birdie Moments v1 / StoreKit hardening
-- Each consumable purchase intent receives its own appAccountToken so a transaction maps to exactly one Moment purchase.
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_app_store_intent_account_token
  ON moment_app_store_purchase_intents (app_account_token);
