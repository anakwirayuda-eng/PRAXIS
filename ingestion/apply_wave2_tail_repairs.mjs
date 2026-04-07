import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository, hydrateCase } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'wave2_tail_repairs_report.json');
const TARGET_CASE_IDS = new Set(['994183', '21291']);

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
    if (normalizeWhitespace(caseRecord.vignette) === normalized) {
      return false;
    }
    caseRecord.vignette = normalized;
    return true;
  }

  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object' || Array.isArray(caseRecord.vignette)) {
    caseRecord.vignette = {};
  }
  if (normalizeWhitespace(caseRecord.vignette.narrative) === normalized) {
    return false;
  }
  caseRecord.vignette.narrative = normalized;
  return true;
}

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function loadTargetCases(repo, caseIds) {
  const numericIds = [...caseIds].map((value) => Number(value)).filter(Number.isFinite);
  if (numericIds.length === 0) {
    return [];
  }

  const placeholders = numericIds.map(() => '?').join(', ');
  const caseRows = repo.db.prepare(`
    SELECT
      case_id,
      case_code,
      hash_id,
      q_type,
      confidence,
      category,
      title,
      prompt,
      vignette_json,
      rationale_json,
      meta_json,
      validation_json
    FROM cases
    WHERE case_id IN (${placeholders})
    ORDER BY case_id
  `).all(...numericIds);

  const optionRows = repo.db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    WHERE case_id IN (${placeholders})
    ORDER BY case_id, sort_order
  `).all(...numericIds);

  const optionsByCaseId = new Map();
  for (const row of optionRows) {
    const list = optionsByCaseId.get(row.case_id) || [];
    list.push(row);
    optionsByCaseId.set(row.case_id, list);
  }

  return caseRows.map((row) => hydrateCase(row, optionsByCaseId.get(row.case_id) || []));
}

function main() {
  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
    unchanged_cases: [],
  };

  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = loadTargetCases(repo, TARGET_CASE_IDS);
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

    if (caseId === '994183') {
      changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
        const narrative = getNarrative(caseRecord);
        const prompt = normalizeWhitespace(caseRecord.prompt);
        const tailQuestion = 'What is the most likely etiology of this patient’s diagnosis?';
        let localChanged = false;

        if (!prompt && narrative.includes(tailQuestion)) {
          caseRecord.prompt = tailQuestion;
          localChanged = true;
          localChanged = setNarrative(
            caseRecord,
            normalizeWhitespace(narrative.replace(tailQuestion, '').trim()),
          ) || localChanged;
        }
        return localChanged;
      }) || changed;
      if (changed) {
        report.modified_cases.push({ _id: 994183, action: 'promote_trailing_question_into_prompt' });
      }
    }

    if (caseId === '21291') {
      changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
        const meta = ensureMeta(caseRecord);
        const narrative = getNarrative(caseRecord);
        const imageSentence = 'A chest X-ray (shown in image) is performed.';
        let localChanged = false;

        if (narrative.includes(imageSentence)) {
          localChanged = setNarrative(
            caseRecord,
            normalizeWhitespace(narrative.replace(imageSentence, '').trim()),
          ) || localChanged;
        }
        if (meta.phantom_image) {
          delete meta.phantom_image;
          localChanged = true;
        }
        return localChanged;
      }) || changed;
      if (changed) {
        report.modified_cases.push({ _id: 21291, action: 'remove_nonessential_image_dependency_clause' });
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

  console.log('Wave 2 tail repairs applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);
}

main();
