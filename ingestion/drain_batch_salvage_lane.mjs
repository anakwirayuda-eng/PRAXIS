import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_batch_salvage_queue.json');
const REPORT_FILE = join(__dirname, 'output', 'batch_salvage_drain_report.json');
const PASS_SOURCES = new Set(['igakuqa', 'medqa', 'frenchmedmcqa']);

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function addQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
    return true;
  }
  return false;
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

function getPrimaryStem(caseRecord) {
  return normalizeWhitespace(caseRecord?.prompt || caseRecord?.question || getNarrative(caseRecord) || caseRecord?.title);
}

function correctCount(caseRecord) {
  return Array.isArray(caseRecord?.options)
    ? caseRecord.options.filter((option) => option?.is_correct === true).length
    : 0;
}

function optionCount(caseRecord) {
  return Array.isArray(caseRecord?.options) ? caseRecord.options.length : 0;
}

function hasDuplicateOptions(caseRecord) {
  const seen = new Set();
  for (const option of Array.isArray(caseRecord?.options) ? caseRecord.options : []) {
    const text = normalizeWhitespace(option?.text).toLowerCase();
    if (!text) {
      continue;
    }
    if (seen.has(text)) {
      return true;
    }
    seen.add(text);
  }
  return false;
}

function hasContamination(caseRecord) {
  const prompt = getPrimaryStem(caseRecord);
  const narrative = getNarrative(caseRecord);
  const optionTexts = Array.isArray(caseRecord?.options)
    ? caseRecord.options.map((option) => normalizeWhitespace(option?.text))
    : [];
  const joined = [prompt, narrative, ...optionTexts].filter(Boolean).join('\n');
  return /\bQ\d+\./i.test(joined)
    || optionTexts.length > 5
    || optionTexts.some((text) => /\bQ\d+\./i.test(text))
    || optionTexts.some((text) => text.length > 220);
}

