import { createHash } from 'crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

import { CASEBANK_DB_PATH, openCasebankDb } from '../server/casebank-db.js';

const SOURCE_PATH = resolve(process.cwd(), process.argv[2] || 'public/data/compiled_cases.json');
const REPORT_PATH = resolve(process.cwd(), 'ingestion/output/casebank_import_report.json');

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function asJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function asIntFlag(value) {
  return value ? 1 : 0;
}

function ensureOutputDirectory(reportPath) {
  const outputDir = dirname(reportPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
}

const compiledCases = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
const sourceStat = statSync(SOURCE_PATH);
const sourceSha = sha256File(SOURCE_PATH);
const totalOptions = compiledCases.reduce((sum, item) => sum + (item.options?.length || 0), 0);

console.log('CASEBANK SQLITE IMPORT');
console.log(`Source: ${SOURCE_PATH}`);
console.log(`Cases:  ${compiledCases.length}`);
console.log(`Options:${totalOptions}`);

const db = openCasebankDb(CASEBANK_DB_PATH);

const insertRun = db.prepare(`
  INSERT INTO import_runs (
    source_path,
    source_sha256,
    source_size_bytes,
    total_cases,
    total_options,
    status,
    notes
  ) VALUES (
    @source_path,
    @source_sha256,
    @source_size_bytes,
    @total_cases,
    @total_options,
    'running',
    @notes
  )
`);

const updateRunStatus = db.prepare(`
  UPDATE import_runs
  SET
    status = @status,
    notes = @notes,
    completed_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const upsertMeta = db.prepare(`
  INSERT INTO casebank_meta (key, value, updated_at)
  VALUES (@key, @value, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP
`);

const insertCase = db.prepare(`
  INSERT INTO cases (
    case_id,
    case_code,
    hash_id,
    q_type,
    confidence,
    category,
    title,
    prompt,
    source,
    subject,
    topic,
    exam_type,
    difficulty,
    original_difficulty,
    quality_score,
    negative_stem,
    option_count,
    answer_anchor_text,
    meta_status,
    clinical_consensus,
    t9_verified,
    t10_verified,
    vignette_json,
    rationale_json,
    meta_json,
    validation_json,
    imported_from_run_id
  ) VALUES (
    @case_id,
    @case_code,
    @hash_id,
    @q_type,
    @confidence,
    @category,
    @title,
    @prompt,
    @source,
    @subject,
    @topic,
    @exam_type,
    @difficulty,
    @original_difficulty,
    @quality_score,
    @negative_stem,
    @option_count,
    @answer_anchor_text,
    @meta_status,
    @clinical_consensus,
    @t9_verified,
    @t10_verified,
    @vignette_json,
    @rationale_json,
    @meta_json,
    @validation_json,
    @imported_from_run_id
  )
`);

const insertOption = db.prepare(`
  INSERT INTO case_options (
    case_id,
    option_id,
    sort_order,
    option_text,
    is_correct
  ) VALUES (
    @case_id,
    @option_id,
    @sort_order,
    @option_text,
    @is_correct
  )
`);

const importRun = insertRun.run({
  source_path: SOURCE_PATH,
  source_sha256: sourceSha,
  source_size_bytes: sourceStat.size,
  total_cases: compiledCases.length,
  total_options: totalOptions,
  notes: 'Phase 1 JSON -> SQLite shadow import',
});

const runId = Number(importRun.lastInsertRowid);

const replaceSnapshot = db.transaction((items) => {
  db.exec('DELETE FROM case_options; DELETE FROM cases;');

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const meta = item.meta || {};

    insertCase.run({
      case_id: item._id,
      case_code: item.case_code,
      hash_id: item.hash_id ?? null,
      q_type: item.q_type ?? null,
      confidence: item.confidence ?? null,
      category: item.category ?? null,
      title: item.title ?? null,
      prompt: item.prompt ?? '',
      source: meta.source ?? '',
      subject: meta.subject ?? '',
      topic: meta.topic ?? '',
      exam_type: meta.examType ?? '',
      difficulty: meta.difficulty ?? null,
      original_difficulty: meta.original_difficulty ?? null,
      quality_score: meta.quality_score ?? null,
      negative_stem: asIntFlag(meta.negative_stem),
      option_count: meta.option_count ?? item.options?.length ?? 0,
      answer_anchor_text: meta.answer_anchor_text ?? '',
      meta_status: meta.status ?? '',
      clinical_consensus: meta.clinical_consensus ?? '',
      t9_verified: asIntFlag(meta._openclaw_t9_v2 || meta._openclaw_t9_verified),
      t10_verified: asIntFlag(meta._openclaw_t10_verified),
      vignette_json: asJson(item.vignette, {}),
      rationale_json: asJson(item.rationale, {}),
      meta_json: asJson(meta, {}),
      validation_json: asJson(item.validation, {}),
      imported_from_run_id: runId,
    });

    for (let optionIndex = 0; optionIndex < (item.options || []).length; optionIndex++) {
      const option = item.options[optionIndex];
      insertOption.run({
        case_id: item._id,
        option_id: String(option.id ?? optionIndex + 1),
        sort_order: optionIndex,
        option_text: option.text ?? '',
        is_correct: asIntFlag(option.is_correct),
      });
    }

    if ((index + 1) % 5000 === 0) {
      console.log(`Imported ${index + 1}/${items.length} cases...`);
    }
  }
});

const report = {
  sourcePath: SOURCE_PATH,
  dbPath: CASEBANK_DB_PATH,
  runId,
  sourceSha256: sourceSha,
  sourceSizeBytes: sourceStat.size,
  totalCases: compiledCases.length,
  totalOptions,
  completed: false,
};

try {
  replaceSnapshot(compiledCases);

  updateRunStatus.run({
    id: runId,
    status: 'complete',
    notes: 'Import completed successfully',
  });

  upsertMeta.run({ key: 'last_import_run_id', value: String(runId) });
  upsertMeta.run({ key: 'last_import_source_path', value: SOURCE_PATH });
  upsertMeta.run({ key: 'last_import_source_sha256', value: sourceSha });
  upsertMeta.run({ key: 'last_import_total_cases', value: String(compiledCases.length) });
  upsertMeta.run({ key: 'last_import_total_options', value: String(totalOptions) });

  db.pragma('wal_checkpoint(TRUNCATE)');

  report.completed = true;
  report.completedAt = new Date().toISOString();
  ensureOutputDirectory(REPORT_PATH);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Import completed into ${CASEBANK_DB_PATH}`);
} catch (error) {
  updateRunStatus.run({
    id: runId,
    status: 'failed',
    notes: error.message,
  });

  report.completed = false;
  report.error = error.message;
  ensureOutputDirectory(REPORT_PATH);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  throw error;
} finally {
  db.close();
}
