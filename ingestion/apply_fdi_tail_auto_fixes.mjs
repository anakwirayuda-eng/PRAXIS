import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'fdi_tail_auto_fix_report.json');
const TARGET_IDS = new Set(['66973', '66992', '66921', '67048', '66787']);
const GENERIC_PROMPTS = new Set([
  'pilih jawaban yang paling tepat.',
  'review this case and choose the best answer.',
]);
const WATERMARK_ONLY_RE = /^(?:platform\s+try\s*out\s+ukmppd(?:\s+online)?\s+terbaik\s+dan\s+termurah\s+di\s+indonesia\s*\d*\s*)+$/i;

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

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    caseRecord.rationale = {
      correct: typeof caseRecord.rationale === 'string' ? caseRecord.rationale : '',
      distractors: {},
      pearl: '',
    };
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

function getNarrative(caseRecord) {
  if (typeof caseRecord?.vignette === 'string') {
    return normalizeWhitespace(caseRecord.vignette);
  }
  if (caseRecord?.vignette && typeof caseRecord.vignette === 'object' && !Array.isArray(caseRecord.vignette)) {
    return normalizeWhitespace(caseRecord.vignette.narrative);
  }
  return '';
}

function setNarrative(caseRecord, value) {
  const normalized = normalizeWhitespace(value);
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

function stripWatermark(text) {
  return normalizeWhitespace(
    String(text ?? '')
      .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R\s*I\s*N\s*D\s*O\s*N\s*E\s*S\s*I\s*A\s*\.\s*C\s*O\s*M/gi, '')
      .replace(/PLATFORM\s+TRY\s*OUT\s+UKMPPD(?:\s+ONLINE)?\s+TERBAIK\s+DAN\s+TERMURAH\s+DI\s+INDONESIA/gi, '')
      .replace(/futuredoctorindonesia\.com/gi, '')
      .replace(/→/g, ' ')
      .replace(/\s+([.,?])/g, '$1')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
  );
}

function recoverQuestionLikeTail(text) {
  const normalized = stripWatermark(text);
  if (!normalized) {
    return '';
  }

  const questionSentence = normalized
    .split(/(?<=[?])\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .reverse()
    .find((part) => part.endsWith('?'));
  if (questionSentence) {
    return questionSentence;
  }

  const ellipsisMatch = normalized.match(
    /((?:diagnosis|terapi|tatalaksana|komplikasi|penatalaksanaan|lokasi|mekanisme|pemeriksaan|obat|diagnosa)[^.?!\n]*?(?:adalah|ialah|yang paling tepat)\s*\.{2,})$/i,
  );
  return normalizeWhitespace(ellipsisMatch?.[1] ?? '');
}

function recoverPromptFromNarrative(prompt, narrative) {
  const normalizedPrompt = normalizeWhitespace(prompt).toLowerCase();
  const normalizedNarrative = stripWatermark(narrative);
  if (!GENERIC_PROMPTS.has(normalizedPrompt)) {
    return { prompt: normalizeWhitespace(prompt), narrative: normalizedNarrative, changed: false };
  }

  const questionSentence = recoverQuestionLikeTail(normalizedNarrative);
  if (!questionSentence) {
    return { prompt: normalizeWhitespace(prompt), narrative: normalizedNarrative, changed: false };
  }

  const trimmedNarrative = normalizeWhitespace(
    normalizedNarrative.slice(0, normalizedNarrative.lastIndexOf(questionSentence)).trim(),
  );
  return {
    prompt: questionSentence,
    narrative: trimmedNarrative || normalizedNarrative,
    changed: true,
  };
}

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function main() {
  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
    skipped_cases: [],
  };

  const modifiedIds = new Set();

  for (const caseId of TARGET_IDS) {
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      report.skipped_cases.push({ _id: caseId, reason: 'missing_case' });
      continue;
    }

    let caseChanged = false;
    caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
      const meta = ensureMeta(caseRecord);
      const rationale = ensureRationale(caseRecord);
      const nextNarrative = stripWatermark(getNarrative(caseRecord));
      let changed = false;
      changed = setNarrative(caseRecord, nextNarrative) || changed;

      const nextTitleCandidate = stripWatermark(caseRecord.title);
      if (normalizeWhitespace(caseRecord.title) !== nextTitleCandidate) {
        caseRecord.title = nextTitleCandidate;
        changed = true;
      }

      const nextPromptCandidate = stripWatermark(caseRecord.prompt);
      if (normalizeWhitespace(caseRecord.prompt) !== nextPromptCandidate) {
        caseRecord.prompt = nextPromptCandidate;
        changed = true;
      }

      const recovered = recoverPromptFromNarrative(caseRecord.prompt, getNarrative(caseRecord));
      if (normalizeWhitespace(caseRecord.prompt) !== recovered.prompt) {
        caseRecord.prompt = recovered.prompt;
        changed = true;
      }
      changed = setNarrative(caseRecord, recovered.narrative) || changed;

      const strippedRationale = normalizeWhitespace(stripWatermark(rationale.correct).replace(/\b\d+\b/g, ' '));
      let nextRationale = strippedRationale;
      if (!nextRationale || WATERMARK_ONLY_RE.test(nextRationale)) {
        nextRationale = normalizeWhitespace(meta.review_rationale);
      }
      if (normalizeWhitespace(rationale.correct) !== nextRationale) {
        rationale.correct = nextRationale;
        changed = true;
      }
      return changed;
    }) || caseChanged;

    if (caseChanged) {
      modifiedIds.add(caseId);
      report.modified_cases.push({ _id: Number(caseId) });
    } else {
      report.skipped_cases.push({ _id: Number(caseId), reason: 'already_clean' });
    }
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }
  repo.close();

  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('FDI tail auto-fixes applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report:         ${REPORT_FILE}`);
}

main();
