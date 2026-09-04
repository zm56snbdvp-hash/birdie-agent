-- Birdie Moments v1 / live integration hardening
-- Phase 5 writes AWAITING_ORDER / SUBMITTED / IN_PRODUCTION / SHIPPED / DELIVERED / CANCELLED.
-- Rebuild the SQLite/D1 table so those real print states satisfy the CHECK constraint.

ALTER TABLE moment_purchases RENAME TO moment_purchases_before_print_statuses;

CREATE TABLE moment_purchases (
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
    fulfillment_status IN (
      'NOT_STARTED',
      'READY',
      'AWAITING_ORDER',
      'SUBMITTED',
      'IN_PRODUCTION',
      'SHIPPED',
      'DELIVERED',
      'FULFILLING',
      'FULFILLED',
      'FULFILLMENT_FAILED',
      'CANCELLED'
    )
  ),
  fulfillment_reference TEXT,
  entitlement_granted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO moment_purchases (
  id, user_id, moment_id, product_type, payment_reference, payment_status,
  amount_minor, currency, fulfillment_type, fulfillment_status,
  fulfillment_reference, entitlement_granted_at, created_at, updated_at
)
SELECT
  id, user_id, moment_id, product_type, payment_reference, payment_status,
  amount_minor, currency, fulfillment_type, fulfillment_status,
  fulfillment_reference, entitlement_granted_at, created_at, updated_at
FROM moment_purchases_before_print_statuses;

DROP TABLE moment_purchases_before_print_statuses;

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchase_product
  ON moment_purchases (user_id, moment_id, product_type, fulfillment_type);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_purchase_payment_reference
  ON moment_purchases (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_moment_purchases_user_created
  ON moment_purchases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_moment_purchases_moment
  ON moment_purchases (moment_id);
