import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'medmcqa_tail_salvage_report.json');

const TARGET_TAIL_IDS = new Set(['36054', '41250', '41457']);
const NEGATION_RE = /\b(kecuali|except|not|bukan|least likely|false statement|incorrect|does not|wrong)\b/i;
const IMAGE_RE = /\b(image|gambar|ct scan|mri|ultrasound|usg|x-ray|x ray|radiograph)\b/i;

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);
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

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object' || Array.isArray(caseRecord.meta)) {
    caseRecord.meta = {};
  }
  return caseRecord.meta;
}

function getNarrative(caseRecord) {
  if (typeof caseRecord?.vignette === 'string') {
    return normalizeWhitespace(caseRecord.vignette);
  }
  if (caseRecord?.vignette && typeof caseRecord.vignette === 'object' && !Array.isArray(caseRecord.vignette)) {
    return normalizeWhitespace(caseRecord.vignette.narrative);
  }
  return '';
}

function setNarrative(caseRecord, nextNarrative) {
  const normalized = normalizeWhitespace(nextNarrative);
  if (typeof caseRecord?.vignette === 'string') {
    caseRecord.vignette = normalized;
    return;
  }
  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object' || Array.isArray(caseRecord.vignette)) {
    caseRecord.vignette = {};
  }
  caseRecord.vignette.narrative = normalized;
}

function ensureQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
  }
}

function clearQuarantine(meta) {
  delete meta.status;
  delete meta.radar_tokens;
  delete meta.quarantine_reason;
  if (meta.quarantined !== false) {
    meta.quarantined = false;
  }
}

function correctCount(caseRecord) {
  return Array.isArray(caseRecord?.options)
    ? caseRecord.options.filter((option) => option?.is_correct === true).length
    : 0;
}

function hasAllOfTheAbove(caseRecord) {
  return Array.isArray(caseRecord?.options)
    && caseRecord.options.some((option) => /all of the above/i.test(String(option?.text || '')));
}

function isSafeDissonanceFalsePositive(caseRecord) {
  const meta = caseRecord?.meta || {};
  const prompt = normalizeWhitespace(caseRecord?.prompt);
  const narrative = getNarrative(caseRecord);
  const rationale = caseRecord?.rationale;
  const correct = normalizeWhitespace(
    typeof rationale === 'string'
      ? rationale
      : rationale?.correct,
  );

  return (meta.source || caseRecord?.source) === 'medmcqa'
    && meta.status === 'QUARANTINED_DISSONANCE'
    && meta.truncated === true
    && prompt.length >= 18
    && prompt === narrative
    && correctCount(caseRecord) === 1
    && correct.startsWith('[RESTORED SOURCE]')
    && !hasAllOfTheAbove(caseRecord)
    && !NEGATION_RE.test(prompt)
    && !IMAGE_RE.test(prompt);
}

function applySafeDissonanceRelease(caseRecord) {
  const meta = ensureMeta(caseRecord);
  const prompt = normalizeWhitespace(caseRecord.prompt);
  clearQuarantine(meta);
  meta.truncated = false;
  ensureQualityFlag(meta, 'medmcqa_dissonance_released');
  if (getNarrative(caseRecord) === prompt) {
    setNarrative(caseRecord, '');
  }
}

function applyTailFix(caseRecord) {
  const caseId = String(caseRecord?._id);
  const meta = ensureMeta(caseRecord);
  const prompt = normalizeWhitespace(caseRecord.prompt);
  const narrative = getNarrative(caseRecord);

  if (caseId === '41250') {
    caseRecord.prompt = narrative;
    setNarrative(caseRecord, '');
    meta.truncated = false;
    ensureQualityFlag(meta, 'prompt_promoted_from_narrative');
    return 'diagnosis_prompt_promoted';
  }

  if (caseId === '41457') {
    if (prompt === narrative) {
      setNarrative(caseRecord, '');
    }
    meta.truncated = false;
    ensureQualityFlag(meta, 'truncated_false_positive_cleared');
    return 'complete_stem_released';
  }

  if (caseId === '36054') {
    if (prompt === narrative) {
      setNarrative(caseRecord, '');
    }
    meta.truncated = false;
    meta.needs_review = true;
    meta.needs_review_reason = 'aota_suspect';
    meta.needs_review_reasons = Array.from(new Set([...(meta.needs_review_reasons || []), 'aota_suspect']));
    ensureQualityFlag(meta, 'aota_manual_hold');
    return 'triaged_to_human_shortlist';
  }

  return null;
}

function main() {
  const report = {
    generated_at: new Date().toISOString(),
    tail_repairs: [],
    dissonance_false_positive_releases: [],
  };

  const publicCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const publicMap = new Map(publicCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const syncedIds = new Set();

  for (const caseId of TARGET_TAIL_IDS) {
    const publicCase = publicMap.get(caseId);
    const dbCase = dbMap.get(caseId);
    if (!publicCase || !dbCase) continue;

    const action = applyTailFix(publicCase);
    applyTailFix(dbCase);
    if (!action) continue;

    report.tail_repairs.push({
      _id: Number(caseId),
      case_code: publicCase.case_code,
      action,
    });
    syncedIds.add(caseId);
  }

  for (const [caseId, publicCase] of publicMap.entries()) {
    if (!isSafeDissonanceFalsePositive(publicCase)) continue;
    const dbCase = dbMap.get(caseId);
    if (!dbCase) continue;

    applySafeDissonanceRelease(publicCase);
    applySafeDissonanceRelease(dbCase);
    report.dissonance_false_positive_releases.push({
      _id: Number(caseId),
      case_code: publicCase.case_code,
      prompt: publicCase.prompt,
    });
    syncedIds.add(caseId);
  }

  if (syncedIds.size > 0) {
    const syncedCases = [...syncedIds]
      .map((caseId) => dbMap.get(caseId))
      .filter(Boolean);
    repo.updateCaseSnapshots(syncedCases);
    writeJsonAtomically(DATA_FILE, publicCases, true);
  }
  repo.close();

  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('medmcqa tail salvage complete');
  console.log(`  Tail repairs:                 ${report.tail_repairs.length}`);
  console.log(`  Dissonance false-positive:    ${report.dissonance_false_positive_releases.length}`);
  console.log(`  Report:                       ${REPORT_FILE}`);
}

main();
