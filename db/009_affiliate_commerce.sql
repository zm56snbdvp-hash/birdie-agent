-- Birdie Smart Shop v1 / zero-inventory affiliate attribution

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  network TEXT NOT NULL,
  advertiser_id TEXT,
  category TEXT,
  placement TEXT NOT NULL,
  network_click_ref TEXT,
  tracking_consent INTEGER CHECK (tracking_consent IN (0,1)),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_affiliate_clicks_user_time
  ON affiliate_clicks (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_affiliate_clicks_network_ref
  ON affiliate_clicks (network, network_click_ref);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  network TEXT NOT NULL,
  network_transaction_id TEXT NOT NULL,
  click_id TEXT,
  advertiser_id TEXT,
  status TEXT NOT NULL,
  sale_amount TEXT,
  sale_currency TEXT,
  commission_amount TEXT,
  commission_currency TEXT,
  transaction_at TEXT,
  validation_at TEXT,
  transaction_type TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (network, network_transaction_id),
  FOREIGN KEY (click_id) REFERENCES affiliate_clicks(id)
);

CREATE INDEX IF NOT EXISTS ix_affiliate_conversions_click
  ON affiliate_conversions (click_id);

CREATE INDEX IF NOT EXISTS ix_affiliate_conversions_status_time
  ON affiliate_conversions (status, transaction_at DESC);
