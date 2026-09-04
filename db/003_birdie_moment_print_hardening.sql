-- Birdie Moments v1 — print exactly-once hardening.
-- These fields support an atomic short submission lease so two workers cannot
-- race between provider reconciliation and provider create.

ALTER TABLE moment_print_orders ADD COLUMN provider_status TEXT;
ALTER TABLE moment_print_orders ADD COLUMN submission_lease_key TEXT;
ALTER TABLE moment_print_orders ADD COLUMN submission_lease_until TEXT;
ALTER TABLE moment_print_orders ADD COLUMN submission_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_moment_print_orders_submission_lease
  ON moment_print_orders (submission_lease_until);
