import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(ROOT, 'ingestion', 'output', 'display_text_source_fixes_report.json');

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonAtomically(filePath, value, pretty = true) {
  ensureDir(dirname(filePath));
  const tempFile = `${filePath}.tmp`;
  const payload = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);

  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!error || error.code !== 'EPERM') {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    unlinkSync(tempFile);
  }
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureObject(holder, key, fallback = {}) {
  if (!holder[key] || typeof holder[key] !== 'object' || Array.isArray(holder[key])) {
    holder[key] = fallback;
  }
  return holder[key];
}

function registerChange(stats, fieldPath, caseRecord, before, after) {
  const source = normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || 'unknown');
  stats.changed = true;
  stats.fieldChanges += 1;
  stats.fields[fieldPath] = (stats.fields[fieldPath] || 0) + 1;
  stats.sources[source] = (stats.sources[source] || 0) + 1;

  if (stats.samples.length < 40) {
    stats.samples.push({
      _id: caseRecord?._id ?? null,
      case_code: caseRecord?.case_code ?? '',
      source,
      field: fieldPath,
      before: normalizeWhitespace(before).slice(0, 180),
      after: normalizeWhitespace(after).slice(0, 180),
    });
  }
}

function normalizeStringField(holder, key, fieldPath, caseRecord, stats) {
  if (!holder || typeof holder[key] !== 'string') {
    return;
  }

  const before = holder[key];
  const after = normalizeDisplayText(before);
  if (after !== before) {
    holder[key] = after;
    registerChange(stats, fieldPath, caseRecord, before, after);
  }
}

function normalizeStringArrayField(holder, key, fieldPath, caseRecord, stats) {
  if (!holder || !Array.isArray(holder[key])) {
    return;
  }

  const nextValues = holder[key].map((value) => (
    typeof value === 'string' ? normalizeDisplayText(value) : value
  ));

  if (JSON.stringify(nextValues) !== JSON.stringify(holder[key])) {
    const before = JSON.stringify(holder[key]);
    holder[key] = nextValues;
    registerChange(stats, fieldPath, caseRecord, before, JSON.stringify(nextValues));
  }
}

function normalizeDistractors(distractors, caseRecord, stats) {
  if (!distractors || typeof distractors !== 'object' || Array.isArray(distractors)) {
    return;
  }

  for (const [key, value] of Object.entries(distractors)) {
    if (typeof value !== 'string') {
      continue;
    }
    const after = normalizeDisplayText(value);
    if (after !== value) {
      distractors[key] = after;
      registerChange(stats, `rationale.distractors.${key}`, caseRecord, value, after);
    }
  }
}

function normalizeOptions(options, caseRecord, stats) {
  if (!Array.isArray(options)) {
    return;
  }

  for (let index = 0; index < options.length; index += 1) {
    normalizeStringField(options[index], 'text', `options.${index}.text`, caseRecord, stats);
  }
}

function normalizeVignette(caseRecord, stats) {
  if (typeof caseRecord.vignette === 'string') {
    const before = caseRecord.vignette;
    const after = normalizeDisplayText(before);
    if (after !== before) {
      caseRecord.vignette = after;
      registerChange(stats, 'vignette', caseRecord, before, after);
    }
    return;
  }

  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object' || Array.isArray(caseRecord.vignette)) {
    return;
  }

  normalizeStringField(caseRecord.vignette, 'narrative', 'vignette.narrative', caseRecord, stats);
  normalizeStringField(caseRecord.vignette, 'labFindings', 'vignette.labFindings', caseRecord, stats);
}

function normalizeRationale(caseRecord, stats) {
  if (typeof caseRecord.rationale === 'string') {
    const before = caseRecord.rationale;
    const after = normalizeDisplayText(before);
    if (after !== before) {
      caseRecord.rationale = after;
      registerChange(stats, 'rationale', caseRecord, before, after);
    }
    return;
  }

  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    return;
  }

  normalizeStringField(caseRecord.rationale, 'correct', 'rationale.correct', caseRecord, stats);
  normalizeStringField(caseRecord.rationale, 'pearl', 'rationale.pearl', caseRecord, stats);
  normalizeDistractors(caseRecord.rationale.distractors, caseRecord, stats);
}

