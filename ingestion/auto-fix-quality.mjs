import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'quality_report_full.json');

const UNAVAILABLE_RATIONALE_REGEX = /^explanation unavailable\.$/i;
const URL_ONLY_REGEX = /^(?:https?:\/\/\S+|www\.\S+)$/i;
const REFERENCE_PREFIX_REGEX = /^(?:reference|see reference)\b/i;
const MOJIBAKE_REPLACEMENTS = [
  ['â€™', "'"],
  ['â€"', '—'],
  ['â€œ', '"'],
  ['â€\x9d', '"'],
  ['â€', '"'],
  ['Ã©', 'é'],
  ['Ã¡', 'á'],
  ['Ã±', 'ñ'],
  [' â ', ' à '],
  ['Â', ''],
];
const QUALITY_SCORE_TIERS = [
  { min: 300, points: 300 },
  { min: 120, points: 180 },
  { min: 40, points: 90 },
  { min: 10, points: 30 },
];

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getCaseId(caseRecord) {
  return String(caseRecord.hash_id ?? caseRecord._id);
}

function buildCaseMap(cases) {
  const caseMap = new Map();

  for (const caseRecord of cases) {
    caseMap.set(String(caseRecord._id), caseRecord);
    if (caseRecord.hash_id) {
      caseMap.set(String(caseRecord.hash_id), caseRecord);
    }
  }

  return caseMap;
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

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function ensureRationaleObject(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object') {
    const existing = typeof caseRecord.rationale === 'string' ? normalizeWhitespace(caseRecord.rationale) : '';
    caseRecord.rationale = {
      correct: existing,
      distractors: {},
      pearl: null,
    };
  }

  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }

  if (!Object.prototype.hasOwnProperty.call(caseRecord.rationale, 'pearl')) {
    caseRecord.rationale.pearl = null;
  }

  return caseRecord.rationale;
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

function sentenceCount(text) {
  return (text.match(/[.?!]/g) ?? []).length;
}

function isPlaceholderRationale(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  if (UNAVAILABLE_RATIONALE_REGEX.test(normalized)) {
    return true;
  }

  if (URL_ONLY_REGEX.test(normalized)) {
    return true;
  }

  if (!REFERENCE_PREFIX_REGEX.test(normalized)) {
    return false;
  }

  if (/explanation\s*:/i.test(normalized)) {
    return false;
  }

  return normalized.length < 220 && sentenceCount(normalized) <= 1;
}

function isTooShortRationale(text) {
  return normalizeWhitespace(text).length < 10;
}

