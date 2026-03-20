import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const BACKUP_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.backup.json');
const REPORT_DIR = join(__dirname, 'output');
const REPORT_FILE = join(REPORT_DIR, 'quality_report.json');
const USE_BACKUP_INPUT = process.argv.includes('--from-backup');
const INPUT_FILE = USE_BACKUP_INPUT ? BACKUP_FILE : DATA_FILE;

const REPORT_KEYS = [
  'no_correct_answer',
  'multi_correct',
  'truncated_question',
  'truncated_options',
  'hallucinated_rationale',
  'aota_suspect',
  'no_options',
  'duplicate_options',
];

const AOTA_REGEX =
  /\b(?:all of the above|all the above|all are correct|all of these(?: options)?|all listed above)\b/i;
const HALLUCINATION_REGEXES = [
  /\[Auto-Analysis\]/i,
  /more commonly indicated as a primary treatment for/i,
  /more commonly indicated\b.*\bprimary treatment\b.*\bcases?\b/i,
  /\bprimary treatment for\b.*\b(?:internal medicine|surgery|pediatrics|obgyn|public health|psychiatry)\b.*\bcases?\b/i,
];
const NONSENSE_HALLUCINATION_REGEX =
  /\bis not a (?:valid|common|standard) (?:treatment|diagnosis|option) for\b/i;
