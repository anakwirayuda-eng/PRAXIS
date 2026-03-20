/**
 * PRAXIS — SQLite Database Layer
 * Tables: feedback, edits, audit_log
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'praxis.db');
const DB_DIR = dirname(DB_PATH);

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// SQLite God-Mode tuning (per DeepThink)
db.pragma('journal_mode = WAL');       // Read & Write simultaneously
db.pragma('synchronous = NORMAL');     // Fast writes, safe with WAL
db.pragma('temp_store = MEMORY');      // Temp tables in RAM
db.pragma('busy_timeout = 5000');      // Queue 5s instead of throwing SQLITE_BUSY
db.pragma('foreign_keys = ON');

// ═══════════════════════════════════════
// SCHEMA MIGRATIONS
// ═══════════════════════════════════════
db.exec(`
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

  CREATE INDEX IF NOT EXISTS idx_feedback_case ON feedback(case_id);
  CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
  CREATE INDEX IF NOT EXISTS idx_edits_case ON edits(case_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

  CREATE TABLE IF NOT EXISTS telemetry_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    time_ms INTEGER DEFAULT 0,
    user_hash TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_telemetry_case ON telemetry_log(case_id);

  -- Void Spot #4: 1 user = 1 vote per case (idempotency against bot poisoning)
  CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_unique ON telemetry_log(case_id, user_hash);

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

  CREATE INDEX IF NOT EXISTS idx_pending_case ON pending_edits(case_id);
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_edits(status);
  CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_edits(user_hash);
`);

// ═══════════════════════════════════════
// PREPARED STATEMENTS
// ═══════════════════════════════════════

// Feedback
const insertFeedback = db.prepare(`
  INSERT INTO feedback (case_id, case_code, tags, comment, user_fingerprint)
  VALUES (@case_id, @case_code, @tags, @comment, @user_fingerprint)
`);

const getAllFeedback = db.prepare(`
  SELECT * FROM feedback ORDER BY created_at DESC LIMIT @limit OFFSET @offset
`);

const getFeedbackByCase = db.prepare(`
  SELECT * FROM feedback WHERE case_id = @case_id ORDER BY created_at DESC
`);

const getFeedbackById = db.prepare(`
  SELECT * FROM feedback WHERE id = @id
`);

const updateFeedbackStatus = db.prepare(`
  UPDATE feedback SET status = @status, resolved_note = @note, updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const getFeedbackStats = db.prepare(`
  SELECT 
    case_id,
    case_code,
    COUNT(*) as report_count,
    GROUP_CONCAT(DISTINCT json_each.value) as all_tags,
    MIN(created_at) as first_reported,
    MAX(created_at) as last_reported,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count
  FROM feedback, json_each(feedback.tags)
  GROUP BY case_id
  ORDER BY report_count DESC
  LIMIT @limit
`);

const countFeedback = db.prepare(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
    SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed
  FROM feedback
`);

// Edits
const insertEdit = db.prepare(`
  INSERT INTO edits (case_id, field, old_value, new_value, admin_note)
  VALUES (@case_id, @field, @old_value, @new_value, @admin_note)
`);

const getEditsByCase = db.prepare(`
  SELECT * FROM edits WHERE case_id = @case_id ORDER BY created_at DESC
`);

const getAllEdits = db.prepare(`
  SELECT * FROM edits ORDER BY created_at DESC LIMIT @limit OFFSET @offset
`);

// Audit Log
const insertAudit = db.prepare(`
  INSERT INTO audit_log (action, entity_type, entity_id, details)
  VALUES (@action, @entity_type, @entity_id, @details)
`);

const getAuditLog = db.prepare(`
  SELECT * FROM audit_log ORDER BY created_at DESC LIMIT @limit OFFSET @offset
`);

// Telemetry (IRT Point-Biserial — DeepThink #5)
const insertTelemetry = db.prepare(`
  INSERT OR IGNORE INTO telemetry_log (case_id, is_correct, time_ms, user_hash)
  VALUES (@case_id, @is_correct, @time_ms, @user_hash)
`);

// Crowdsource QA (Auto-Immune System)
const insertProposal = db.prepare(`
  INSERT INTO pending_edits (case_id, user_hash, field, old_value, new_value, reference)
  VALUES (@case_id, @user_hash, @field, @old_value, @new_value, @reference)
`);

const getPendingProposals = db.prepare(`
  SELECT * FROM pending_edits WHERE status = 'pending' OR status = 'ai_valid'
  ORDER BY created_at DESC LIMIT @limit OFFSET @offset
`);

const updateProposalStatus = db.prepare(`
  UPDATE pending_edits SET status = @status, admin_note = @note, ai_verdict = @ai_verdict
  WHERE id = @id
`);

const getProposalById = db.prepare(`
  SELECT * FROM pending_edits WHERE id = @id
`);

const countProposalsByUser = db.prepare(`
  SELECT COUNT(*) as cnt FROM pending_edits
  WHERE user_hash = @user_hash AND status = 'ai_invalid' AND created_at > datetime('now', '-7 days')
`);

const isShadowbanned = db.prepare(`
  SELECT * FROM shadowban WHERE user_hash = @user_hash
`);

const addShadowban = db.prepare(`
  INSERT OR REPLACE INTO shadowban (user_hash, reason, strike_count)
  VALUES (@user_hash, @reason, @strike_count)
`);

// ═══════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════
export {
  db,
  insertFeedback,
  getAllFeedback,
  getFeedbackByCase,
  getFeedbackById,
  updateFeedbackStatus,
  getFeedbackStats,
  countFeedback,
  insertEdit,
  getEditsByCase,
  getAllEdits,
  insertAudit,
  getAuditLog,
  insertTelemetry,
  insertProposal,
  getPendingProposals,
  updateProposalStatus,
  getProposalById,
  countProposalsByUser,
  isShadowbanned,
  addShadowban,
};
