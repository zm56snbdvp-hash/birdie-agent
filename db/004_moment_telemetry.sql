-- Birdie Moments v1 Phase 6: idempotent analytics + redacted failure records.
CREATE TABLE IF NOT EXISTS moment_analytics_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_analytics_name_at ON moment_analytics_events(event_name, recorded_at);

CREATE TABLE IF NOT EXISTS moment_failures (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  code TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  round_id TEXT,
  moment_id TEXT,
  purchase_id TEXT,
  product_type TEXT,
  fulfillment_type TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_failures_stage_at ON moment_failures(stage, occurred_at);
CREATE INDEX IF NOT EXISTS idx_moment_failures_moment ON moment_failures(moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_failures_purchase ON moment_failures(purchase_id);
