-- Birdie Moments v1 / App Store recovery hardening
-- Each StoreKit purchase intent must have a unique appAccountToken so an
-- unfinished consumable can be recovered without an ambiguous Moment lookup.

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_app_store_intents_account_token
  ON moment_app_store_purchase_intents (lower(app_account_token));
