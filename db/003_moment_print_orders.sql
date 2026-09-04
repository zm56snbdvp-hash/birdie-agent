-- Birdie Moments v1 / Phase 5
-- One print order per paid print purchase. Provider events are idempotent.

CREATE TABLE IF NOT EXISTS moment_print_orders (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type = 'PRINT_A3'),
  provider_name TEXT NOT NULL,
  provider_order_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING_SUBMISSION','SUBMITTED','IN_PRODUCTION','SHIPPED','DELIVERED','FULFILLMENT_FAILED','CANCELLED')
  ),
  recipient_name TEXT NOT NULL,
  address_json TEXT NOT NULL,
  print_asset TEXT NOT NULL,
  internal_order_key TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_purchase
  ON moment_print_orders (purchase_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_internal_key
  ON moment_print_orders (internal_order_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_moment_print_orders_provider_order
  ON moment_print_orders (provider_name, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS moment_print_provider_events (
  provider_name TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_order_id TEXT,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (provider_name, provider_event_id)
);
