import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'tail_readability_auto_fix_report.json');

const TARGET_CASE_IDS = new Set(['32590', '22700']);

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
  renameSync(tempFile, filePath);
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object' || Array.isArray(caseRecord.meta)) {
    caseRecord.meta = {};
  }
  return caseRecord.meta;
}

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    caseRecord.rationale = { correct: '', distractors: {}, pearl: '' };
  }
  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }
  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = String(caseRecord.rationale.correct ?? '');
  }
  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = String(caseRecord.rationale.pearl ?? '');
  }
  return caseRecord.rationale;
}

function clearReadabilityPass(meta) {
  let changed = false;
  for (const key of ['readability_ai_pass', 'readability_ai_basis', 'readability_ai_pass_at']) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function setReadabilityHold(meta, hold, basis, now) {
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
  changed = clearReadabilityPass(meta) || changed;
  return changed;
}

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function main() {
  const now = new Date().toISOString();
  const report = {
    generated_at: now,
    modified_cases: [],
    unchanged_cases: [],
  };

  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedIds = new Set();

  for (const caseId of TARGET_CASE_IDS) {
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      report.unchanged_cases.push({ _id: caseId, reason: 'missing_case' });
      continue;
    }

    let changed = false;

    if (caseId === '32590') {
      changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
        const rationale = ensureRationale(caseRecord);
        const nextRationale = 'Valproate is a first-line mood stabilizer for rapid-cycling bipolar disorder and is generally more effective than lithium or carbamazepine for this pattern. Lamotrigine is more useful for maintenance and bipolar depression than for acute control of rapid cycling.';
        if (normalizeWhitespace(rationale.correct) === nextRationale) {
          return false;
        }
        rationale.correct = nextRationale;
        return true;
      }) || changed;
      if (changed) {
        report.modified_cases.push({ _id: 32590, action: 'replace_hallucinated_rationale' });
      }
    }

    if (caseId === '22700') {
      changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
        const meta = ensureMeta(caseRecord);
        let localChanged = false;

        if (meta.needs_review !== true) {
          meta.needs_review = true;
          localChanged = true;
        }
        if (meta.needs_review_reason !== 'source_contamination_detected') {
          meta.needs_review_reason = 'source_contamination_detected';
          localChanged = true;
        }
        if (meta.review_conflict !== true) {
          meta.review_conflict = true;
          localChanged = true;
        }
        localChanged = setReadabilityHold(meta, 'source_contamination', 'integrity:placeholder_options', now) || localChanged;
        return localChanged;
      }) || changed;
      if (changed) {
        report.modified_cases.push({ _id: 22700, action: 'reclassify_placeholder_options_to_review_hold' });
      }
    }

    if (changed) {
      modifiedIds.add(caseId);
    } else {
      report.unchanged_cases.push({ _id: caseId, reason: 'already_in_desired_state' });
    }
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  repo.close();
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Tail readability auto-fixes applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);
}

main();