function clearReviewFlags(meta) {
  let changed = false;
  const removals = ['review_conflict', 'needs_review_reason', 'needs_review_reasons', 'review_queue'];
  if (meta.needs_review !== false) {
    meta.needs_review = false;
    changed = true;
  }
  for (const key of removals) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function clearQuarantineFlags(meta) {
  let changed = false;
  if (meta.quarantined === true) {
    meta.quarantined = false;
    changed = true;
  }
  if (meta.status) {
    delete meta.status;
    changed = true;
  }
  if (meta.quarantine_reason) {
    delete meta.quarantine_reason;
    changed = true;
  }
  return changed;
}

function clearTruncatedFlag(meta) {
  if (meta.truncated === true) {
    meta.truncated = false;
    return true;
  }
  return false;
}

function setReadabilityPass(meta, basis, now) {
  let changed = false;
  if (meta.readability_ai_pass !== true) {
    meta.readability_ai_pass = true;
    changed = true;
  }
  if (meta.readability_ai_basis !== basis) {
    meta.readability_ai_basis = basis;
    changed = true;
  }
  if (meta.readability_ai_pass_at !== now) {
    meta.readability_ai_pass_at = now;
    changed = true;
  }
  for (const key of [
    'readability_ai_hold',
    'readability_ai_hold_basis',
    'readability_ai_hold_at',
    'readability_ai_hold_reasoning',
    'readability_ai_hold_notes',
  ]) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function setReadabilityHold(meta, hold, basis, note, now) {
  let changed = false;
  if (meta.readability_ai_hold !== hold) {
    meta.readability_ai_hold = hold;
    changed = true;
  }
  if (meta.readability_ai_hold_basis !== basis) {
    meta.readability_ai_hold_basis = basis;
    changed = true;
  }
  if (meta.readability_ai_hold_at !== now) {
    meta.readability_ai_hold_at = now;
    changed = true;
  }
  if (normalizeWhitespace(note) && meta.readability_ai_hold_notes !== normalizeWhitespace(note)) {
    meta.readability_ai_hold_notes = normalizeWhitespace(note);
    changed = true;
  }
  for (const key of ['readability_ai_pass', 'readability_ai_basis', 'readability_ai_pass_at']) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function mutatePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function isPassSource(source) {
  return PASS_SOURCES.has(source) || String(source || '').startsWith('mmlu-');
}

function canPass(item, caseRecord) {
  const reasonCodes = new Set(item.reason_codes || []);
  if (!isPassSource(item.source)) {
    return false;
  }
  if (reasonCodes.has('image_dependency') || reasonCodes.has('multi_correct') || reasonCodes.has('no_options') || reasonCodes.has('no_correct_answer') || reasonCodes.has('quarantined')) {
    return false;
  }
  if (correctCount(caseRecord) !== 1) {
    return false;
  }
  if (hasDuplicateOptions(caseRecord) || hasContamination(caseRecord)) {
    return false;
  }
  if (optionCount(caseRecord) < 4 || optionCount(caseRecord) > 5) {
    return false;
  }
  const stem = getPrimaryStem(caseRecord);
  const narrative = getNarrative(caseRecord);
  if (stem.length < 8 && narrative.length < 20) {
    return false;
  }
  return true;
}

function determineHold(item, caseRecord) {
  const reasonCodes = new Set(item.reason_codes || []);
  if (reasonCodes.has('image_dependency')) {
    return {
      hold: 'image_context_unresolved',
      note: 'Batch salvage exhausted the image-recovery lane; case still depends on absent visual context.',
      needsReviewReason: 'image_context_unresolved',
    };
  }
  if (reasonCodes.has('multi_correct') || hasContamination(caseRecord)) {
    return {
      hold: 'source_contamination',
      note: 'Batch salvage exhausted the structural recovery lane; source text still looks merged or contaminated.',
      needsReviewReason: 'source_contamination_detected',
    };
  }
  return {
    hold: 'rewrite_required',
    note: 'Batch salvage exhausted the structural cleanup lane; case still needs an editor rewrite.',
    needsReviewReason: 'rewrite_required',
  };
}

function main() {
  const now = new Date().toISOString();
  const queue = safeJsonParse(readFileSync(QUEUE_FILE, 'utf8')) || [];
  const jsonCases = safeJsonParse(readFileSync(DATA_FILE, 'utf8')) || [];
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedIds = new Set();
  const report = {
    generated_at: now,
    scanned_queue_items: queue.length,
    passed: [],
    held: [],
    skipped: [],
  };

  for (const item of queue) {
    const caseId = String(item._id);
    const dbCase = dbCaseMap.get(caseId);
    const jsonCase = jsonCaseMap.get(caseId);
    if (!dbCase || !jsonCase) {
      report.skipped.push({ _id: item._id, reason: 'missing_case' });
      continue;
    }

    let changed = false;
    if (canPass(item, dbCase) && canPass(item, jsonCase)) {
      changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
        const meta = ensureMeta(caseRecord);
        let localChanged = false;
        localChanged = clearTruncatedFlag(meta) || localChanged;
        localChanged = clearReviewFlags(meta) || localChanged;
        localChanged = clearQuarantineFlags(meta) || localChanged;
        localChanged = setReadabilityPass(meta, 'manual-batch-salvage', now) || localChanged;
        localChanged = addQualityFlag(meta, 'readability_batch_salvage_pass') || localChanged;
        if (meta.review_source !== 'manual-batch-salvage') {
          meta.review_source = 'manual-batch-salvage';
          localChanged = true;
        }
        if (meta.review_confidence !== 'MEDIUM') {
          meta.review_confidence = 'MEDIUM';
          localChanged = true;
        }
        if (meta.reviewed !== true) {
          meta.reviewed = true;
          localChanged = true;
        }
        if (meta.ai_audited !== true) {
          meta.ai_audited = true;
          localChanged = true;
        }
        return localChanged;
      });
      if (changed) {
        modifiedIds.add(caseId);
        report.passed.push({ _id: item._id, source: item.source, case_code: item.case_code });
      } else {
        report.skipped.push({ _id: item._id, reason: 'already_passed' });
      }
      continue;
    }

    const holdDecision = determineHold(item, dbCase);
    changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
      const meta = ensureMeta(caseRecord);
      let localChanged = false;
      localChanged = setReadabilityHold(meta, holdDecision.hold, 'manual-batch-salvage', holdDecision.note, now) || localChanged;
      localChanged = addQualityFlag(meta, 'readability_batch_salvage_hold') || localChanged;
      if (meta.needs_review !== true) {
        meta.needs_review = true;
        localChanged = true;
      }
      if (meta.needs_review_reason !== holdDecision.needsReviewReason) {
        meta.needs_review_reason = holdDecision.needsReviewReason;
        localChanged = true;
      }
      return localChanged;
    });

    if (changed) {
      modifiedIds.add(caseId);
      report.held.push({
        _id: item._id,
        source: item.source,
        case_code: item.case_code,
        hold: holdDecision.hold,
      });
    } else {
      report.skipped.push({ _id: item._id, reason: 'already_held' });
    }
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  repo.close();
  report.modified_cases = modifiedIds.size;
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Batch salvage drain complete');
  console.log(`  Queue scanned:   ${report.scanned_queue_items}`);
  console.log(`  Passed:          ${report.passed.length}`);
  console.log(`  Held:            ${report.held.length}`);
  console.log(`  Skipped:         ${report.skipped.length}`);
  console.log(`  Report:          ${REPORT_FILE}`);
}

main();
