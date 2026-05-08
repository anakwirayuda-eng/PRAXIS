import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'ukmppd_duplicate_option_parser_repair_report.json');
const DRY_RUN = process.argv.includes('--dry-run');

const OPTION_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TARGET_SOURCES = new Set(['ukmppd-web', 'ukmppd-optima']);

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function compact(value, limit = 260) {
  return normalizeWhitespace(value).slice(0, limit);
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function comparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function getCaseCode(caseRecord) {
  return normalizeWhitespace(caseRecord.case_code || caseRecord.id || caseRecord.hash_id);
}

function getSource(caseRecord) {
  return normalizeWhitespace(caseRecord.meta?.source || caseRecord.source || '');
}

function hasDuplicateOptionIds(caseRecord) {
  const seen = new Set();
  for (const option of caseRecord.options || []) {
    const optionId = normalizeWhitespace(option?.id).toUpperCase();
    if (!optionId) continue;
    if (seen.has(optionId)) return true;
    seen.add(optionId);
  }
  return false;
}

function isTargetCase(caseRecord) {
  const source = getSource(caseRecord);
  const code = getCaseCode(caseRecord);
  return TARGET_SOURCES.has(source) || /^UK[WO]-/.test(code);
}

function isPromptLike(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return (
    /\?/.test(normalized)
    || /\.{3,}/.test(normalized)
    || /\b(diagnos|diagnosa|diagnosis|terapi|tatalaksana|tindakan|pemeriksaan|kemungkinan|apakah|berapakah|kaidah|edukasi|penyebab|metode|zat kimia|kepada siapa|yang tepat|paling tepat)\b/.test(normalized)
    || /\b(pasien|dokter|pada pemeriksaan|riwayat|keluhan|didapatkan|ditemukan|datang|dibawa)\b/.test(normalized)
  );
}

function isRationaleLike(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return (
    /\b(sumber|karena|sehingga|merupakan|manifestasi|gejala|risiko|menyebabkan|dapat|sedangkan|diagnosis|tatalaksana|pilihan|opsi|hal tersebut|menyingkirkan|berkewajiban)\b/.test(normalized)
    || /[.;:]\s*\w/.test(normalized)
  );
}

function artifactScore(option, index, groupSize) {
  const text = normalizeWhitespace(option?.text);
  let score = 0;
  if (option?.is_correct) score += 12;
  if (text.length <= 80) score += 4;
  if (text.length <= 45) score += 2;
  if (text.length > 120) score -= 8;
  if (text.length > 220) score -= 8;
  if (isPromptLike(text)) score -= 14;
  if (isRationaleLike(text)) score -= 12;
  if (index === 0 && groupSize > 1 && isPromptLike(text)) score -= 8;
  if (/^sumber\b/i.test(text)) score -= 18;
  if (/^yang harus dilakukan|^diagnosisnya|^kemungkinan diagnosis/i.test(text)) score -= 8;
  return score;
}

function chooseCanonicalOption(entries) {
  return [...entries].sort((left, right) => {
    const scoreDelta = artifactScore(right.option, right.index, entries.length) - artifactScore(left.option, left.index, entries.length);
    if (scoreDelta !== 0) return scoreDelta;
    const lengthDelta = normalizeWhitespace(left.option.text).length - normalizeWhitespace(right.option.text).length;
    if (lengthDelta !== 0) return lengthDelta;
    return left.index - right.index;
  })[0];
}

function appendUniqueText(current, addition) {
  const cleanAddition = normalizeDisplayText(addition);
  if (!cleanAddition) return current || '';
  const cleanCurrent = normalizeDisplayText(current || '');
  if (comparable(cleanCurrent).includes(comparable(cleanAddition))) return cleanCurrent;
  return normalizeDisplayText([cleanCurrent, cleanAddition].filter(Boolean).join(' '));
}

function appendRationale(caseRecord, fragments) {
  if (fragments.length === 0) return false;
  caseRecord.rationale = caseRecord.rationale || {};
  const addition = `Catatan pembahasan yang dipulihkan dari artefak parser: ${fragments.join(' ')}`;
  const before = caseRecord.rationale.correct || '';
  const after = appendUniqueText(before, addition);
  if (after === before) return false;
  caseRecord.rationale.correct = after;
  return true;
}

function appendStem(caseRecord, fragments) {
  if (fragments.length === 0) return false;
  caseRecord.vignette = caseRecord.vignette || {};
  const before = caseRecord.vignette.narrative || caseRecord.prompt || caseRecord.title || '';
  const after = appendUniqueText(before, fragments.join(' '));
  if (after === before) return false;
  caseRecord.vignette.narrative = after;
  return true;
}

function repairCase(caseRecord) {
  if (!Array.isArray(caseRecord.options) || !hasDuplicateOptionIds(caseRecord) || !isTargetCase(caseRecord)) {
    return null;
  }

  const originalOptions = caseRecord.options.map((option, index) => ({
    index,
    id: normalizeWhitespace(option?.id).toUpperCase(),
    text: normalizeWhitespace(option?.text),
    is_correct: Boolean(option?.is_correct),
  }));

  const correctIds = [...new Set(originalOptions.filter((option) => option.is_correct).map((option) => option.id).filter(Boolean))];
  if (correctIds.length !== 1) {
    return {
      skipped: true,
      reason: 'ambiguous_correct_ids',
      case_code: getCaseCode(caseRecord),
      correct_ids: correctIds,
    };
  }

  const byId = new Map();
  for (const option of originalOptions) {
    if (!OPTION_IDS.includes(option.id)) continue;
    const list = byId.get(option.id) || [];
    list.push({ index: option.index, option });
    byId.set(option.id, list);
  }

  const chosenById = new Map();
  const dropped = [];
  for (const [optionId, entries] of byId.entries()) {
    const chosen = chooseCanonicalOption(entries);
    chosenById.set(optionId, chosen);
    for (const entry of entries) {
      if (entry.index !== chosen.index) dropped.push(entry);
    }
  }

  const keptIds = OPTION_IDS.filter((optionId) => chosenById.has(optionId));
  if (!keptIds.includes(correctIds[0]) || keptIds.length < 3) {
    return {
      skipped: true,
      reason: 'unsafe_reduced_option_set',
      case_code: getCaseCode(caseRecord),
      correct_ids: correctIds,
      kept_ids: keptIds,
    };
  }

  const keptOriginalIndexes = keptIds.map((optionId) => chosenById.get(optionId).index);
  const firstKeptIndex = Math.min(...keptOriginalIndexes);
  const lastKeptIndex = Math.max(...keptOriginalIndexes);
  const keptComparable = new Set(
    keptIds.map((optionId) => comparable(chosenById.get(optionId).option.text)).filter(Boolean),
  );
  const stemFragments = [];
  const rationaleFragments = [];
  const duplicateAnswerFragments = [];

  for (const droppedEntry of dropped.sort((left, right) => left.index - right.index)) {
    const text = normalizeWhitespace(droppedEntry.option.text);
    const comparableText = comparable(text);
    if (!text) continue;
    if (keptComparable.has(comparableText)) {
      duplicateAnswerFragments.push(text);
      continue;
    }
    if (droppedEntry.index < firstKeptIndex || (droppedEntry.index <= lastKeptIndex && isPromptLike(text) && !isRationaleLike(text))) {
      stemFragments.push(text);
      continue;
    }
    if (droppedEntry.index > lastKeptIndex || isRationaleLike(text)) {
      rationaleFragments.push(text);
      continue;
    }
    stemFragments.push(text);
  }

  const nextOptions = keptIds.map((optionId) => {
    const selected = chosenById.get(optionId).option;
    return {
      id: optionId,
      text: normalizeDisplayText(selected.text),
      is_correct: optionId === correctIds[0],
    };
  });

  const beforeOptions = caseRecord.options.map((option) => ({
    id: normalizeWhitespace(option?.id),
    text: normalizeWhitespace(option?.text),
    is_correct: Boolean(option?.is_correct),
  }));

  caseRecord.options = nextOptions;
  const stemChanged = appendStem(caseRecord, stemFragments);
  const rationaleChanged = appendRationale(caseRecord, rationaleFragments);

  caseRecord.meta = caseRecord.meta || {};
  const reviewReasons = Array.isArray(caseRecord.meta.review_reasons) ? caseRecord.meta.review_reasons : [];
  caseRecord.meta.review_reasons = reviewReasons.filter((reason) => reason !== 'duplicate_options');
  if (caseRecord.meta.needs_review_reason === 'duplicate_options') {
    delete caseRecord.meta.needs_review_reason;
  }
  caseRecord.meta.option_count = nextOptions.length;
  caseRecord.meta._ukmppd_duplicate_option_parser_repair = {
    applied_at: new Date().toISOString(),
    original_option_count: beforeOptions.length,
    repaired_option_count: nextOptions.length,
    stem_fragments_recovered: stemFragments.length,
    rationale_fragments_recovered: rationaleFragments.length,
    duplicate_answer_fragments_removed: duplicateAnswerFragments.length,
  };

  return {
    skipped: false,
    _id: caseRecord._id,
    case_code: getCaseCode(caseRecord),
    source: getSource(caseRecord),
    correct_id: correctIds[0],
    before_option_count: beforeOptions.length,
    after_option_count: nextOptions.length,
    before_options: beforeOptions,
    after_options: nextOptions,
    dropped: dropped.map((entry) => ({
      index: entry.index,
      id: entry.option.id,
      text: compact(entry.option.text),
      kind: stemFragments.includes(entry.option.text)
        ? 'stem'
        : rationaleFragments.includes(entry.option.text)
          ? 'rationale'
          : duplicateAnswerFragments.includes(entry.option.text)
            ? 'duplicate_answer'
            : 'removed',
    })),
    changed_fields: [
      'options',
      stemChanged ? 'vignette.narrative' : null,
      rationaleChanged ? 'rationale.correct' : null,
      'meta.option_count',
    ].filter(Boolean),
  };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    modified_cases: [],
    skipped_cases: [],
  };

  const modifiedCaseIds = new Set();

  for (const caseRecord of cases) {
    const result = repairCase(caseRecord);
    if (!result) continue;
    if (result.skipped) {
      report.skipped_cases.push(result);
      continue;
    }
    report.modified_cases.push(result);
    modifiedCaseIds.add(Number(caseRecord._id));
  }

  if (!DRY_RUN && modifiedCaseIds.size > 0) {
    const repository = createCasebankRepository();
    try {
      repository.updateCaseSnapshots(cases.filter((caseRecord) => modifiedCaseIds.has(Number(caseRecord._id))));
    } finally {
      repository.close();
    }
    writeJsonAtomically(DATA_FILE, cases, true);
  }

  const outputDir = dirname(REPORT_FILE);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('UKMPPD duplicate option parser repair');
  console.log(`  Mode:           ${DRY_RUN ? 'dry-run' : 'apply'}`);
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Skipped cases:  ${report.skipped_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);

  if (report.skipped_cases.length > 0) {
    process.exitCode = 1;
  }
}

main();