const TRAILING_ELLIPSIS_REGEX = /(?:\.{3,}|…)\s*$/;
const TRAILING_OPENER_REGEX = /[\[(<{'"“‘]\s*$/;
const TRAILING_CONNECTOR_REGEX =
  /\b(?:and|or|of|to|for|with|without|from|in|on|at|by|due|because|secondary)\s*$/i;
const SCT_SCALE_REGEX = /^[+-]?[012]$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function getCaseId(caseRecord) {
  return String(caseRecord.hash_id ?? caseRecord._id);
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeOptionText(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function getQuestionText(caseRecord) {
  const candidates = [
    caseRecord.question,
    caseRecord.prompt,
    caseRecord.title,
    caseRecord.vignette?.narrative,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function hasUnbalancedDelimiter(text, opener, closer) {
  let balance = 0;
  for (const char of text) {
    if (char === opener) {
      balance += 1;
    } else if (char === closer && balance > 0) {
      balance -= 1;
    }
  }

  return balance > 0;
}

function isTruncatedQuestion(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return true;
  }

  if (normalized.length < 30) {
    return true;
  }

  if (TRAILING_ELLIPSIS_REGEX.test(normalized)) {
    return true;
  }

  if (TRAILING_OPENER_REGEX.test(normalized)) {
    return true;
  }

  if (TRAILING_CONNECTOR_REGEX.test(normalized)) {
    return true;
  }

  if (hasUnbalancedDelimiter(normalized, '(', ')')) {
    return true;
  }

  if (hasUnbalancedDelimiter(normalized, '[', ']')) {
    return true;
  }

  return false;
}

function isScaleLabel(text) {
  return SCT_SCALE_REGEX.test(normalizeWhitespace(text));
}

function isTruncatedOptionText(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return true;
  }

  if (isScaleLabel(normalized)) {
    return false;
  }

  if (normalized.length < 2) {
    return true;
  }

  if (normalized.length < 3) {
    return !/^[A-Z0-9][A-Z0-9+%/-]*$/.test(normalized);
  }

  return false;
}

function hasDuplicateOptions(options) {
  const seen = new Set();

  for (const option of options) {
    const key = normalizeOptionText(option?.text);
    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

function isHallucinationText(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  const matchesPrimaryPattern = HALLUCINATION_REGEXES.some((pattern) => pattern.test(normalized));
  const matchesNonsensePattern =
    NONSENSE_HALLUCINATION_REGEX.test(normalized) &&
    (/\[Auto-Analysis\]/i.test(normalized) ||
      /\bmore commonly indicated\b/i.test(normalized) ||
      /\bprimary treatment for\b/i.test(normalized));

  return matchesPrimaryPattern || matchesNonsensePattern;
}

function sanitizeHallucinationText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { value: text, changed: false };
  }

  const segments = text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/));

  const kept = [];
  let changed = false;

  for (const segment of segments) {
    const trimmed = normalizeWhitespace(segment);
    if (!trimmed) {
      continue;
    }

    if (isHallucinationText(trimmed)) {
      changed = true;
      continue;
    }

    kept.push(trimmed);
  }

  if (!changed) {
    return { value: text, changed: false };
  }

  return {
    value: kept.join(' ').trim(),
    changed: true,
  };
}

function caseHasHallucinatedRationale(rationale) {
  if (typeof rationale === 'string') {
    return isHallucinationText(rationale);
  }

  if (!rationale || typeof rationale !== 'object') {
    return false;
  }

  if (typeof rationale.correct === 'string' && isHallucinationText(rationale.correct)) {
    return true;
  }

  if (rationale.distractors && typeof rationale.distractors === 'object') {
    for (const value of Object.values(rationale.distractors)) {
      if (typeof value === 'string' && isHallucinationText(value)) {
        return true;
      }
    }
  }

  if (typeof rationale.pearl === 'string' && isHallucinationText(rationale.pearl)) {
    return true;
  }

  return false;
}

function stripHallucinatedRationale(caseRecord) {
  let changed = false;

  if (typeof caseRecord.rationale === 'string') {
    const sanitized = sanitizeHallucinationText(caseRecord.rationale);
    if (sanitized.changed) {
      caseRecord.rationale = sanitized.value;
      changed = true;
    }
    return changed;
  }

  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object') {
    return false;
  }

  for (const field of ['correct', 'pearl']) {
    if (typeof caseRecord.rationale[field] === 'string') {
      const sanitized = sanitizeHallucinationText(caseRecord.rationale[field]);
      if (sanitized.changed) {
        caseRecord.rationale[field] = sanitized.value;
        changed = true;
      }
    }
  }

  if (caseRecord.rationale.distractors && typeof caseRecord.rationale.distractors === 'object') {
    for (const [key, value] of Object.entries(caseRecord.rationale.distractors)) {
      if (typeof value !== 'string') {
        continue;
      }

      const sanitized = sanitizeHallucinationText(value);
      if (sanitized.changed) {
        caseRecord.rationale.distractors[key] = sanitized.value;
        changed = true;
      }
    }
  }

  return changed;
}

function setSingleCorrectOption(options, correctIndex) {
  let changed = false;

  for (let index = 0; index < options.length; index += 1) {
    const shouldBeCorrect = index === correctIndex;
    if (options[index]?.is_correct !== shouldBeCorrect) {
      options[index].is_correct = shouldBeCorrect;
      changed = true;
    }
  }

  return changed;
}

function normalizeCorrectFields(options) {
  const hasCorrectField = options.some((option) => option && hasOwn(option, 'correct'));
  if (!hasCorrectField) {
    return false;
  }

  const hasExplicitIsCorrect = options.some((option) => option?.is_correct === true);
  let changed = false;

  for (const option of options) {
    if (!option || typeof option !== 'object') {
      continue;
    }

    if (hasExplicitIsCorrect) {
      if (!hasOwn(option, 'is_correct')) {
        option.is_correct = false;
        changed = true;
      }
    } else if (typeof option.correct === 'boolean') {
      if (option.is_correct !== option.correct) {
        option.is_correct = option.correct;
        changed = true;
      }
    }

    if (hasOwn(option, 'correct')) {
      delete option.correct;
      changed = true;
    }
  }

  return changed;
}

function matchAnswerValueToIndex(value, options) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return null;
    }

    for (const key of ['id', 'option', 'label', 'text', 'value']) {
      if (hasOwn(value, key)) {
        const nestedMatch = matchAnswerValueToIndex(value[key], options);
        if (nestedMatch !== null) {
          return nestedMatch;
        }
      }
    }

    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toLowerCase();
  const optionIdMatch = options.findIndex(
    (option) => String(option?.id ?? '').trim().toLowerCase() === normalized,
  );
  if (optionIdMatch !== -1) {
    return optionIdMatch;
  }

  const optionTextMatch = options.findIndex(
    (option) => normalizeOptionText(option?.text) === normalizeOptionText(raw),
  );
  if (optionTextMatch !== -1) {
    return optionTextMatch;
  }

  if (/^[A-Za-z]$/.test(raw)) {
    const letterIndex = raw.toUpperCase().charCodeAt(0) - 65;
    if (letterIndex >= 0 && letterIndex < options.length) {
      return letterIndex;
    }
  }

  if (/^-?\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric >= 1 && numeric <= options.length) {
      return numeric - 1;
    }

    if (numeric >= 0 && numeric < options.length) {
      return numeric;
    }
  }

  return null;
}

