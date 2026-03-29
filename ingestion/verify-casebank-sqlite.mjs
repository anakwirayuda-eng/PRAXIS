import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import { CASEBANK_DB_PATH, openCasebankDb } from '../server/casebank-db.js';

const SOURCE_PATH = resolve(process.cwd(), process.argv[2] || 'public/data/compiled_cases.json');
const REPORT_PATH = resolve(process.cwd(), 'ingestion/output/casebank_parity_report.json');

function ensureOutputDirectory(reportPath) {
  const outputDir = dirname(reportPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
}

function canonicalCase(caseData) {
  return JSON.stringify({
    _id: caseData._id,
    hash_id: caseData.hash_id ?? null,
    q_type: caseData.q_type ?? null,
    confidence: caseData.confidence ?? null,
    category: caseData.category ?? null,
    title: caseData.title ?? null,
    vignette: caseData.vignette ?? {},
    prompt: caseData.prompt ?? '',
    options: (caseData.options || []).map((option) => ({
      id: String(option.id ?? ''),
      text: option.text ?? '',
      is_correct: Boolean(option.is_correct),
    })),
    rationale: caseData.rationale ?? {},
    meta: caseData.meta ?? {},
    validation: caseData.validation ?? {},
    case_code: caseData.case_code ?? '',
  });
}

function digestCases(items) {
  const hash = createHash('sha256');
  const sorted = [...items].sort((a, b) => a._id - b._id);
  for (const item of sorted) {
    hash.update(canonicalCase(item));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function countBy(items, selector) {
  return items.reduce((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizeCountMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

const compiledCases = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
const db = openCasebankDb(CASEBANK_DB_PATH);

const caseRows = db.prepare(`
  SELECT
    case_id,
    case_code,
    hash_id,
    q_type,
    confidence,
    category,
    title,
    prompt,
    vignette_json,
    rationale_json,
    meta_json,
    validation_json
  FROM cases
  ORDER BY case_id
`).all();

const optionRows = db.prepare(`
  SELECT case_id, option_id, sort_order, option_text, is_correct
  FROM case_options
  ORDER BY case_id, sort_order
`).all();

const optionCount = db.prepare('SELECT COUNT(*) AS count FROM case_options').get().count;
const correctOptionCount = db.prepare('SELECT COALESCE(SUM(is_correct), 0) AS count FROM case_options').get().count;
const sourceRows = db.prepare('SELECT source, COUNT(*) AS count FROM cases GROUP BY source ORDER BY source').all();
const statusRows = db.prepare('SELECT meta_status, COUNT(*) AS count FROM cases GROUP BY meta_status ORDER BY meta_status').all();

const optionsByCaseId = new Map();
for (const row of optionRows) {
  const list = optionsByCaseId.get(row.case_id) || [];
  list.push({
    id: row.option_id,
    text: row.option_text,
    is_correct: Boolean(row.is_correct),
  });
  optionsByCaseId.set(row.case_id, list);
}

const reconstructedCases = caseRows.map((row) => ({
  _id: row.case_id,
  hash_id: row.hash_id,
  q_type: row.q_type,
  confidence: row.confidence,
  category: row.category,
  title: row.title,
  vignette: JSON.parse(row.vignette_json),
  prompt: row.prompt,
  options: optionsByCaseId.get(row.case_id) || [],
  rationale: JSON.parse(row.rationale_json),
  meta: JSON.parse(row.meta_json),
  validation: JSON.parse(row.validation_json),
  case_code: row.case_code,
}));

const jsonSourceCounts = countBy(compiledCases, (item) => item.meta?.source ?? '');
const jsonStatusCounts = countBy(compiledCases, (item) => item.meta?.status ?? '');
const jsonOptionCount = compiledCases.reduce((sum, item) => sum + (item.options?.length || 0), 0);
const jsonCorrectOptionCount = compiledCases.reduce(
  (sum, item) => sum + (item.options || []).filter((option) => option.is_correct).length,
  0,
);

const dbSourceCounts = Object.fromEntries(sourceRows.map((row) => [row.source ?? '', row.count]));
const dbStatusCounts = Object.fromEntries(statusRows.map((row) => [row.meta_status ?? '', row.count]));
const normalizedJsonSourceCounts = normalizeCountMap(jsonSourceCounts);
const normalizedDbSourceCounts = normalizeCountMap(dbSourceCounts);
const normalizedJsonStatusCounts = normalizeCountMap(jsonStatusCounts);
const normalizedDbStatusCounts = normalizeCountMap(dbStatusCounts);

const jsonDigest = digestCases(compiledCases);
const dbDigest = digestCases(reconstructedCases);

const report = {
  sourcePath: SOURCE_PATH,
  dbPath: CASEBANK_DB_PATH,
  totalCases: {
    json: compiledCases.length,
    sqlite: caseRows.length,
    matches: compiledCases.length === caseRows.length,
  },
  totalOptions: {
    json: jsonOptionCount,
    sqlite: optionCount,
    matches: jsonOptionCount === optionCount,
  },
  totalCorrectOptions: {
    json: jsonCorrectOptionCount,
    sqlite: correctOptionCount,
    matches: jsonCorrectOptionCount === correctOptionCount,
  },
  sourceCounts: {
    json: normalizedJsonSourceCounts,
    sqlite: normalizedDbSourceCounts,
    matches: JSON.stringify(normalizedJsonSourceCounts) === JSON.stringify(normalizedDbSourceCounts),
  },
  statusCounts: {
    json: normalizedJsonStatusCounts,
    sqlite: normalizedDbStatusCounts,
    matches: JSON.stringify(normalizedJsonStatusCounts) === JSON.stringify(normalizedDbStatusCounts),
  },
  canonicalDigest: {
    json: jsonDigest,
    sqlite: dbDigest,
    matches: jsonDigest === dbDigest,
  },
};

report.ok = Object.values(report).every((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  return value.matches !== false;
});

ensureOutputDirectory(REPORT_PATH);
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

console.log('CASEBANK SQLITE PARITY CHECK');
console.log(`Cases:          ${report.totalCases.json} vs ${report.totalCases.sqlite}`);
console.log(`Options:        ${report.totalOptions.json} vs ${report.totalOptions.sqlite}`);
console.log(`Correct opts:   ${report.totalCorrectOptions.json} vs ${report.totalCorrectOptions.sqlite}`);
console.log(`Source counts:  ${report.sourceCounts.matches ? 'match' : 'mismatch'}`);
console.log(`Status counts:  ${report.statusCounts.matches ? 'match' : 'mismatch'}`);
console.log(`Digest:         ${report.canonicalDigest.matches ? 'match' : 'mismatch'}`);
console.log(`Overall:        ${report.ok ? 'PASS' : 'FAIL'}`);
console.log(`Report:         ${REPORT_PATH}`);

if (!report.ok) {
  process.exitCode = 1;
}

db.close();
