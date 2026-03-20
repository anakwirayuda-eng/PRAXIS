import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const PLACEHOLDER_RATIONALE_REGEX = /^explanation unavailable\.?$/i;
const EXPLANATION_LIKE_REGEX =
  /\b(?:because|therefore|thus|hence|correct answer|this patient|the diagnosis|the treatment|explanation|rationale|is correct)\b/i;

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function ensureRationaleObject(caseRecord, fallbackText = '') {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object') {
    caseRecord.rationale = {
      correct: normalizeWhitespace(fallbackText),
      distractors: {},
      pearl: '',
    };
  }

  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }

  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = '';
  }

  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = normalizeWhitespace(caseRecord.rationale.correct);
  }

  return caseRecord.rationale;
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

function isWeakRationale(text) {
  const normalized = normalizeWhitespace(text);
  return !normalized || PLACEHOLDER_RATIONALE_REGEX.test(normalized) || normalized.length < 50;
}

function looksExplanationLike(text, fieldName) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= 50) {
    return false;
  }

  if (fieldName !== 'description') {
    return true;
  }

  return EXPLANATION_LIKE_REGEX.test(normalized) || (normalized.match(/[.?!]/g) ?? []).length >= 2;
}

function getCurrentRationaleText(caseRecord) {
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }

  if (
    caseRecord.rationale &&
    typeof caseRecord.rationale === 'object' &&
    typeof caseRecord.rationale.correct === 'string'
  ) {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }

  return '';
}

function getStemText(caseRecord) {
  return normalizeWhitespace(caseRecord.question || caseRecord.vignette?.narrative || caseRecord.title);
}

function hasCleanOptions(caseRecord) {
  if (!Array.isArray(caseRecord.options) || caseRecord.options.length === 0) {
    return false;
  }

  return caseRecord.options.every((option) => {
    const text = normalizeWhitespace(option?.text);
    if (!text) {
      return false;
    }

    if (caseRecord.q_type === 'SCT') {
      return true;
    }

    return text.length >= 3;
  });
}

function canClearTruncated(caseRecord) {
  const stemText = getStemText(caseRecord);
  if (stemText.length < 30 || /(?:\.\.\.|…)$/.test(stemText)) {
    return false;
  }

  return hasCleanOptions(caseRecord);
}

function collectAlternateFields(caseRecord) {
  const candidates = [
    ['exp', caseRecord.exp],
    ['explanation', caseRecord.explanation],
    ['answer_explanation', caseRecord.answer_explanation],
    ['solution', caseRecord.solution],
    ['reason', caseRecord.reason],
    ['description', caseRecord.description],
    ['meta.review_rationale', caseRecord?.meta?.review_rationale],
  ];

  const deduped = [];
  const seen = new Set();

  for (const [fieldName, value] of candidates) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || seen.has(normalized) || !looksExplanationLike(normalized, fieldName)) {
      continue;
    }

    seen.add(normalized);
    deduped.push([fieldName, normalized]);
  }

  return deduped;
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const summary = {
    recovered_total: 0,
    converted_string_rationales: 0,
    cleared_truncated: 0,
    by_field: {
      rationale_string: 0,
      exp: 0,
      explanation: 0,
      answer_explanation: 0,
      solution: 0,
      reason: 0,
      description: 0,
      'meta.review_rationale': 0,
    },
  };

  for (const caseRecord of cases) {
    const meta = ensureMeta(caseRecord);
    const currentText = getCurrentRationaleText(caseRecord);
    let recoveredThisCase = false;

    if (typeof caseRecord.rationale === 'string') {
      const normalizedStringRationale = normalizeWhitespace(caseRecord.rationale);
      if (normalizedStringRationale.length > 50) {
        caseRecord.rationale = {
          correct: normalizedStringRationale,
          distractors: {},
          pearl: '',
        };
        meta.rationale_recovered = true;
        summary.recovered_total += 1;
        summary.converted_string_rationales += 1;
        summary.by_field.rationale_string += 1;
        recoveredThisCase = true;
      }
    }

    const updatedText = getCurrentRationaleText(caseRecord);
    if (isWeakRationale(updatedText)) {
      for (const [fieldName, text] of collectAlternateFields(caseRecord)) {
        const rationale = ensureRationaleObject(caseRecord, updatedText);
        if (normalizeWhitespace(rationale.correct) === text) {
          continue;
        }

        rationale.correct = text;
        meta.rationale_recovered = true;
        summary.recovered_total += 1;
        summary.by_field[fieldName] += 1;
        recoveredThisCase = true;
        break;
      }
    }

    if (recoveredThisCase && meta.truncated === true && canClearTruncated(caseRecord)) {
      delete meta.truncated;
      summary.cleared_truncated += 1;
    }

    if (recoveredThisCase && typeof meta.rationale_recovered !== 'boolean') {
      meta.rationale_recovered = true;
    }
  }

  writeJsonAtomically(DATA_FILE, cases);

  console.log('=== RATIONALE RECOVERY ===');
  console.log(`Cases scanned: ${formatCount(cases.length)}`);
  console.log(`Rationales recovered: ${formatCount(summary.recovered_total)}`);
  console.log(`String rationales normalized: ${formatCount(summary.converted_string_rationales)}`);
  console.log(`Truncated flags cleared: ${formatCount(summary.cleared_truncated)}`);
  for (const [fieldName, count] of Object.entries(summary.by_field)) {
    console.log(`  ${fieldName}: ${formatCount(count)}`);
  }
}

main();
