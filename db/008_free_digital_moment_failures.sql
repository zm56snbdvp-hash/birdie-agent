-- Birdie Moments Digital v1 / Founder Delta
-- Independent failure ledger for the free/private Digital flow.
-- Numbered 008 deliberately to avoid collisions with the existing Phase 5/6 migration line.

CREATE TABLE IF NOT EXISTS moment_failures (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  round_id TEXT,
  moment_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_moment_failures_round_created
  ON moment_failures (round_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_moment_failures_moment_created
  ON moment_failures (moment_id, created_at DESC);
