import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const PLACEHOLDER_PATTERNS = [
  /^see reference/i,
  /^explanation unavailable/i,
  /^no explanation available/i,
  /^refer to textbook/i,
  /^not available/i,
  /^n\/a$/i,
  /^-$/,
  /^\.$/,
  /^none$/i,
  /^\s*$/,
];

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeJsonAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    const correct = typeof caseRecord.rationale === 'string' ? caseRecord.rationale : '';
    caseRecord.rationale = {
      correct,
      distractors: {},
      pearl: '',
    };
  }

  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }

  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = caseRecord.rationale.pearl == null ? '' : String(caseRecord.rationale.pearl);
  }

  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = caseRecord.rationale.correct == null ? '' : String(caseRecord.rationale.correct);
  }

  return caseRecord.rationale;
}

function getStemText(caseRecord) {
  const candidates = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    caseRecord.prompt,
    caseRecord.title,
  ];

  for (const candidate of candidates) {
    const text = normalizeWhitespace(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function getRationaleText(caseRecord) {
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }

  if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }

  return '';
}

function hasCorrectAnswer(caseRecord) {
  return Array.isArray(caseRecord.options) && caseRecord.options.some((option) => option?.is_correct === true);
}

function hasDemographics(caseRecord) {
  const demographics = caseRecord?.vignette?.demographics;
  if (!demographics || typeof demographics !== 'object') {
    return false;
  }

  return Object.values(demographics).some((value) => normalizeWhitespace(value));
}

function hasTopicTags(meta) {
  return (
    (typeof meta.organ_system === 'string' && meta.organ_system !== 'general') ||
    (Array.isArray(meta.topic_keywords) && meta.topic_keywords.length > 0) ||
    Boolean(normalizeWhitespace(meta.topic))
  );
}

function calculateQualityScore(caseRecord, meta) {
  const stemLength = getStemText(caseRecord).length;
  const rationaleLength = getRationaleText(caseRecord).length;
  const optionCount = Array.isArray(caseRecord.options) ? caseRecord.options.length : 0;

  let score = 0;

  if (hasCorrectAnswer(caseRecord)) score += 25;
  if (rationaleLength > 50) score += 25;
  if (meta.truncated !== true) score += 15;
  if (optionCount >= 4 && optionCount <= 5) score += 10;
  if (stemLength > 100) score += 10;
  if (hasDemographics(caseRecord)) score += 5;
  if (hasTopicTags(meta)) score += 5;
  if (meta.needs_review !== true) score += 5;

  return score;
}

function isPlaceholder(text) {
  const normalized = normalizeWhitespace(text);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  let purgedCount = 0;
  let changedCount = 0;
  let qualityAdjusted = 0;
  let totalScoreDelta = 0;

  for (const caseRecord of cases) {
    const rationale = ensureRationale(caseRecord);
    const before = normalizeWhitespace(rationale.correct);
    if (!isPlaceholder(before)) {
      continue;
    }

    const meta = ensureMeta(caseRecord);
    const previousScore = Number.isFinite(meta.quality_score) ? meta.quality_score : calculateQualityScore(caseRecord, meta);

    rationale.correct = '';
    meta.placeholder_purged = true;

    const nextScore = calculateQualityScore(caseRecord, meta);
    meta.quality_score = nextScore;

    purgedCount += 1;
    changedCount += before === '' ? 0 : 1;
    if (nextScore !== previousScore) {
      qualityAdjusted += 1;
      totalScoreDelta += nextScore - previousScore;
    }
  }

  writeJsonAtomically(DATA_FILE, cases);

  console.log('=== PLACEHOLDER PURGE ===');
  console.log(`Cases scanned: ${cases.length.toLocaleString('en-US')}`);
  console.log(`Placeholder rationales purged: ${purgedCount.toLocaleString('en-US')}`);
  console.log(`Non-empty placeholders cleared: ${changedCount.toLocaleString('en-US')}`);
  console.log(`Quality scores adjusted: ${qualityAdjusted.toLocaleString('en-US')}`);
  console.log(`Net quality-score delta: ${totalScoreDelta.toLocaleString('en-US')}`);
}

main();
