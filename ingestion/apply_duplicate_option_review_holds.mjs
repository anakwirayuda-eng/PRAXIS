import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_auto_fix_queue.json');
const REPORT_FILE = join(__dirname, 'output', 'duplicate_option_review_hold_report.json');

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (error && error.code !== 'EPERM') {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    unlinkSync(tempFile);
  }
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object' || Array.isArray(caseRecord.meta)) {
    caseRecord.meta = {};
  }
  return caseRecord.meta;
}

function ensureQualityFlags(meta) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  return meta.quality_flags;
}

function ensureNeedsReviewReasons(meta) {
  if (!Array.isArray(meta.needs_review_reasons)) {
    meta.needs_review_reasons = [];
  }
  return meta.needs_review_reasons;
}

function hasDuplicateOptions(caseRecord) {
  const seen = new Set();
  for (const option of caseRecord.options || []) {
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

function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
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

function main() {
  const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
  const targetIds = queue
    .filter((item) => Array.isArray(item.reasons) && item.reasons.some((reason) => reason?.code === 'duplicate_options'))
    .map((item) => String(item._id))
    .filter(Boolean);

  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedIds = new Set();
  const report = {
    generated_at: new Date().toISOString(),
    target_case_count: targetIds.length,
    modified_case_count: 0,
    skipped_missing_case: 0,
    skipped_already_blocked: 0,
    skipped_not_duplicate: 0,
    modified_cases: [],
  };

  for (const caseId of targetIds) {
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      report.skipped_missing_case += 1;
      continue;
    }
    if (!hasDuplicateOptions(jsonCase) && !hasDuplicateOptions(dbCase)) {
      report.skipped_not_duplicate += 1;
      continue;
    }

    const changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
      const meta = ensureMeta(caseRecord);
      let localChanged = false;
      if (meta.needs_review !== true) {
        meta.needs_review = true;
        localChanged = true;
      }
      if (meta.needs_review_reason !== 'duplicate_options') {
        meta.needs_review_reason = 'duplicate_options';
        localChanged = true;
      }
      const reviewReasons = ensureNeedsReviewReasons(meta);
      localChanged = addUnique(reviewReasons, 'duplicate_options') || localChanged;
      const qualityFlags = ensureQualityFlags(meta);
      localChanged = addUnique(qualityFlags, 'duplicate_options_hold') || localChanged;
      return localChanged;
    });

    if (!changed) {
      report.skipped_already_blocked += 1;
      continue;
    }

    modifiedIds.add(caseId);
    report.modified_case_count += 1;
    report.modified_cases.push(Number(caseId));
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  repo.close();
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Duplicate option review holds applied');
  console.log(`  Targets:  ${report.target_case_count}`);
  console.log(`  Modified: ${report.modified_case_count}`);
  console.log(`  Report:   ${REPORT_FILE}`);
}

main();
