import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'tail_ai_lane_resolution_report.json');
const TARGET_PASS_IDS = new Set(['29186', '991620']);
const TARGET_NORMALIZE_IDS = new Set(['37908']);

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
  for (const key of ['readability_ai_hold', 'readability_ai_hold_basis', 'readability_ai_hold_at', 'readability_ai_hold_reasoning', 'readability_ai_hold_notes']) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function normalizeMetricText(text) {
  return normalizeWhitespace(
    String(text ?? '')
      .replace(/\bmm\s*hg\b/gi, 'mmHg')
      .replace(/\b(\d+)\s*\/\s*mm\b/gi, '$1/min'),
  );
}

function mutatePair(dbCase, jsonCase, mutator) {
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
  const targetIds = new Set([...TARGET_PASS_IDS, ...TARGET_NORMALIZE_IDS]);

  for (const caseId of targetIds) {
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      report.unchanged_cases.push({ _id: Number(caseId), reason: 'missing_case' });
      continue;
    }

    let changed = false;

    if (TARGET_PASS_IDS.has(caseId)) {
      changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
        const meta = ensureMeta(caseRecord);
        let localChanged = false;
        localChanged = setReadabilityPass(meta, 'manual-tail-review', now) || localChanged;
        localChanged = addQualityFlag(meta, 'readability_ai_tail_pass') || localChanged;
        return localChanged;
      }) || changed;
    }

    if (TARGET_NORMALIZE_IDS.has(caseId)) {
      changed = mutatePair(dbCase, jsonCase, (caseRecord) => {
        let localChanged = false;
        const nextPrompt = normalizeMetricText(caseRecord.prompt);
        if (normalizeWhitespace(caseRecord.prompt) !== nextPrompt) {
          caseRecord.prompt = nextPrompt;
          localChanged = true;
        }
        const nextTitle = normalizeMetricText(caseRecord.title);
        if (normalizeWhitespace(caseRecord.title) !== nextTitle) {
          caseRecord.title = nextTitle;
          localChanged = true;
        }
        localChanged = setNarrative(caseRecord, normalizeMetricText(getNarrative(caseRecord))) || localChanged;
        return localChanged;
      }) || changed;
    }

    if (changed) {
      modifiedIds.add(caseId);
      report.modified_cases.push(Number(caseId));
    } else {
      report.unchanged_cases.push({ _id: Number(caseId), reason: 'already_applied' });
    }
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  repo.close();
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Tail AI lane resolutions applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);
}

main();
