import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { applyResolvedCategory } from '../src/data/categoryResolution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'server', 'data', 'casebank.db');
const REPORT_DIR = join(__dirname, 'output');

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function normalizeMeta(caseRow, options) {
  const meta = JSON.parse(caseRow.meta_json || '{}');
  const vignette = JSON.parse(caseRow.vignette_json || '{}');

  return {
    case_id: caseRow.case_id,
    case_code: caseRow.case_code,
    source: caseRow.source || meta.source || '',
    category: caseRow.category,
    title: caseRow.title,
    prompt: caseRow.prompt,
    subject: caseRow.subject,
    topic: caseRow.topic,
    vignette,
    options: options.map((option) => ({
      option_id: option.option_id,
      option_text: option.option_text,
      text: option.option_text,
      is_correct: option.is_correct === 1,
    })),
    meta: {
      ...meta,
      source: meta.source || caseRow.source || '',
      subject: meta.subject || caseRow.subject || '',
      topic: meta.topic || caseRow.topic || '',
    },
  };
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const caseRows = db.prepare(`
    SELECT case_id, case_code, category, title, prompt, source, subject, topic, meta_json, vignette_json
    FROM cases
    ORDER BY case_id
  `).all();

  const optionRows = db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    ORDER BY case_id, sort_order
  `).all();

  const optionsByCaseId = new Map();
  for (const option of optionRows) {
    const list = optionsByCaseId.get(option.case_id) || [];
    list.push(option);
    optionsByCaseId.set(option.case_id, list);
  }

  const updateCase = db.prepare(`
    UPDATE cases
    SET category = ?, meta_json = ?
    WHERE case_id = ?
  `);

  const audit = {
    total_cases: caseRows.length,
    updated_rows: 0,
    category_changed_from_raw: 0,
    metadata_updated_only: 0,
    review_needed: 0,
    unchanged: 0,
    changed_by_source: {},
    category_changed_by_source: {},
    final_category_counts: {},
    top_changes: {},
  };
  const reviewQueue = [];

  const apply = db.transaction(() => {
    for (const row of caseRows) {
      const options = optionsByCaseId.get(row.case_id) || [];
      const originalMeta = JSON.parse(row.meta_json || '{}');
      const originalCategory = row.category;
      const priorRawCategory = originalMeta?.category_resolution?.raw_category || originalCategory;

      const updated = applyResolvedCategory(normalizeMeta(row, options));
      const nextMetaJson = JSON.stringify(updated.meta || {});
      const nextCategory = updated.category || originalCategory;

      audit.final_category_counts[nextCategory] = (audit.final_category_counts[nextCategory] || 0) + 1;

      if (updated.meta?.category_review_needed) {
        audit.review_needed += 1;
        reviewQueue.push({
          case_id: row.case_id,
          case_code: row.case_code,
          source: row.source,
          title: row.title,
          raw_category: originalCategory,
          final_category: nextCategory,
          confidence: updated.meta.category_resolution?.confidence || 'low',
          winning_signals: updated.meta.category_resolution?.winning_signals || [],
        });
      }

      const categoryChanged = nextCategory !== originalCategory;
      const metaChanged = stableStringify(updated.meta || {}) !== stableStringify(originalMeta);
      const changedFromRaw = nextCategory !== priorRawCategory;

      if (changedFromRaw) {
        audit.category_changed_from_raw += 1;
        audit.category_changed_by_source[row.source || 'UNKNOWN'] = (audit.category_changed_by_source[row.source || 'UNKNOWN'] || 0) + 1;
        const key = `${priorRawCategory || '<missing>'} -> ${nextCategory}`;
        audit.top_changes[key] = (audit.top_changes[key] || 0) + 1;
      }

      if (categoryChanged || metaChanged) {
        updateCase.run(nextCategory, nextMetaJson, row.case_id);
        audit.updated_rows += 1;
        audit.changed_by_source[row.source || 'UNKNOWN'] = (audit.changed_by_source[row.source || 'UNKNOWN'] || 0) + 1;
        if (!changedFromRaw) {
          audit.metadata_updated_only += 1;
        }
      } else {
        audit.unchanged += 1;
      }
    }
  });

  apply();

  mkdirSync(REPORT_DIR, { recursive: true });
  writeJsonAtomic(join(REPORT_DIR, 'category_resolution_sqlite_audit.json'), {
    ...audit,
    changed_by_source: Object.entries(audit.changed_by_source)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
    category_changed_by_source: Object.entries(audit.category_changed_by_source)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
    top_changes: Object.entries(audit.top_changes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([change, count]) => ({ change, count })),
    final_category_counts: Object.entries(audit.final_category_counts)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count })),
  });
  writeJsonAtomic(join(REPORT_DIR, 'category_resolution_sqlite_review_queue.json'), reviewQueue);

  console.log('Category resolution synced to SQLite');
  console.log(`Cases processed: ${audit.total_cases.toLocaleString()}`);
  console.log(`Rows updated: ${audit.updated_rows.toLocaleString()}`);
  console.log(`Categories changed from raw: ${audit.category_changed_from_raw.toLocaleString()}`);
  console.log(`Review needed: ${audit.review_needed.toLocaleString()}`);
  console.log(`Audit: ${join(REPORT_DIR, 'category_resolution_sqlite_audit.json')}`);
  console.log(`Review queue: ${join(REPORT_DIR, 'category_resolution_sqlite_review_queue.json')}`);
}

main();