function collectRationaleCandidates(caseRecord) {
  const rationaleObject = caseRecord.rationale && typeof caseRecord.rationale === 'object'
    ? caseRecord.rationale
    : null;
  const meta = caseRecord.meta && typeof caseRecord.meta === 'object' ? caseRecord.meta : {};

  const rawCandidates = [
    typeof caseRecord.rationale === 'string' ? caseRecord.rationale : null,
    rationaleObject?.correct,
    rationaleObject?._original_correct,
    rationaleObject?.text,
    rationaleObject?.answer,
    rationaleObject?.explanation,
    rationaleObject?.long,
    caseRecord.full_answer,
    caseRecord.explanation,
    caseRecord.answer_explanation,
    caseRecord.answerExplanation,
    caseRecord.solution,
    meta.explanation,
    meta.full_answer,
    meta.answer_explanation,
    meta.answerExplanation,
    meta.solution,
    meta.rationale,
    meta.llm_rationale,
  ];

  const deduped = [];
  const seen = new Set();

  for (const candidate of rawCandidates) {
    const normalized = normalizeWhitespace(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function pickRecoveredRationale(caseRecord) {
  const candidates = collectRationaleCandidates(caseRecord)
    .filter((text) => !isPlaceholderRationale(text))
    .filter((text) => text.length > 10);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.length - left.length);
  return candidates[0];
}

function applyRecoveredRationale(caseRecord, text) {
  const rationale = ensureRationaleObject(caseRecord);
  if (normalizeWhitespace(rationale.correct) === text) {
    return false;
  }

  rationale.correct = text;
  return true;
}

function getRationaleQualityScore(caseRecord) {
  const rationaleText = pickRecoveredRationale(caseRecord) ?? getCurrentRationaleText(caseRecord);
  const length = rationaleText.length;

  for (const tier of QUALITY_SCORE_TIERS) {
    if (length >= tier.min) {
      return tier.points;
    }
  }

  return 0;
}

function getDemographicsScore(caseRecord) {
  const demographics = caseRecord?.vignette?.demographics;
  if (!demographics || typeof demographics !== 'object') {
    return 0;
  }

  let score = 0;
  for (const value of Object.values(demographics)) {
    if (value !== null && value !== undefined && normalizeWhitespace(value)) {
      score += 1;
    }
  }

  return score;
}

function getConfidenceScore(caseRecord) {
  if (Number.isFinite(caseRecord?.confidence)) {
    return Number(caseRecord.confidence);
  }

  const auditConfidence = String(caseRecord?.meta?.audit_confidence ?? '').toUpperCase();
  if (auditConfidence === 'HIGH') return 3;
  if (auditConfidence === 'MEDIUM') return 2;
  if (auditConfidence === 'LOW') return 1;
  return 0;
}

function getDuplicateQualityTuple(caseRecord) {
  return [
    caseRecord?.meta?.quarantined === true ? 0 : 1,
    getRationaleQualityScore(caseRecord),
    getDemographicsScore(caseRecord),
    getConfidenceScore(caseRecord),
    normalizeWhitespace(caseRecord?.vignette?.narrative).length,
    Array.isArray(caseRecord?.options) ? caseRecord.options.length : 0,
  ];
}

function compareTuples(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function setQuarantine(caseRecord, reason) {
  const meta = ensureMeta(caseRecord);
  const wasQuarantined = meta.quarantined === true;
  const previousReason = meta.quarantine_reason;

  meta.quarantined = true;
  meta.quarantine_reason = reason;

  return !wasQuarantined || previousReason !== reason;
}

function clearDuplicateQuarantine(caseRecord) {
  const meta = ensureMeta(caseRecord);
  let changed = false;

  if (meta.quarantined === true && meta.quarantine_reason === 'duplicate') {
    meta.quarantined = false;
    delete meta.quarantine_reason;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(meta, 'duplicate_of')) {
    delete meta.duplicate_of;
    changed = true;
  }

  return changed;
}

function applyMojibakeReplacements(text) {
  let next = String(text);
  let changed = false;

  for (const [search, replacement] of MOJIBAKE_REPLACEMENTS) {
    if (next.includes(search)) {
      next = next.split(search).join(replacement);
      changed = true;
    }
  }

  return { changed, value: next };
}

function fixEncodingOnCase(caseRecord) {
  let changed = false;
  let fieldChanges = 0;

  function mutateString(value, setter) {
    if (typeof value !== 'string') {
      return;
    }

    const result = applyMojibakeReplacements(value);
    if (result.changed) {
      setter(result.value);
      changed = true;
      fieldChanges += 1;
    }
  }

  mutateString(caseRecord.question, (value) => {
    caseRecord.question = value;
  });
  mutateString(caseRecord.prompt, (value) => {
    caseRecord.prompt = value;
  });
  mutateString(caseRecord.title, (value) => {
    caseRecord.title = value;
  });

  if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    mutateString(caseRecord.vignette.narrative, (value) => {
      caseRecord.vignette.narrative = value;
    });
    mutateString(caseRecord.vignette.labFindings, (value) => {
      caseRecord.vignette.labFindings = value;
    });
  }

  if (Array.isArray(caseRecord.options)) {
    for (const option of caseRecord.options) {
      mutateString(option?.text, (value) => {
        option.text = value;
      });
    }
  }

  if (typeof caseRecord.rationale === 'string') {
    mutateString(caseRecord.rationale, (value) => {
      caseRecord.rationale = value;
    });
  } else if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    mutateString(caseRecord.rationale.correct, (value) => {
      caseRecord.rationale.correct = value;
    });
    mutateString(caseRecord.rationale._original_correct, (value) => {
      caseRecord.rationale._original_correct = value;
    });
    mutateString(caseRecord.rationale.pearl, (value) => {
      caseRecord.rationale.pearl = value;
    });
    if (caseRecord.rationale.distractors && typeof caseRecord.rationale.distractors === 'object') {
      for (const [key, value] of Object.entries(caseRecord.rationale.distractors)) {
        mutateString(value, (next) => {
          caseRecord.rationale.distractors[key] = next;
        });
      }
    }
  }

  return { changed, fieldChanges };
}

function getCaseIds(report, category) {
  return report?.by_category?.[category]?.case_ids ?? [];
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const report = JSON.parse(readFileSync(REPORT_FILE, 'utf8'));
  const caseMap = buildCaseMap(cases);

  const summary = {
    duplicate_question: {
      groups: 0,
      groups_with_matches: 0,
      quarantined: 0,
      kept: 0,
      unquarantined_canonical: 0,
      missing_cases: 0,
    },
    rationale_placeholder: {
      targeted: 0,
      eligible_now: 0,
      recovered: 0,
      still_empty_or_placeholder: 0,
      skipped_currently_valid: 0,
    },
    rationale_too_short: {
      targeted: 0,
      eligible_now: 0,
      recovered: 0,
      still_short: 0,
      skipped_currently_valid: 0,
    },
    encoding_broken: {
      targeted: 0,
      fixed_cases: 0,
      field_changes: 0,
    },
    mixed_language: {
      targeted: 0,
      flagged: 0,
    },
    all_options_same: {
      targeted: 0,
      quarantined: 0,
    },
    single_option: {
      targeted: 0,
      quarantined: 0,
    },
    no_option_text: {
      targeted: 0,
      quarantined: 0,
    },
  };

  let mutated = false;
  const duplicateQuarantinedIds = new Set();

  const duplicateGroups = report?.by_category?.duplicate_question?.groups ?? [];
  summary.duplicate_question.groups = duplicateGroups.length;

  for (const rawGroup of duplicateGroups) {
    const resolvedCases = [];
    for (const id of rawGroup) {
      const caseRecord = caseMap.get(String(id));
      if (!caseRecord) {
        summary.duplicate_question.missing_cases += 1;
        continue;
      }
      resolvedCases.push(caseRecord);
    }

    if (resolvedCases.length < 2) {
      continue;
    }

    summary.duplicate_question.groups_with_matches += 1;
    resolvedCases.sort((left, right) => {
      const diff = compareTuples(getDuplicateQualityTuple(right), getDuplicateQualityTuple(left));
      if (diff !== 0) {
        return diff;
      }

      return getCaseId(left).localeCompare(getCaseId(right));
    });

    const canonical = resolvedCases[0];
    summary.duplicate_question.kept += 1;
    if (clearDuplicateQuarantine(canonical)) {
      mutated = true;
      summary.duplicate_question.unquarantined_canonical += 1;
    }

    for (let index = 1; index < resolvedCases.length; index += 1) {
      if (setQuarantine(resolvedCases[index], 'duplicate')) {
        mutated = true;
      }
      const meta = ensureMeta(resolvedCases[index]);
      if (meta.duplicate_of !== getCaseId(canonical)) {
        meta.duplicate_of = getCaseId(canonical);
        mutated = true;
      }
      duplicateQuarantinedIds.add(getCaseId(resolvedCases[index]));
    }
  }

  summary.duplicate_question.quarantined = duplicateQuarantinedIds.size;

  for (const caseId of getCaseIds(report, 'rationale_placeholder')) {
    summary.rationale_placeholder.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    const current = getCurrentRationaleText(caseRecord);
    if (!isPlaceholderRationale(current)) {
      summary.rationale_placeholder.skipped_currently_valid += 1;
      continue;
    }

    summary.rationale_placeholder.eligible_now += 1;
    const recovered = pickRecoveredRationale(caseRecord);
    if (recovered && applyRecoveredRationale(caseRecord, recovered)) {
      mutated = true;
      summary.rationale_placeholder.recovered += 1;
      continue;
    }

    if (!recovered) {
      summary.rationale_placeholder.still_empty_or_placeholder += 1;
    }
  }

  for (const caseId of getCaseIds(report, 'rationale_too_short')) {
    summary.rationale_too_short.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    const current = getCurrentRationaleText(caseRecord);
    if (!isTooShortRationale(current)) {
      summary.rationale_too_short.skipped_currently_valid += 1;
      continue;
    }

    summary.rationale_too_short.eligible_now += 1;
    const recovered = pickRecoveredRationale(caseRecord);
    if (recovered && applyRecoveredRationale(caseRecord, recovered)) {
      mutated = true;
      summary.rationale_too_short.recovered += 1;
      continue;
    }

    summary.rationale_too_short.still_short += 1;
  }

  for (const caseId of getCaseIds(report, 'encoding_broken')) {
    summary.encoding_broken.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    const result = fixEncodingOnCase(caseRecord);
    if (result.changed) {
      mutated = true;
      summary.encoding_broken.fixed_cases += 1;
      summary.encoding_broken.field_changes += result.fieldChanges;
    }
  }

  for (const caseId of getCaseIds(report, 'mixed_language')) {
    summary.mixed_language.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    const meta = ensureMeta(caseRecord);
    if (meta.mixed_language !== true) {
      meta.mixed_language = true;
      mutated = true;
      summary.mixed_language.flagged += 1;
    }
  }

  for (const caseId of getCaseIds(report, 'all_options_same')) {
    summary.all_options_same.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    if (setQuarantine(caseRecord, 'all_options_identical')) {
      mutated = true;
    }
    summary.all_options_same.quarantined += 1;
  }

  for (const caseId of getCaseIds(report, 'single_option')) {
    summary.single_option.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    if (setQuarantine(caseRecord, 'single_option')) {
      mutated = true;
    }
    summary.single_option.quarantined += 1;
  }

  for (const caseId of getCaseIds(report, 'no_option_text')) {
    summary.no_option_text.targeted += 1;
    const caseRecord = caseMap.get(String(caseId));
    if (!caseRecord) {
      continue;
    }

    if (setQuarantine(caseRecord, 'no_option_text')) {
      mutated = true;
    }
    summary.no_option_text.quarantined += 1;
  }

  if (mutated) {
    writeJsonAtomically(DATA_FILE, cases);
  }

  console.log('=== AUTO-FIX QUALITY ISSUES ===');
  console.table([
    {
      category: 'duplicate_question',
      targeted: formatCount(summary.duplicate_question.groups),
      fixed: formatCount(summary.duplicate_question.quarantined),
      remaining: formatCount(0),
      notes: `${formatCount(summary.duplicate_question.kept)} canonical kept`,
    },
    {
      category: 'rationale_placeholder',
      targeted: formatCount(summary.rationale_placeholder.targeted),
      fixed: formatCount(summary.rationale_placeholder.recovered),
      remaining: formatCount(summary.rationale_placeholder.still_empty_or_placeholder),
      notes: `${formatCount(summary.rationale_placeholder.skipped_currently_valid)} already valid now`,
    },
    {
      category: 'rationale_too_short',
      targeted: formatCount(summary.rationale_too_short.targeted),
      fixed: formatCount(summary.rationale_too_short.recovered),
      remaining: formatCount(summary.rationale_too_short.still_short),
      notes: `${formatCount(summary.rationale_too_short.skipped_currently_valid)} already valid now`,
    },
    {
      category: 'encoding_broken',
      targeted: formatCount(summary.encoding_broken.targeted),
      fixed: formatCount(summary.encoding_broken.fixed_cases),
      remaining: formatCount(0),
      notes: `${formatCount(summary.encoding_broken.field_changes)} fields updated`,
    },
    {
      category: 'mixed_language',
      targeted: formatCount(summary.mixed_language.targeted),
      fixed: formatCount(summary.mixed_language.flagged),
      remaining: formatCount(0),
      notes: 'meta.mixed_language set',
    },
    {
      category: 'all_options_same',
      targeted: formatCount(summary.all_options_same.targeted),
      fixed: formatCount(summary.all_options_same.quarantined),
      remaining: formatCount(0),
      notes: 'quarantined',
    },
    {
      category: 'single_option',
      targeted: formatCount(summary.single_option.targeted),
      fixed: formatCount(summary.single_option.quarantined),
      remaining: formatCount(0),
      notes: 'quarantined',
    },
    {
      category: 'no_option_text',
      targeted: formatCount(summary.no_option_text.targeted),
      fixed: formatCount(summary.no_option_text.quarantined),
      remaining: formatCount(0),
      notes: 'quarantined',
    },
  ]);
  console.log(mutated ? 'compiled_cases.json updated.' : 'No changes were needed.');
}

main();
