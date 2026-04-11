import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const OUTPUT_FILE = join(__dirname, 'output', 'distractor_key_conflicts.json');
const SAMPLE_LIMIT = 40;

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getCaseId(caseRecord) {
  return String(caseRecord.case_code ?? caseRecord.hash_id ?? caseRecord._id ?? '');
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function ensureBucket(map, source) {
  if (!map.has(source)) {
    map.set(source, {
      total_cases: 0,
      includes_correct_key: 0,
      invalid_key: 0,
      wrong_count_mismatch: 0,
      swappable_one_missing: 0,
      swappable_one_missing_non_empty: 0,
    });
  }

  return map.get(source);
}

const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const bySource = new Map();
const samples = [];

const summary = {
  total_cases: cases.length,
  cases_with_distractors: 0,
  includes_correct_key: 0,
  invalid_key: 0,
  wrong_count_mismatch: 0,
  swappable_one_missing: 0,
  swappable_one_missing_non_empty: 0,
};

for (const caseRecord of cases) {
  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  const distractors = caseRecord?.rationale?.distractors;
  if (!options.length || !distractors || typeof distractors !== 'object' || Array.isArray(distractors)) {
    continue;
  }

  const correctOption = options.find((option) => option?.is_correct === true);
  if (!correctOption) {
    continue;
  }

  const source = String(caseRecord?.meta?.source ?? 'unknown');
  const bucket = ensureBucket(bySource, source);
  const optionIds = new Set(options.map((option) => String(option?.id ?? '')).filter(Boolean));
  const wrongIds = options
    .filter((option) => option?.is_correct !== true)
    .map((option) => String(option.id));
  const keys = Object.keys(distractors).map(String);
  const invalidKeys = keys.filter((key) => !optionIds.has(key));
  const includesCorrectKey = keys.includes(String(correctOption.id));
  const missingWrongIds = wrongIds.filter((id) => !keys.includes(id));
  const wrongCountMismatch = keys.length !== wrongIds.length;
  const swappableOneMissing =
    includesCorrectKey
    && invalidKeys.length === 0
    && missingWrongIds.length === 1
    && keys.length === wrongIds.length;
  const swappableOneMissingNonEmpty =
    swappableOneMissing
    && normalizeWhitespace(distractors[String(correctOption.id)]).length > 0;

  summary.cases_with_distractors += 1;
  bucket.total_cases += 1;

  if (includesCorrectKey) {
    summary.includes_correct_key += 1;
    bucket.includes_correct_key += 1;
  }

  if (invalidKeys.length > 0) {
    summary.invalid_key += 1;
    bucket.invalid_key += 1;
  }

  if (wrongCountMismatch) {
    summary.wrong_count_mismatch += 1;
    bucket.wrong_count_mismatch += 1;
  }

  if (swappableOneMissing) {
    summary.swappable_one_missing += 1;
    bucket.swappable_one_missing += 1;
  }

  if (swappableOneMissingNonEmpty) {
    summary.swappable_one_missing_non_empty += 1;
    bucket.swappable_one_missing_non_empty += 1;
  }

  if (swappableOneMissingNonEmpty && samples.length < SAMPLE_LIMIT) {
    samples.push({
      case_id: getCaseId(caseRecord),
      source,
      prompt: normalizeWhitespace(caseRecord.prompt || caseRecord.question || caseRecord.title),
      correct_option_id: String(correctOption.id),
      missing_wrong_option_id: missingWrongIds[0],
      option_text_by_id: Object.fromEntries(options.map((option) => [String(option.id), option.text ?? ''])),
      distractor_keys: keys,
      conflicting_text: distractors[String(correctOption.id)],
    });
  }
}

const report = {
  summary,
  by_source: Object.fromEntries(
    Array.from(bySource.entries())
      .sort((left, right) => right[1].swappable_one_missing_non_empty - left[1].swappable_one_missing_non_empty)
      .map(([source, bucket]) => [source, bucket]),
  ),
  samples,
};

writeJsonAtomically(OUTPUT_FILE, report);

console.log('=== DISTRACTOR KEY CONFLICT AUDIT ===');
console.log(`Total cases: ${formatCount(summary.total_cases)}`);
console.log(`Cases with distractors: ${formatCount(summary.cases_with_distractors)}`);
console.log(`Correct-key conflicts: ${formatCount(summary.includes_correct_key)}`);
console.log(`Invalid distractor keys: ${formatCount(summary.invalid_key)}`);
console.log(`Wrong-count mismatches: ${formatCount(summary.wrong_count_mismatch)}`);
console.log(`Swappable one-missing conflicts: ${formatCount(summary.swappable_one_missing)}`);
console.log(`Swappable one-missing conflicts with non-empty text: ${formatCount(summary.swappable_one_missing_non_empty)}`);
console.log(`Report written: ${OUTPUT_FILE}`);