function resolveCaseAnswerIndex(caseRecord, options) {
  for (const field of ['cop', 'answer']) {
    if (!hasOwn(caseRecord, field)) {
      continue;
    }

    const match = matchAnswerValueToIndex(caseRecord[field], options);
    if (match !== null) {
      return match;
    }
  }

  return null;
}

function buildEmptyReportSets() {
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, new Set()]));
}

function buildReportFromSets(reportSets) {
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, Array.from(reportSets[key])]));
}

function writeJsonAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

mkdirSync(REPORT_DIR, { recursive: true });

const cases = JSON.parse(readFileSync(INPUT_FILE, 'utf8'));
const reportSets = buildEmptyReportSets();
const fixedSets = {
  no_correct_answer: new Set(),
  multi_correct: new Set(),
  hallucinated_rationale: new Set(),
  normalized_correct_field: new Set(),
};
const remainingSets = {
  no_correct_answer: new Set(),
  multi_correct: new Set(),
  hallucinated_rationale: new Set(),
};
const manualReviewIds = new Set();
const modifiedCaseIds = new Set();

for (const caseRecord of cases) {
  const caseId = getCaseId(caseRecord);
  const questionText = getQuestionText(caseRecord);
  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  const rawCorrectCount = options.filter((option) => option?.is_correct === true).length;
  const rawNoOptions = options.length === 0;
  const rawNoCorrect = options.length > 0 && rawCorrectCount === 0;
  const rawMultiCorrect = rawCorrectCount > 1;

  if (rawNoOptions) {
    reportSets.no_options.add(caseId);
    manualReviewIds.add(caseId);
  } else if (rawNoCorrect) {
    reportSets.no_correct_answer.add(caseId);
  } else if (rawMultiCorrect) {
    reportSets.multi_correct.add(caseId);
    manualReviewIds.add(caseId);
  }

  if (isTruncatedQuestion(questionText)) {
    reportSets.truncated_question.add(caseId);
    manualReviewIds.add(caseId);
  }

  if (options.some((option) => isTruncatedOptionText(option?.text))) {
    reportSets.truncated_options.add(caseId);
    manualReviewIds.add(caseId);
  }

  if (caseHasHallucinatedRationale(caseRecord.rationale)) {
    reportSets.hallucinated_rationale.add(caseId);
  }

  if (options.some((option) => AOTA_REGEX.test(normalizeWhitespace(option?.text)))) {
    reportSets.aota_suspect.add(caseId);
    manualReviewIds.add(caseId);
  }

  if (options.length > 0 && hasDuplicateOptions(options)) {
    reportSets.duplicate_options.add(caseId);
    manualReviewIds.add(caseId);
  }

  let caseModified = false;

  if (options.length > 0) {
    if (normalizeCorrectFields(options)) {
      fixedSets.normalized_correct_field.add(caseId);
      caseModified = true;
    }

    let correctCount = options.filter((option) => option?.is_correct === true).length;

    if (correctCount === 0) {
      const resolvedAnswerIndex = resolveCaseAnswerIndex(caseRecord, options);
      if (resolvedAnswerIndex !== null && setSingleCorrectOption(options, resolvedAnswerIndex)) {
        caseModified = true;
      }
    }

    correctCount = options.filter((option) => option?.is_correct === true).length;

    if (correctCount > 1) {
      const firstCorrectIndex = options.findIndex((option) => option?.is_correct === true);
      if (firstCorrectIndex !== -1 && setSingleCorrectOption(options, firstCorrectIndex)) {
        caseModified = true;
      }
    }

    correctCount = options.filter((option) => option?.is_correct === true).length;

    if (rawNoCorrect && correctCount === 1) {
      fixedSets.no_correct_answer.add(caseId);
    } else if (correctCount === 0) {
      remainingSets.no_correct_answer.add(caseId);
      manualReviewIds.add(caseId);
    }

    if (rawMultiCorrect && correctCount === 1) {
      fixedSets.multi_correct.add(caseId);
    } else if (correctCount > 1) {
      remainingSets.multi_correct.add(caseId);
      manualReviewIds.add(caseId);
    }
  }

  if (stripHallucinatedRationale(caseRecord)) {
    fixedSets.hallucinated_rationale.add(caseId);
    caseModified = true;
  }

  if (caseHasHallucinatedRationale(caseRecord.rationale)) {
    remainingSets.hallucinated_rationale.add(caseId);
  }

  if (caseModified) {
    modifiedCaseIds.add(caseId);
  }
}

