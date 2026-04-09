import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_ai_adjudication_queue.json');
const REPORT_FILE = join(__dirname, 'output', 'advisory_ai_tail_pass_report.json');
const ADVISORY_CODES = new Set([
  'aota_suspect',
  'absolute_trap',
  'length_bias',
  'negation_blindspot',
]);

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

function getPrimaryStem(caseRecord) {
  const vignette = typeof caseRecord?.vignette === 'string'
    ? caseRecord.vignette
    : caseRecord?.vignette?.narrative;
  return normalizeWhitespace(caseRecord?.prompt || caseRecord?.question || vignette || caseRecord?.title);
}

function correctCount(caseRecord) {
  return Array.isArray(caseRecord?.options)
    ? caseRecord.options.filter((option) => option?.is_correct === true).length
    : 0;
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

function isPlayable(caseRecord) {
  const meta = caseRecord?.meta || {};
  return meta.needs_review !== true
    && meta.truncated !== true
    && meta.quarantined !== true
    && !String(meta.status || '').startsWith('QUARANTINED');
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

function mutatePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function eligibleForManualTailPass(item, caseRecord) {
  const reasonCodes = new Set(item?.reason_codes || []);
  if (reasonCodes.size === 0) {
    return false;
  }
  if ([...reasonCodes].some((code) => !ADVISORY_CODES.has(code))) {
    return false;
  }
  if (!isPlayable(caseRecord)) {
    return false;
  }
  if (correctCount(caseRecord) !== 1) {
    return false;
  }
  if (getPrimaryStem(caseRecord).length < 10) {
    return false;
  }
  if (hasDuplicateOptions(caseRecord)) {
    return false;
  }
  return true;
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

    const candidate = eligibleForManualTailPass(item, dbCase) && eligibleForManualTailPass(item, jsonCase);
    if (!candidate) {
      report.held.push({ _id: item._id, source: item.source, reason: 'guard_failed' });
      continue;
    }

    const changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
      const meta = ensureMeta(caseRecord);
      let localChanged = false;
      localChanged = setReadabilityPass(meta, 'manual-tail-review', now) || localChanged;
      localChanged = addQualityFlag(meta, 'readability_ai_tail_pass') || localChanged;
      if (meta.review_source !== 'manual-tail-review') {
        meta.review_source = 'manual-tail-review';
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
      if (meta.readability_ai_playbook !== item.playbook) {
        meta.readability_ai_playbook = item.playbook;
        localChanged = true;
      }
      return localChanged;
    });

    if (changed) {
      modifiedIds.add(caseId);
      report.passed.push({ _id: item._id, source: item.source, case_code: item.case_code });
    } else {
      report.skipped.push({ _id: item._id, reason: 'already_applied' });
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

  console.log('Advisory AI tail pass apply complete');
  console.log(`  Queue scanned:   ${report.scanned_queue_items}`);
  console.log(`  Passed:          ${report.passed.length}`);
  console.log(`  Held:            ${report.held.length}`);
  console.log(`  Skipped:         ${report.skipped.length}`);
  console.log(`  Report:          ${REPORT_FILE}`);
}

main();
