-- Birdie Moments v1 / live integration hardening
-- Print fulfillment needs the paid purchase to retain its server-validated address until order submission.

ALTER TABLE moment_purchases ADD COLUMN shipping_address_json TEXT;

CREATE TABLE IF NOT EXISTS moment_failures (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  round_id TEXT,
  moment_id TEXT,
  purchase_id TEXT,
  product_type TEXT,
  fulfillment_type TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_moment_failures_round_created
  ON moment_failures (round_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_moment_failures_moment_created
  ON moment_failures (moment_id, created_at DESC);
