-- PRAXIS D1 Schema Migration
-- Same schema as better-sqlite3, adapted for D1

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  case_code TEXT DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT DEFAULT '',
  user_fingerprint TEXT DEFAULT '',
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed', 'wontfix')),
  resolved_note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  admin_note TEXT DEFAULT '',
  applied INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telemetry_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  time_ms INTEGER DEFAULT 0,
  user_hash TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  user_hash TEXT DEFAULT '',
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reference TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'ai_valid', 'ai_invalid', 'approved', 'rejected')),
  ai_verdict TEXT DEFAULT '{}',
  admin_note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shadowban (
  user_hash TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  strike_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feedback_case ON feedback(case_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_edits_case ON edits(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_telemetry_case ON telemetry_log(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_unique ON telemetry_log(case_id, user_hash);
CREATE INDEX IF NOT EXISTS idx_pending_case ON pending_edits(case_id);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_edits(status);
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_edits(user_hash);
