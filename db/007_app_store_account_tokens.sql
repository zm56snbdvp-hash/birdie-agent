-- Stable server-issued StoreKit appAccountToken per BirdieWorld user.
CREATE TABLE IF NOT EXISTS moment_app_store_account_tokens (
  user_id TEXT PRIMARY KEY,
  app_account_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