function normalizeCaseRecord(caseRecord) {
  const stats = {
    changed: false,
    fieldChanges: 0,
    fields: {},
    sources: {},
    samples: [],
  };

  normalizeStringField(caseRecord, 'title', 'title', caseRecord, stats);
  normalizeStringField(caseRecord, 'prompt', 'prompt', caseRecord, stats);
  normalizeStringField(caseRecord, 'question', 'question', caseRecord, stats);

  normalizeVignette(caseRecord, stats);
  normalizeRationale(caseRecord, stats);
  normalizeOptions(caseRecord.options, caseRecord, stats);

  const meta = ensureObject(caseRecord, 'meta', {});
  normalizeStringArrayField(meta, 'tags', 'meta.tags', caseRecord, stats);

  return stats;
}

function summarizeRuns(items) {
  const total = {
    changedCases: 0,
    changedFields: 0,
    byField: {},
    bySource: {},
    samples: [],
  };

  for (const item of items) {
    if (!item.stats.changed) {
      continue;
    }
    total.changedCases += 1;
    total.changedFields += item.stats.fieldChanges;

    for (const [fieldPath, count] of Object.entries(item.stats.fields)) {
      total.byField[fieldPath] = (total.byField[fieldPath] || 0) + count;
    }

    for (const [source, count] of Object.entries(item.stats.sources)) {
      total.bySource[source] = (total.bySource[source] || 0) + count;
    }

    for (const sample of item.stats.samples) {
      if (total.samples.length >= 40) {
        break;
      }
      total.samples.push(sample);
    }
  }

  total.byField = Object.fromEntries(
    Object.entries(total.byField).sort((left, right) => right[1] - left[1]),
  );
  total.bySource = Object.fromEntries(
    Object.entries(total.bySource).sort((left, right) => right[1] - left[1]),
  );

  return total;
}

function collectSourceColumnRepairIds(repository) {
  const rows = repository.db.prepare(`
    SELECT case_id, source, meta_json
    FROM cases
    WHERE COALESCE(TRIM(source), '') = ''
  `).all();

  const repairIds = new Set();
  for (const row of rows) {
    let meta = {};
    try {
      meta = JSON.parse(row.meta_json || '{}');
    } catch {
      meta = {};
    }

    if (normalizeWhitespace(meta.source)) {
      repairIds.add(String(row.case_id));
    }
  }

  return repairIds;
}

function buildSyncedPublicCases(dbCases, existingPublicMap) {
  return dbCases.map((dbCase) => {
    const existing = existingPublicMap.get(String(dbCase?._id ?? '')) || {};
    const nextCase = {
      ...existing,
      ...dbCase,
    };

    if (typeof existing.question === 'string') {
      nextCase.question = normalizeDisplayText(existing.question);
    }

    return nextCase;
  });
}

function main() {
  const publicCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const existingPublicMap = new Map(publicCases.map((caseRecord) => [String(caseRecord?._id ?? ''), caseRecord]));
  const publicRuns = publicCases.map((caseRecord) => ({
    _id: String(caseRecord?._id ?? ''),
    caseRecord,
    stats: normalizeCaseRecord(caseRecord),
  }));

  const repository = createCasebankRepository();
  try {
    const dbCases = repository.getAllCases();
    const sourceColumnRepairIds = collectSourceColumnRepairIds(repository);
    const dbRuns = dbCases.map((caseRecord) => ({
      _id: String(caseRecord?._id ?? ''),
      caseRecord,
      stats: normalizeCaseRecord(caseRecord),
    }));

    const modifiedDbCases = dbRuns
      .filter((entry) => entry.stats.changed || sourceColumnRepairIds.has(entry._id))
      .map((entry) => entry.caseRecord);
    if (modifiedDbCases.length > 0) {
      repository.updateCaseSnapshots(modifiedDbCases);
    }

    const syncedPublicCases = buildSyncedPublicCases(repository.getAllCases(), existingPublicMap);
    writeJsonAtomically(DATA_FILE, syncedPublicCases, true);

    const report = {
      generated_at: new Date().toISOString(),
      public_json: {
        ...summarizeRuns(publicRuns),
        synced_from_sqlite: true,
      },
      sqlite: {
        ...summarizeRuns(dbRuns),
        source_column_repairs: sourceColumnRepairIds.size,
      },
    };

    writeJsonAtomically(REPORT_FILE, report, true);

    console.log('Display text source fixes persisted');
    console.log(`  Public JSON changed cases: ${report.public_json.changedCases}`);
    console.log(`  SQLite changed cases:      ${report.sqlite.changedCases}`);
    console.log(`  Report:                    ${REPORT_FILE}`);
  } finally {
    repository.close();
  }
}

main();
