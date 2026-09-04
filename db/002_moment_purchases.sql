-- Birdie Moments v1 / Phase 4
-- Digital purchase, entitlement and provider-event idempotency.

CREATE TABLE IF NOT EXISTS moment_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (
    product_type IN ('DIGITAL_ROUND', 'DIGITAL_PERSONAL_BEST', 'PRINT_A3')
  ),
  payment_reference TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')
  ),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DIGITAL', 'PRINT')),
  fulfillment_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    fulfillment_status IN ('NOT_STARTED', 'READY', 'FULFILLING', 'FULFILLED', 'FULFILLMENT_FAILED')
  ),
  fulfillment_reference TEXT,
  entitlement_granted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchase_product
  ON moment_purchases (user_id, moment_id, product_type, fulfillment_type);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchase_payment_reference
  ON moment_purchases (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_moment_purchases_user_created
  ON moment_purchases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_moment_purchases_moment
  ON moment_purchases (moment_id);

CREATE TABLE IF NOT EXISTS moment_payment_events (
  provider_event_id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_moment_payment_events_purchase
  ON moment_payment_events (purchase_id);
