import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const OUTPUT_DIR = join(__dirname, 'output');
const OUTPUT_FILE = join(OUTPUT_DIR, 'quality_report_full.json');
const IMAGES_DIR = join(__dirname, '..', 'public', 'images', 'cases');

const CATEGORY_ORDER = [
  'rationale_contradicts_answer',
  'except_logic_suspect',
  'duplicate_question',
  'encoding_broken',
  'mixed_language',
  'no_question_text',
  'no_option_text',
  'question_too_short',
  'broken_image',
  'sct_missing_votes',
  'sct_wrong_option_count',
  'sct_no_rationale',
  'medexpqa_incomplete',
  'pubmedqa_incomplete',
  'all_options_same',
  'answer_in_question',
  'single_option',
  'too_many_options',
  'no_rationale',
  'rationale_too_short',
  'rationale_placeholder',
];

const ENCODING_REGEX =
  /(?:\u00E2\u20AC\u2122|\u00E2\u20AC\u201D|\u00E2\u20AC"|\u00E2\u20AC\u0153|\u00E2\u20AC\u009D|\u00E2\u20AC|\u00C3\u00A9|\u00C3\u00A1|\u00C3\u00B1|\u00C2(?=[^\p{L}\p{N}\s])|\u00EF\u00BF\u00BD|&#x[0-9a-f]+;|\\u00[0-9a-f]{2})/iu;
const MIXED_LANGUAGE_REGEX = /señal|diagnóstico|tratamiento|es una|não|रोग|উত্তর/i;
const NEGATIVE_QUESTION_REGEX = /\b(?:except|false|incorrect|not true|wrong|least likely|least appropriate|not correct)\b/i;
const NEGATIVE_CONTEXT_REGEX = /\b(?:not|except|incorrect|false|wrong|least|never|contraindicated|bukan|tidak|without)\b/i;
const POSITIVE_CONTEXT_REGEX = /\b(?:is|are|was|were|causes?|caused by|associated with|seen in|used for|treats?|recommended|first line|most common|classic|feature of|diagnosis|answer)\b/i;
const URL_ONLY_REGEX = /^(?:https?:\/\/\S+|www\.\S+)$/i;
const RATIONALE_PLACEHOLDER_REGEX = /^(?:reference\s*:.*|see reference(?: for detailed explanation)?\.?)$/i;
const UNAVAILABLE_RATIONALE_REGEX = /^explanation unavailable\.$/i;
const ANSWER_LETTER_PATTERNS = [
  /\b(?:correct answer|best answer|answer|jawaban(?:nya)?|diagnosis(?: paling mungkin| paling tepat)?|correct option)\s*(?:is|adalah|:|=)?\s*(?:option\s*|choice\s*)?\(?([A-F])\)?\b/i,
  /\boption\s*\(?([A-F])\)?\s*(?:is|was)\s*(?:the\s+)?(?:correct|best|right)\b/i,
];
const ANSWER_TEXT_PATTERNS = [
  /(?:correct answer|best answer|answer|jawaban(?:nya)?|diagnosis(?: paling mungkin| paling tepat)?|correct option)\s*(?:is|adalah|:|=)\s*["“]?([^"”.\n]{3,160})/i,
  /["“]([^"”\n]{3,160})["”]\s+is\s+(?:the\s+)?(?:correct|best|right|diagnosis|answer)/i,
];
const EXPECTED_SCT_LABELS = new Set(['-2', '-1', '0', '+1', '+2']);
const EXPECTED_PUBMEDQA_OPTIONS = new Set(['yes', 'no', 'maybe']);

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
    .replace(/['"“”‘’`]/g, '')
    .replace(/[^a-z0-9+/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCaseId(caseRecord) {
  return String(caseRecord.hash_id ?? caseRecord._id);
}

function getSource(caseRecord) {
  return String(caseRecord?.meta?.source ?? caseRecord?.source ?? '').toLowerCase();
}

function getQuestionField(caseRecord) {
  return normalizeWhitespace(caseRecord?.question);
}

function getPromptField(caseRecord) {
  return normalizeWhitespace(caseRecord?.prompt);
}

function getNarrativeField(caseRecord) {
  return normalizeWhitespace(caseRecord?.vignette?.narrative);
}

function getBestQuestionText(caseRecord) {
  const candidates = [
    getQuestionField(caseRecord),
    getNarrativeField(caseRecord),
    getPromptField(caseRecord),
    normalizeWhitespace(caseRecord?.title),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

function getRationaleText(caseRecord) {
  if (typeof caseRecord?.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }

  if (
    caseRecord?.rationale &&
    typeof caseRecord.rationale === 'object' &&
    typeof caseRecord.rationale.correct === 'string'
  ) {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }

  return '';
}

function getOptions(caseRecord) {
  return Array.isArray(caseRecord?.options) ? caseRecord.options : [];
}

function getCorrectIndices(options) {
  const indices = [];
  for (let index = 0; index < options.length; index += 1) {
    if (options[index]?.is_correct === true) {
      indices.push(index);
    }
  }
  return indices;
}

function matchOptionByLetter(letter, options) {
  const normalized = String(letter ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const byId = options.findIndex((option) => String(option?.id ?? '').trim().toUpperCase() === normalized);
  if (byId !== -1) {
    return byId;
  }

  const alphabetIndex = normalized.charCodeAt(0) - 65;
  return alphabetIndex >= 0 && alphabetIndex < options.length ? alphabetIndex : null;
}

function matchOptionByText(candidate, options) {
  const normalizedCandidate = normalizeComparable(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  const matching = [];
  for (let index = 0; index < options.length; index += 1) {
    const optionComparable = normalizeComparable(options[index]?.text);
    if (!optionComparable) {
      continue;
    }

    if (
      normalizedCandidate === optionComparable ||
      normalizedCandidate.includes(optionComparable) ||
      optionComparable.includes(normalizedCandidate)
    ) {
      matching.push(index);
    }
  }

  return matching.length === 1 ? matching[0] : null;
}

function findRationaleReferencedAnswerIndex(rationaleText, options) {
  if (!rationaleText || options.length === 0) {
    return null;
  }

  for (const pattern of ANSWER_LETTER_PATTERNS) {
    const match = rationaleText.match(pattern);
    if (!match) {
      continue;
    }

    const optionIndex = matchOptionByLetter(match[1], options);
    if (optionIndex !== null) {
      return optionIndex;
    }
  }

  for (const pattern of ANSWER_TEXT_PATTERNS) {
    const match = rationaleText.match(pattern);
    if (!match) {
      continue;
    }

    const optionIndex = matchOptionByText(match[1], options);
    if (optionIndex !== null) {
      return optionIndex;
    }
  }

  const comparableRationale = normalizeComparable(rationaleText);
  if (!comparableRationale) {
    return null;
  }

  for (let index = 0; index < options.length; index += 1) {
    const optionComparable = normalizeComparable(options[index]?.text);
    if (
      !optionComparable ||
      optionComparable.length < 5 ||
      optionComparable.length > 120 ||
      !comparableRationale.includes(optionComparable)
    ) {
      continue;
    }

    const position = comparableRationale.indexOf(optionComparable);
    const windowStart = Math.max(0, position - 30);
    const windowEnd = Math.min(
      comparableRationale.length,
      position + optionComparable.length + 30,
    );
    const windowText = comparableRationale.slice(windowStart, windowEnd);
    const hasCueWord =
      /\b(?:correct|best|right|answer|diagnosis|treatment)\b/i.test(windowText) &&
      /\b(?:is|are|was|were)\b/i.test(windowText);

    if (hasCueWord) {
      return index;
    }
  }

  return null;
}

function looksLikeExceptLogicTrap(questionText) {
  return NEGATIVE_QUESTION_REGEX.test(questionText);
}

function positiveRationaleForCorrectOption(rationaleText, correctOptionText) {
  const comparableRationale = normalizeComparable(rationaleText);
  const comparableOption = normalizeComparable(correctOptionText);

  if (!comparableRationale || !comparableOption || comparableOption.length < 5) {
    return false;
  }

  const position = comparableRationale.indexOf(comparableOption);
  if (position === -1) {
    return false;
  }

  const windowStart = Math.max(0, position - 40);
  const windowEnd = Math.min(comparableRationale.length, position + comparableOption.length + 40);
  const windowText = comparableRationale.slice(windowStart, windowEnd);

  if (NEGATIVE_CONTEXT_REGEX.test(windowText)) {
    return false;
  }

  return POSITIVE_CONTEXT_REGEX.test(windowText);
}

function normalizeDuplicatePrefix(text) {
  return normalizeComparable(text).slice(0, 80);
}

function resolveImageReference(image) {
  const raw = typeof image === 'string'
    ? image
    : normalizeWhitespace(image?.path ?? image?.src ?? image?.url);
  const normalized = normalizeWhitespace(raw);

  if (!normalized || /^(?:https?:|data:)/i.test(normalized)) {
    return null;
  }

  const trimmed = normalized.replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
  if (trimmed.startsWith('images/cases/')) {
    return join(IMAGES_DIR, trimmed.slice('images/cases/'.length));
  }
  if (trimmed.startsWith('public/images/cases/')) {
    return join(IMAGES_DIR, trimmed.slice('public/images/cases/'.length));
  }

  return join(IMAGES_DIR, basename(trimmed));
}

function hasExpectedSctLabels(options) {
  const labels = new Set();

  for (const option of options) {
    const idLabel = normalizeWhitespace(option?.id);
    const textLabel = normalizeWhitespace(option?.text);
    if (EXPECTED_SCT_LABELS.has(idLabel)) {
      labels.add(idLabel);
    }
    if (EXPECTED_SCT_LABELS.has(textLabel)) {
      labels.add(textLabel);
    }
  }

  return labels.size === EXPECTED_SCT_LABELS.size;
}

function createCaseCategoryStore() {
  return Object.fromEntries(
    CATEGORY_ORDER.filter((category) => category !== 'duplicate_question').map((category) => [category, new Set()]),
  );
}

function flag(store, category, caseId) {
  store[category].add(caseId);
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

function main() {
  const startedAt = Date.now();
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const categoryStore = createCaseCategoryStore();
  const duplicatePrefixMap = new Map();
  const brokenImageDetails = [];

  for (const caseRecord of cases) {
    const caseId = getCaseId(caseRecord);
    const source = getSource(caseRecord);
    const questionText = getBestQuestionText(caseRecord);
    const questionField = getQuestionField(caseRecord);
    const promptField = getPromptField(caseRecord);
    const narrativeField = getNarrativeField(caseRecord);
    const rationaleText = getRationaleText(caseRecord);
    const options = getOptions(caseRecord);
    const optionTexts = options.map((option) => normalizeWhitespace(option?.text));
    const optionComparableTexts = optionTexts.map((text) => normalizeComparable(text));
    const correctIndices = getCorrectIndices(options);
    const correctIndex = correctIndices.length === 1 ? correctIndices[0] : null;
    const correctOptionText = correctIndex === null ? '' : optionTexts[correctIndex];

    const duplicatePrefix = normalizeDuplicatePrefix(questionText);
    if (duplicatePrefix.length >= 25) {
      if (!duplicatePrefixMap.has(duplicatePrefix)) {
        duplicatePrefixMap.set(duplicatePrefix, { ids: [], sources: new Set() });
      }
      const entry = duplicatePrefixMap.get(duplicatePrefix);
      entry.ids.push(caseId);
      if (source) {
        entry.sources.add(source);
      }
    }

    const structuralQuestionText = [questionField, promptField, narrativeField].some(Boolean);
    if (!structuralQuestionText) {
      flag(categoryStore, 'no_question_text', caseId);
    }

    if (!narrativeField && questionText && questionText.length < 15) {
      flag(categoryStore, 'question_too_short', caseId);
    }

    const nonEmptyOptionTexts = optionTexts.filter(Boolean);
    if (options.length === 0 || nonEmptyOptionTexts.length === 0) {
      flag(categoryStore, 'no_option_text', caseId);
    }

    if (options.length === 1) {
      flag(categoryStore, 'single_option', caseId);
    }

    if (options.length > 6) {
      flag(categoryStore, 'too_many_options', caseId);
    }

    if (
      optionComparableTexts.length > 1 &&
      optionComparableTexts.every(Boolean) &&
      new Set(optionComparableTexts).size === 1
    ) {
      flag(categoryStore, 'all_options_same', caseId);
    }

    if (
      correctIndex !== null &&
      questionText &&
      correctOptionText &&
      normalizeComparable(correctOptionText).length >= 8 &&
      normalizeComparable(questionText).includes(normalizeComparable(correctOptionText))
    ) {
      flag(categoryStore, 'answer_in_question', caseId);
    }

    const contradictionIndex = findRationaleReferencedAnswerIndex(rationaleText, options);
    if (correctIndex !== null && contradictionIndex !== null && contradictionIndex !== correctIndex) {
      flag(categoryStore, 'rationale_contradicts_answer', caseId);
    }

    if (
      correctIndex !== null &&
      looksLikeExceptLogicTrap(questionText) &&
      rationaleText &&
      positiveRationaleForCorrectOption(rationaleText, correctOptionText)
    ) {
      flag(categoryStore, 'except_logic_suspect', caseId);
    }

    const encodingText = [questionField, promptField, narrativeField, ...optionTexts].join(' ');
    if (ENCODING_REGEX.test(encodingText)) {
      flag(categoryStore, 'encoding_broken', caseId);
    }

    const languageText = [questionText, ...optionTexts, rationaleText].join(' ');
    if (source !== 'medexpqa' && MIXED_LANGUAGE_REGEX.test(languageText)) {
      flag(categoryStore, 'mixed_language', caseId);
    }

    if (Array.isArray(caseRecord.images) && caseRecord.images.length > 0) {
      let missingImage = false;
      for (const image of caseRecord.images) {
        const resolved = resolveImageReference(image);
        if (!resolved) {
          continue;
        }

        if (!existsSync(resolved)) {
          missingImage = true;
          brokenImageDetails.push({ case_id: caseId, missing_path: resolved });
        }
      }
      if (missingImage) {
        flag(categoryStore, 'broken_image', caseId);
      }
    }

    if (caseRecord.q_type === 'SCT') {
      const votedOptions = options.filter((option) => Number(option?.sct_panel_votes) > 0).length;
      if (votedOptions < 2) {
        flag(categoryStore, 'sct_missing_votes', caseId);
      }
      if (options.length !== 5 || !hasExpectedSctLabels(options)) {
        flag(categoryStore, 'sct_wrong_option_count', caseId);
      }
      if (!rationaleText) {
        flag(categoryStore, 'sct_no_rationale', caseId);
      }
    }

    if (source === 'medexpqa') {
      const hasCompleteOptions = options.length > 0 && options.every((option) => normalizeWhitespace(option?.text));
      const hasSingleCorrect = correctIndices.length === 1;
      const medexpQuestion = questionField || promptField;
      if (!hasCompleteOptions || !hasSingleCorrect || medexpQuestion.length <= 30) {
        flag(categoryStore, 'medexpqa_incomplete', caseId);
      }
    }

    if (source === 'pubmedqa') {
      const pubmedQuestion = questionField || promptField;
      const pubmedOptionSet = new Set(optionComparableTexts.filter(Boolean));
      const hasExpectedOptions =
        options.length === 3 &&
        pubmedOptionSet.size === EXPECTED_PUBMEDQA_OPTIONS.size &&
        [...EXPECTED_PUBMEDQA_OPTIONS].every((label) => pubmedOptionSet.has(label));
      if (!hasExpectedOptions || correctIndices.length !== 1 || !pubmedQuestion.endsWith('?')) {
        flag(categoryStore, 'pubmedqa_incomplete', caseId);
      }
    }

    if (UNAVAILABLE_RATIONALE_REGEX.test(rationaleText)) {
      flag(categoryStore, 'no_rationale', caseId);
    }

    if (rationaleText.length < 10) {
      flag(categoryStore, 'rationale_too_short', caseId);
    }

    if (URL_ONLY_REGEX.test(rationaleText) || RATIONALE_PLACEHOLDER_REGEX.test(rationaleText)) {
      flag(categoryStore, 'rationale_placeholder', caseId);
    }
  }

  const duplicateGroups = [];
  const duplicateCaseIds = new Set();
  for (const entry of duplicatePrefixMap.values()) {
    const uniqueIds = [...new Set(entry.ids)];
    if (uniqueIds.length < 2 || entry.sources.size < 2) {
      continue;
    }

    uniqueIds.sort((left, right) => left.localeCompare(right));
    duplicateGroups.push(uniqueIds);
    uniqueIds.forEach((caseId) => duplicateCaseIds.add(caseId));
  }

  duplicateGroups.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));

  const flaggedCases = new Set();
  const byCategory = {};

  for (const category of CATEGORY_ORDER) {
    if (category === 'duplicate_question') {
      duplicateCaseIds.forEach((caseId) => flaggedCases.add(caseId));
      byCategory[category] = {
        count: duplicateCaseIds.size,
        group_count: duplicateGroups.length,
        groups: duplicateGroups,
      };
      continue;
    }

    const caseIds = [...categoryStore[category]].sort((left, right) => left.localeCompare(right));
    caseIds.forEach((caseId) => flaggedCases.add(caseId));
    byCategory[category] = {
      count: caseIds.length,
      case_ids: caseIds,
    };
    if (category === 'broken_image') {
      byCategory[category].missing_files = brokenImageDetails;
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    total_cases: cases.length,
    clean_cases: cases.length - flaggedCases.size,
    flagged_cases: flaggedCases.size,
    by_category: byCategory,
    runtime_ms: Date.now() - startedAt,
  };

  writeJsonAtomically(OUTPUT_FILE, report);

  const tableRows = CATEGORY_ORDER.map((category) => ({
    category,
    count: formatCount(byCategory[category].count),
  }));

  console.log('=== FULL QUALITY AUDIT ===');
  console.log(`Total cases: ${formatCount(report.total_cases)}`);
  console.log(`Flagged cases: ${formatCount(report.flagged_cases)}`);
  console.log(`Clean cases: ${formatCount(report.clean_cases)}`);
  console.log(`Runtime: ${formatCount(report.runtime_ms)} ms`);
  console.table(tableRows);
}

main();
