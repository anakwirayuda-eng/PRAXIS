import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'short_primary_stem_repair_report.json');

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerpt(value, limit = 72) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trimEnd()}...`;
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

function isPlayable(caseRecord) {
  const meta = caseRecord?.meta || {};
  const status = String(meta.status || '');
  return meta.needs_review !== true
    && meta.truncated !== true
    && meta.quarantined !== true
    && !status.startsWith('QUARANTINED');
}

function needsPrimaryStemRepair(caseRecord) {
  if (!isPlayable(caseRecord)) return false;
  const prompt = normalizeWhitespace(caseRecord.prompt);
  const narrative = getNarrative(caseRecord);
  if (prompt.length >= 10 || narrative.length < 20) return false;
  if (prompt && !narrative.toLowerCase().includes(prompt.toLowerCase()) && prompt.length >= 4) return false;
  return true;
}

function applyPrimaryStemRepair(caseRecord) {
  const meta = ensureMeta(caseRecord);
  const narrative = getNarrative(caseRecord);
  const nextPrompt = normalizeWhitespace(narrative);
  if (!nextPrompt) return false;

  let changed = false;
  if (normalizeWhitespace(caseRecord.prompt) !== nextPrompt) {
    caseRecord.prompt = nextPrompt;
    changed = true;
  }

  const normalizedTitle = normalizeWhitespace(caseRecord.title);
  if (!normalizedTitle || normalizedTitle.length < 10 || normalizedTitle === 'Dr') {
    const nextTitle = excerpt(nextPrompt);
    if (nextTitle && normalizedTitle !== nextTitle) {
      caseRecord.title = nextTitle;
      changed = true;
    }
  }

  if (getNarrative(caseRecord) === nextPrompt) {
    setNarrative(caseRecord, '');
    changed = true;
  }

  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes('primary_stem_promoted')) {
    meta.quality_flags.push('primary_stem_promoted');
    changed = true;
  }

  return changed;
}

function main() {
  const now = new Date().toISOString();
  const publicCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const publicMap = new Map(publicCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const report = {
    generated_at: now,
    modified_cases: [],
    unchanged_cases: [],
  };

  const syncedCases = [];
  for (const [caseId, publicCase] of publicMap.entries()) {
    if (!needsPrimaryStemRepair(publicCase)) continue;

    const dbCase = dbMap.get(caseId);
    if (!dbCase) {
      report.unchanged_cases.push({ _id: Number(caseId), reason: 'missing_db_case' });
      continue;
    }

    const publicChanged = applyPrimaryStemRepair(publicCase);
    const dbChanged = applyPrimaryStemRepair(dbCase);
    if (!publicChanged && !dbChanged) {
      report.unchanged_cases.push({ _id: Number(caseId), reason: 'already_normalized' });
      continue;
    }

    syncedCases.push(dbCase);
    report.modified_cases.push({
      _id: Number(caseId),
      case_code: publicCase.case_code,
      source: publicCase.meta?.source || publicCase.source || null,
      prompt: excerpt(publicCase.prompt, 120),
    });
  }

  if (syncedCases.length > 0) {
    repo.updateCaseSnapshots(syncedCases);
    writeJsonAtomically(DATA_FILE, publicCases, true);
  }
  repo.close();

  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Short primary stem repairs complete');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);
}

main();