const report = buildReportFromSets(reportSets);
const totalIssueOccurrences = REPORT_KEYS.reduce((sum, key) => sum + reportSets[key].size, 0);
const issueCaseIds = new Set(REPORT_KEYS.flatMap((key) => Array.from(reportSets[key])));
const totalCasesWithIssues = issueCaseIds.size;
const autoFixedCases = modifiedCaseIds.size;
const manualReviewCases = manualReviewIds.size;

if (!USE_BACKUP_INPUT) {
  copyFileSync(DATA_FILE, BACKUP_FILE);
} else if (!existsSync(BACKUP_FILE)) {
  copyFileSync(DATA_FILE, BACKUP_FILE);
}
writeJsonAtomically(DATA_FILE, cases);
writeJsonAtomically(REPORT_FILE, report);

console.log('=== DATA QUALITY AUDIT ===');
console.log(`Total cases: ${formatCount(cases.length)}`);
console.log(`Issues found: ${formatCount(totalCasesWithIssues)} cases (${formatCount(totalIssueOccurrences)} issue occurrences)`);
console.log(`Auto-fixed: ${formatCount(autoFixedCases)} cases`);
console.log(`Remaining for manual review: ${formatCount(manualReviewCases)} cases`);
console.log('Breakdown:');
console.log(
  `  No correct answer: ${formatCount(reportSets.no_correct_answer.size)} (fixed ${formatCount(
    fixedSets.no_correct_answer.size,
  )}, remaining ${formatCount(remainingSets.no_correct_answer.size)})`,
);
console.log(
  `  Multi correct: ${formatCount(reportSets.multi_correct.size)} (fixed ${formatCount(
    fixedSets.multi_correct.size,
  )}, remaining ${formatCount(remainingSets.multi_correct.size)})`,
);
console.log(
  `  Truncated question: ${formatCount(reportSets.truncated_question.size)} (flagged for review)`,
);
console.log(
  `  Truncated options: ${formatCount(reportSets.truncated_options.size)} (flagged for review)`,
);
console.log(
  `  Hallucinated rationale: ${formatCount(reportSets.hallucinated_rationale.size)} (fixed ${formatCount(
    fixedSets.hallucinated_rationale.size,
  )}, remaining ${formatCount(remainingSets.hallucinated_rationale.size)})`,
);
console.log(`  AOTA suspect: ${formatCount(reportSets.aota_suspect.size)} (flagged for review)`);
console.log(`  No options: ${formatCount(reportSets.no_options.size)} (flagged for review)`);
console.log(
  `  Duplicate options: ${formatCount(reportSets.duplicate_options.size)} (flagged for review)`,
);
console.log(
  `  Correct-field normalization: ${formatCount(fixedSets.normalized_correct_field.size)} cases`,
);
console.log(`Input file: ${INPUT_FILE}`);
console.log(`Report written: ${REPORT_FILE}`);
console.log(`Backup written: ${BACKUP_FILE}`);
