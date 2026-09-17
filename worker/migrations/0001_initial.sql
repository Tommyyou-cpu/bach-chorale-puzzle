-- Cloudflare D1 schema for the Bach puzzle Worker.
-- 题库内容由 worker/scripts/seed-questions.mjs 导入，避免在迁移中复制大段 JSON。

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('chorale', 'fugue', 'other')),
  voice_count INTEGER NOT NULL CHECK (voice_count IN (3, 4)),
  voice_order_json TEXT NOT NULL CHECK (json_valid(voice_order_json)),
  voice_labels_json TEXT NOT NULL CHECK (json_valid(voice_labels_json)),
  clefs_json TEXT NOT NULL CHECK (json_valid(clefs_json)),
  key_signature TEXT NOT NULL DEFAULT '',
  time_signature TEXT NOT NULL DEFAULT '',
  bwv TEXT NOT NULL DEFAULT '',
  measures TEXT NOT NULL DEFAULT '',
  measure_start INTEGER,
  measure_end INTEGER,
  duration REAL,
  bpm INTEGER,
  source TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '',
  license_note TEXT NOT NULL DEFAULT '',
  source_edition TEXT NOT NULL DEFAULT '',
  source_license TEXT NOT NULL DEFAULT '',
  max_rest_by_voice_json TEXT NOT NULL DEFAULT '{}',
  voices_json TEXT NOT NULL CHECK (json_valid(voices_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS questions_enabled_genre_order_idx
  ON questions (enabled, genre, sort_order, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value_json, revision)
VALUES (
  'game_rules',
  '{"questionsPerGame":3,"allocation":{"chorale":1,"fugue":1,"other":1},"scoreWeights":{"completeQuestion":40,"voiceAccuracy":60},"revision":1}',
  1
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE BINARY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  question_json TEXT NOT NULL CHECK (json_valid(question_json)),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  score_json TEXT CHECK (score_json IS NULL OR json_valid(score_json))
);

CREATE INDEX IF NOT EXISTS game_sessions_expiry_idx ON game_sessions (expires_at);

