import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'quality_report.json');

const AOTA_REGEX =
  /\b(?:all of the above|all the above|none of the above|none of these)\b/i;
const ALL_ABOVE_REGEX = /\b(?:all of the above|all the above)\b/i;
const ANSWER_LETTER_PATTERNS = [
  /\b(?:ans(?:wer)?|jawaban(?:nya)?|correct answer)\s*[:=-]?\s*\(?([A-E])\)?\b/i,
  /\b(?:jawaban|answer)(?: yang paling tepat)? adalah\s*\(?([A-E])\)?[.)]?\b/i,
  /^\s*\(?([A-E])\)?\s*(?:[.):-]|i\.e\.)/i,
];
const ANSWER_TEXT_PATTERNS = [
  /(?:jawaban(?: yang paling tepat)?|answer(?: yang paling tepat)?|the correct answer|correct answer|diagnosis paling mungkin|diagnosis paling tepat)\s+(?:adalah|is)?\s*([^.\n]+)/i,
];
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'atau',
  'adalah',
  'all',
  'atas',
  'above',
  'dari',
  'dan',
  'dengan',
  'for',
  'from',
  'in',
  'is',
  'itu',
  'ke',
  'of',
  'on',
  'or',
  'the',
  'to',
    'yang',
]);

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

function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeContent(value) {
  return normalizeComparable(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function getRationaleText(caseRecord) {
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

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function markNeedsReview(caseRecord) {
  const meta = ensureMeta(caseRecord);
  if (meta.needs_review !== true) {
    meta.needs_review = true;
    return true;
  }

  return false;
}

function writeJsonAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function optionTextLooksMerged(option) {
  const text = String(option?.text ?? '');
  const matches = [...text.matchAll(/(?:^|\s)([A-E])[.)]\s+/gi)].map((match) =>
    match[1].toUpperCase(),
  );

  if (matches.length === 0) {
    return false;
  }

  const ownId = String(option?.id ?? '').toUpperCase();
  const startsWithOwnLabel =
    ownId && new RegExp(`^${ownId}[.)]\\s+`, 'i').test(text.trim());

  return !(matches.length === 1 && startsWithOwnLabel);
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
        const nested = matchAnswerValueToIndex(value[key], options);
        if (nested !== null) {
          return nested;
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

  const optionIdIndex = options.findIndex(
    (option) => String(option?.id ?? '').trim().toLowerCase() === normalized,
  );
  if (optionIdIndex !== -1) {
    return optionIdIndex;
  }

  const optionTextIndex = options.findIndex(
    (option) => normalizeComparable(option?.text) === normalizeComparable(raw),
  );
  if (optionTextIndex !== -1) {
    return optionTextIndex;
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

function findAnswerIndexFromFields(caseRecord, options) {
  const fieldOrder = ['cop', 'answer', 'answer_idx'];

  for (const field of fieldOrder) {
    if (!hasOwn(caseRecord, field)) {
      continue;
    }

    const match = matchAnswerValueToIndex(caseRecord[field], options);
    if (match !== null) {
      return { index: match, strategy: field };
    }
  }

  return { index: null, strategy: null };
}

function findAnswerLetterFromRationale(rationale) {
  for (const pattern of ANSWER_LETTER_PATTERNS) {
    const match = rationale.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

function extractAnswerTextCandidates(rationale) {
  const candidates = [];

  for (const pattern of ANSWER_TEXT_PATTERNS) {
    const match = rationale.match(pattern);
    if (match) {
      candidates.push(normalizeWhitespace(match[1]));
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

function findAnswerIndexFromRationale(caseRecord, options) {
  const rationale = getRationaleText(caseRecord);
  if (!rationale) {
    return { index: null, strategy: null };
  }

  const answerLetter = findAnswerLetterFromRationale(rationale);
  if (answerLetter) {
    const optionIndex = options.findIndex(
      (option) =>
        String(option?.id ?? '').toUpperCase() === answerLetter && !optionTextLooksMerged(option),
    );

    if (optionIndex !== -1) {
      return { index: optionIndex, strategy: 'rationale_letter' };
    }
  }

  const candidates = extractAnswerTextCandidates(rationale);
  for (const candidate of candidates) {
    const candidateComparable = normalizeComparable(candidate);
    if (!candidateComparable) {
      continue;
    }

    const matchingIndices = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !optionTextLooksMerged(option))
      .filter(({ option }) => {
        const optionComparable = normalizeComparable(option?.text);
        return (
          optionComparable &&
          (candidateComparable.includes(optionComparable) || optionComparable.includes(candidateComparable))
        );
      })
      .map(({ index }) => index);

    if (matchingIndices.length === 1) {
      return { index: matchingIndices[0], strategy: 'rationale_text' };
    }
  }

  return { index: null, strategy: null };
}

function rationaleMentionsOption(rationale, optionText) {
  const normalizedRationale = normalizeComparable(rationale);
  const normalizedOption = normalizeComparable(optionText);

  if (!normalizedRationale || !normalizedOption) {
    return false;
  }

  if (normalizedRationale.includes(normalizedOption)) {
    return true;
  }

  const tokens = tokenizeContent(optionText);
  if (tokens.length === 0) {
    return normalizedRationale.includes(normalizedOption);
  }

  if (tokens.length === 1) {
    return normalizedRationale.includes(tokens[0]);
  }

  return tokens.every((token) => normalizedRationale.includes(token));
}

function dedupeOptions(caseRecord) {
  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  if (options.length < 2) {
    return { changed: false, removedCount: 0, flaggedReview: false };
  }

  const groups = new Map();
  options.forEach((option, index) => {
    const key = normalizeWhitespace(option?.text).toLowerCase();
    if (!key) {
      return;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(index);
  });

  const removeIndices = new Set();
  let flaggedReview = false;

  for (const indices of groups.values()) {
    if (indices.length < 2) {
      continue;
    }

    const activeIndices = indices.filter((index) => !removeIndices.has(index));
    if (activeIndices.length < 2) {
      continue;
    }

    const correctIndices = activeIndices.filter((index) => options[index]?.is_correct === true);
    const keeperIndex =
      correctIndices.length > 0 ? correctIndices[0] : activeIndices[0];

    if (correctIndices.length > 1) {
      flaggedReview = true;
    }

    const plannedRemovals = activeIndices.filter((index) => index !== keeperIndex);
    const projectedLength = options.length - removeIndices.size - plannedRemovals.length;

    if (projectedLength < 2) {
      flaggedReview = true;
      continue;
    }

    plannedRemovals.forEach((index) => removeIndices.add(index));
  }

  if (removeIndices.size === 0) {
    return { changed: false, removedCount: 0, flaggedReview };
  }

  caseRecord.options = options.filter((_, index) => !removeIndices.has(index));
  return { changed: true, removedCount: removeIndices.size, flaggedReview };
}

mkdirSync(join(__dirname, 'output'), { recursive: true });

const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const report = JSON.parse(readFileSync(REPORT_FILE, 'utf8'));
const byId = new Map(cases.map((caseRecord) => [getCaseId(caseRecord), caseRecord]));

const modifiedCaseIds = new Set();
const remainingManualReviewIds = new Set((report.no_options ?? []).map((id) => String(id)));
const summary = {
  generated_at: new Date().toISOString(),
  script: 'ingestion/data-quality-phase2.mjs',
  based_on_commit: 'c46ead1',
  modified_cases: 0,
  remaining_manual_review_cases: 0,
  categories: {
    no_correct_answer: {
      targeted: report.no_correct_answer?.length ?? 0,
      resolved: 0,
      via_cop: 0,
      via_answer: 0,
      via_answer_idx: 0,
      via_rationale_letter: 0,
      via_rationale_text: 0,
      via_distractor_gap: 0,
      marked_needs_review: 0,
    },
    truncated_question: {
      targeted: report.truncated_question?.length ?? 0,
      meta_truncated_set: 0,
    },
    truncated_options: {
      targeted: report.truncated_options?.length ?? 0,
      empty_placeholder_set: 0,
      single_letter_review_flagged: 0,
    },
    aota_suspect: {
      targeted: report.aota_suspect?.length ?? 0,
      special_answer_cases: 0,
      verified_consistent: 0,
      flagged_for_review: 0,
      no_action_not_correct: 0,
    },
    duplicate_options: {
      targeted: report.duplicate_options?.length ?? 0,
      deduped_cases: 0,
      removed_options: 0,
      flagged_for_review: 0,
    },
    carryover: {
      no_options: report.no_options?.length ?? 0,
    },
  },
};

for (const caseId of report.no_correct_answer ?? []) {
  const caseRecord = byId.get(String(caseId));
  if (!caseRecord) {
    continue;
  }

  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  if (options.length === 0) {
    if (markNeedsReview(caseRecord)) {
      modifiedCaseIds.add(caseId);
    }
    remainingManualReviewIds.add(String(caseId));
    summary.categories.no_correct_answer.marked_needs_review += 1;
    continue;
  }

  if (caseRecord.q_type !== 'MCQ') {
    if (markNeedsReview(caseRecord)) {
      modifiedCaseIds.add(caseId);
    }
    remainingManualReviewIds.add(String(caseId));
    summary.categories.no_correct_answer.marked_needs_review += 1;
    continue;
  }

  let resolved = findAnswerIndexFromFields(caseRecord, options);
  if (resolved.index === null) {
    resolved = findAnswerIndexFromRationale(caseRecord, options);
  }

  if (resolved.index !== null && setSingleCorrectOption(options, resolved.index)) {
    modifiedCaseIds.add(caseId);
    summary.categories.no_correct_answer.resolved += 1;
    if (resolved.strategy === 'cop') {
      summary.categories.no_correct_answer.via_cop += 1;
    } else if (resolved.strategy === 'answer') {
      summary.categories.no_correct_answer.via_answer += 1;
    } else if (resolved.strategy === 'answer_idx') {
      summary.categories.no_correct_answer.via_answer_idx += 1;
    } else if (resolved.strategy === 'rationale_letter') {
      summary.categories.no_correct_answer.via_rationale_letter += 1;
    } else if (resolved.strategy === 'rationale_text') {
      summary.categories.no_correct_answer.via_rationale_text += 1;
    } else if (resolved.strategy === 'distractor_gap') {
      summary.categories.no_correct_answer.via_distractor_gap += 1;
    }
    continue;
  }

  if (markNeedsReview(caseRecord)) {
    modifiedCaseIds.add(caseId);
  }
  remainingManualReviewIds.add(String(caseId));
  summary.categories.no_correct_answer.marked_needs_review += 1;
}

for (const caseId of report.truncated_question ?? []) {
  const caseRecord = byId.get(String(caseId));
  if (!caseRecord) {
    continue;
  }

  const meta = ensureMeta(caseRecord);
  if (meta.truncated !== true) {
    meta.truncated = true;
    summary.categories.truncated_question.meta_truncated_set += 1;
    modifiedCaseIds.add(caseId);
  }
}

for (const caseId of report.truncated_options ?? []) {
  const caseRecord = byId.get(String(caseId));
  if (!caseRecord || caseRecord.q_type === 'SCT') {
    continue;
  }

  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  let caseChanged = false;
  let reviewFlagged = false;

  for (const option of options) {
    const text = normalizeWhitespace(option?.text);

    if (!text) {
      option.text = '(empty option)';
      summary.categories.truncated_options.empty_placeholder_set += 1;
      caseChanged = true;
      if (markNeedsReview(caseRecord)) {
        reviewFlagged = true;
      }
      continue;
    }

    if (/^[A-E]$/i.test(text)) {
      if (markNeedsReview(caseRecord)) {
        reviewFlagged = true;
      }
    }
  }

  if (reviewFlagged) {
    summary.categories.truncated_options.single_letter_review_flagged += 1;
    remainingManualReviewIds.add(String(caseId));
  }

  if (caseChanged || reviewFlagged) {
    modifiedCaseIds.add(caseId);
  }
}

for (const caseId of report.aota_suspect ?? []) {
  const caseRecord = byId.get(String(caseId));
  if (!caseRecord) {
    continue;
  }

  const options = Array.isArray(caseRecord.options) ? caseRecord.options : [];
  const specialOption = options.find((option) => AOTA_REGEX.test(String(option?.text ?? '')));

  if (!specialOption?.is_correct) {
    summary.categories.aota_suspect.no_action_not_correct += 1;
    continue;
  }

  summary.categories.aota_suspect.special_answer_cases += 1;

  const rationale = getRationaleText(caseRecord);
  const otherOptions = options.filter((option) => option !== specialOption);
  const explainsAllOtherOptions =
    rationale &&
    otherOptions.length > 0 &&
    otherOptions.every((option) => rationaleMentionsOption(rationale, option?.text));

  const meta = ensureMeta(caseRecord);

  if (explainsAllOtherOptions) {
    if (meta.answer_verified !== 'aota_consistent') {
      meta.answer_verified = 'aota_consistent';
      modifiedCaseIds.add(caseId);
    }
    summary.categories.aota_suspect.verified_consistent += 1;
    continue;
  }

  let changed = false;
  if (meta.aota_suspect !== true) {
    meta.aota_suspect = true;
    changed = true;
  }
  if (markNeedsReview(caseRecord)) {
    changed = true;
  }

  if (changed) {
    modifiedCaseIds.add(caseId);
  }

  summary.categories.aota_suspect.flagged_for_review += 1;
  remainingManualReviewIds.add(String(caseId));
}

for (const caseId of report.duplicate_options ?? []) {
  const caseRecord = byId.get(String(caseId));
  if (!caseRecord) {
    continue;
  }

  const dedupeResult = dedupeOptions(caseRecord);
  let changed = dedupeResult.changed;

  if (dedupeResult.changed) {
    summary.categories.duplicate_options.deduped_cases += 1;
    summary.categories.duplicate_options.removed_options += dedupeResult.removedCount;
  }

  if (dedupeResult.flaggedReview) {
    if (markNeedsReview(caseRecord)) {
      changed = true;
    }
    summary.categories.duplicate_options.flagged_for_review += 1;
    remainingManualReviewIds.add(String(caseId));
  }

  if (changed) {
    modifiedCaseIds.add(caseId);
  }
}

summary.modified_cases = modifiedCaseIds.size;
summary.remaining_manual_review_cases = remainingManualReviewIds.size;
report.phase2 = summary;

writeJsonAtomically(DATA_FILE, cases);
writeJsonAtomically(REPORT_FILE, report);

console.log('=== DATA QUALITY PHASE 2 ===');
console.log(`Total cases: ${formatCount(cases.length)}`);
console.log(`Cases modified: ${formatCount(summary.modified_cases)}`);
console.log(`Remaining for manual review: ${formatCount(summary.remaining_manual_review_cases)}`);
console.log('Breakdown:');
console.log(
  `  No correct answer: ${formatCount(summary.categories.no_correct_answer.targeted)} targeted, ${formatCount(summary.categories.no_correct_answer.resolved)} resolved, ${formatCount(summary.categories.no_correct_answer.marked_needs_review)} marked for review`,
);
console.log(
  `  Truncated question: ${formatCount(summary.categories.truncated_question.meta_truncated_set)} meta.truncated flags set`,
);
console.log(
  `  Truncated options: ${formatCount(summary.categories.truncated_options.empty_placeholder_set)} empty placeholders, ${formatCount(summary.categories.truncated_options.single_letter_review_flagged)} review flags`,
);
console.log(
  `  AOTA suspect: ${formatCount(summary.categories.aota_suspect.verified_consistent)} verified, ${formatCount(summary.categories.aota_suspect.flagged_for_review)} flagged for review`,
);
console.log(
  `  Duplicate options: ${formatCount(summary.categories.duplicate_options.deduped_cases)} cases deduped, ${formatCount(summary.categories.duplicate_options.removed_options)} options removed, ${formatCount(summary.categories.duplicate_options.flagged_for_review)} flagged for review`,
);
console.log(`Report written: ${REPORT_FILE}`);
console.log(`Data written: ${DATA_FILE}`);
