import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CASEBANK_DB_PATH = process.env.CASEBANK_DB_PATH || join(__dirname, 'data', 'casebank.db');
export const CASEBANK_SCHEMA_VERSION = 3;

function ensureDbDirectory(dbPath) {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
}

export function applyCasebankPragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

export function migrateCasebankSchema(db) {
  const hasMetaTable = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'casebank_meta'
  `).get().count > 0;

  let currentSchemaVersion = 0;
  if (hasMetaTable) {
    const row = db.prepare(`SELECT value FROM casebank_meta WHERE key = 'schema_version'`).get();
    currentSchemaVersion = Number(row?.value || 0);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS casebank_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_size_bytes INTEGER NOT NULL,
      total_cases INTEGER NOT NULL DEFAULT 0,
      total_options INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('running', 'complete', 'failed')),
      notes TEXT DEFAULT '',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(status);
    CREATE INDEX IF NOT EXISTS idx_import_runs_started_at ON import_runs(started_at);
  `);

  if (currentSchemaVersion > 0 && currentSchemaVersion < CASEBANK_SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS case_options;
      DROP TABLE IF EXISTS cases;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      case_id INTEGER PRIMARY KEY,
      case_code TEXT NOT NULL UNIQUE,
      hash_id TEXT,
      q_type TEXT,
      confidence REAL,
      category TEXT,
      title TEXT,
      prompt TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      subject TEXT DEFAULT '',
      topic TEXT DEFAULT '',
      exam_type TEXT DEFAULT '',
      difficulty INTEGER,
      original_difficulty REAL,
      quality_score REAL,
      negative_stem INTEGER NOT NULL DEFAULT 0 CHECK (negative_stem IN (0, 1)),
      option_count INTEGER NOT NULL DEFAULT 0,
      answer_anchor_text TEXT DEFAULT '',
      meta_status TEXT DEFAULT '',
      clinical_consensus TEXT DEFAULT '',
      t9_verified INTEGER NOT NULL DEFAULT 0 CHECK (t9_verified IN (0, 1)),
      t10_verified INTEGER NOT NULL DEFAULT 0 CHECK (t10_verified IN (0, 1)),
      vignette_json TEXT NOT NULL,
      rationale_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      imported_from_run_id INTEGER REFERENCES import_runs(id) ON DELETE SET NULL,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cases_hash_id ON cases(hash_id);
    CREATE INDEX IF NOT EXISTS idx_cases_source ON cases(source);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(meta_status);
    CREATE INDEX IF NOT EXISTS idx_cases_consensus ON cases(clinical_consensus);
    CREATE INDEX IF NOT EXISTS idx_cases_t9_verified ON cases(t9_verified);
    CREATE INDEX IF NOT EXISTS idx_cases_t10_verified ON cases(t10_verified);

    CREATE TABLE IF NOT EXISTS case_options (
      case_id INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
      option_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
      PRIMARY KEY (case_id, sort_order)
    );

    CREATE INDEX IF NOT EXISTS idx_case_options_case_id ON case_options(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_options_correct ON case_options(case_id, is_correct);
  `);

  const upsertMeta = db.prepare(`
    INSERT INTO casebank_meta (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  upsertMeta.run({ key: 'schema_version', value: String(CASEBANK_SCHEMA_VERSION) });
}

export function openCasebankDb(dbPath = CASEBANK_DB_PATH) {
  ensureDbDirectory(dbPath);
  const db = new Database(dbPath);
  applyCasebankPragmas(db);
  migrateCasebankSchema(db);
  return db;
}
