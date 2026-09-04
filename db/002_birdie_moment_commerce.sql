-- Birdie Moments v1 — checkout, payment, entitlement and exactly-once print intent.

CREATE TABLE IF NOT EXISTS moment_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN (
    'BM-ROUND-DIGITAL-V1',
    'BM-PB-DIGITAL-V1',
    'BM-ROUND-A3-V1',
    'BM-PB-A3-V1'
  )),
  payment_provider TEXT NOT NULL,
  checkout_reference TEXT,
  payment_reference TEXT,
  payment_status TEXT NOT NULL CHECK (
    payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')
  ),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DIGITAL', 'PRINT')),
  fulfillment_status TEXT NOT NULL CHECK (fulfillment_status IN (
    'PENDING', 'AWAITING_ORDER', 'FULFILLING', 'FULFILLED', 'FULFILLMENT_FAILED'
  )),
  fulfillment_reference TEXT,
  shipping_address TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(moment_id) REFERENCES birdie_moments(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchases_idempotency
  ON moment_purchases (user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchases_checkout_reference
  ON moment_purchases (payment_provider, checkout_reference)
  WHERE checkout_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchases_payment_reference
  ON moment_purchases (payment_provider, payment_reference)
  WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_moment_purchases_user_created
  ON moment_purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_moment_purchases_moment
  ON moment_purchases (moment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moment_payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  purchase_id TEXT,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id),
  FOREIGN KEY(purchase_id) REFERENCES moment_purchases(id)
);

CREATE TABLE IF NOT EXISTS moment_print_orders (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'GELATO'),
  idempotency_key TEXT NOT NULL,
  provider_order_reference TEXT,
  status TEXT NOT NULL DEFAULT 'CLAIMED',
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(purchase_id) REFERENCES moment_purchases(id),
  FOREIGN KEY(moment_id) REFERENCES birdie_moments(id)
);

-- One physical provider intent per paid purchase. Retries reuse this row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_purchase
  ON moment_print_orders (purchase_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_idempotency
  ON moment_print_orders (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_provider_reference
  ON moment_print_orders (provider_order_reference)
  WHERE provider_order_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS moment_fulfillment_webhooks (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  print_order_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id),
  FOREIGN KEY(print_order_id) REFERENCES moment_print_orders(id)
);
