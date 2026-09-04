-- Birdie Moments v1 core schema.
-- SQLite / Cloudflare-D1-compatible surface; IDs generated application-side.

CREATE TABLE IF NOT EXISTS birdie_moments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  moment_type TEXT NOT NULL CHECK (moment_type IN ('ROUND', 'PERSONAL_BEST')),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'GENERATING', 'PREVIEW_READY', 'PURCHASED', 'FULFILLED', 'FAILED')
  ),
  template_version TEXT NOT NULL,
  render_data TEXT NOT NULL,
  thumbnail_asset TEXT,
  preview_asset TEXT,
  digital_asset TEXT,
  print_asset TEXT,
  is_personal_best INTEGER NOT NULL DEFAULT 0 CHECK (is_personal_best IN (0, 1)),
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_birdie_moments_round_type_template
  ON birdie_moments (round_id, moment_type, template_version);
CREATE INDEX IF NOT EXISTS ix_birdie_moments_user_created
  ON birdie_moments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_birdie_moments_round
  ON birdie_moments (round_id);
