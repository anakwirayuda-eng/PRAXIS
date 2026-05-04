import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'source_text_residual_microfix_report.json');

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

function setText(caseRecord, fieldPath, value, changes) {
  const segments = fieldPath.split('.');
  let current = caseRecord;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }

  const key = segments.at(-1);
  const before = current[key] || '';
  const after = normalizeDisplayText(value);
  if (before === after) {
    return false;
  }
  current[key] = after;
  changes.push({ field: fieldPath, before: compact(before), after: compact(after) });
  return true;
}

function compact(value, limit = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function replaceText(caseRecord, fieldPath, pattern, replacement, changes) {
  const segments = fieldPath.split('.');
  let current = caseRecord;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return false;
    current = current[segment];
  }
  if (typeof current !== 'string') return false;
  const next = normalizeDisplayText(current.replace(pattern, replacement));
  if (next === current) return false;
  return setText(caseRecord, fieldPath, next, changes);
}

function setOptions(caseRecord, options, changes) {
  const before = (caseRecord.options || []).map((option) => `${option.id}:${option.text}${option.is_correct ? '*' : ''}`).join(' | ');
  caseRecord.options = options.map((option) => ({ ...option }));
  const after = caseRecord.options.map((option) => `${option.id}:${option.text}${option.is_correct ? '*' : ''}`).join(' | ');
  if (before !== after) {
    changes.push({ field: 'options', before: compact(before), after: compact(after) });
    return true;
  }
  return false;
}

function markTouched(caseRecord, changes, action) {
  if (changes.length === 0) return;
  caseRecord.meta = caseRecord.meta || {};
  caseRecord.meta._source_text_residual_microfix = {
    applied_at: new Date().toISOString(),
    action,
    changed_fields: changes.map((change) => change.field),
  };
}

function repair19014(caseRecord, changes) {
  const stem = [
    'A 52-year-old woman with type 2 diabetes mellitus, currently treated with metformin, presents for a routine physical examination.',
    'Her blood pressure is 162/96 mm Hg. Her physician initiates treatment with a first-line antihypertensive medication.',
    'Which of the following best describes the expected effects of this medication on 24-hour urine sodium, aldosterone, angiotensin II, peripheral vascular resistance, and renin?',
  ].join(' ');

  setText(caseRecord, 'title', stem, changes);
  setText(caseRecord, 'prompt', stem, changes);
  setText(caseRecord, 'vignette.narrative', stem, changes);
  setOptions(caseRecord, [
    { id: 'A', text: 'Increased urine sodium, decreased aldosterone, decreased angiotensin II, decreased peripheral vascular resistance, increased renin', is_correct: true },
    { id: 'B', text: 'Increased urine sodium, decreased aldosterone, decreased angiotensin II, decreased peripheral vascular resistance, decreased renin', is_correct: false },
    { id: 'C', text: 'Increased urine sodium, increased aldosterone, increased angiotensin II, increased peripheral vascular resistance, increased renin', is_correct: false },
    { id: 'D', text: 'Decreased urine sodium, increased aldosterone, increased angiotensin II, decreased peripheral vascular resistance, increased renin', is_correct: false },
    { id: 'E', text: 'Increased urine sodium, decreased aldosterone, increased angiotensin II, decreased peripheral vascular resistance, increased renin', is_correct: false },
  ], changes);
}

function repair980124(caseRecord, changes) {
  const stem = 'Seorang laki-laki 32 tahun datang ke poliklinik dengan keluhan demam terus-menerus sejak 4 hari yang lalu, disertai sakit kepala, mual, dan beberapa jam sebelum datang mengalami mimisan. Pada pemeriksaan fisik didapatkan tekanan darah 100/70 mmHg, nadi 100 kali/menit, suhu 38°C, serta petekie pada ekstremitas atas dan bawah. Pemeriksaan laboratorium menunjukkan Hb 17 g/dL, hematokrit 52%, dan trombosit 58.000/µL. Apakah diagnosis yang paling tepat?';

  setText(caseRecord, 'title', stem, changes);
  setText(caseRecord, 'prompt', stem, changes);
  setText(caseRecord, 'vignette.narrative', stem, changes);
  setOptions(caseRecord, [
    { id: 'A', text: 'DHF stage 1', is_correct: false },
    { id: 'B', text: 'DHF stage 2', is_correct: true },
    { id: 'C', text: 'Dengue fever', is_correct: false },
    { id: 'D', text: 'ITP', is_correct: false },
    { id: 'E', text: 'Fever of unknown origin', is_correct: false },
  ], changes);
}

function quarantine66563(caseRecord, changes) {
  caseRecord.meta = caseRecord.meta || {};
  const before = JSON.stringify({
    needs_review: caseRecord.meta.needs_review,
    quarantined: caseRecord.meta.quarantined,
    status: caseRecord.meta.status,
  });
  caseRecord.meta.needs_review = true;
  caseRecord.meta.quarantined = true;
  caseRecord.meta.status = 'QUARANTINED_SOURCE_SPLICE_UNSALVAGEABLE';
  caseRecord.meta.quarantine_reason = 'Multiple source questions are spliced into one record and current options/rationale do not form one coherent answerable item.';
  caseRecord.meta.quality_score = 0;
  changes.push({
    field: 'meta.quarantine',
    before,
    after: JSON.stringify({
      needs_review: caseRecord.meta.needs_review,
      quarantined: caseRecord.meta.quarantined,
      status: caseRecord.meta.status,
    }),
  });
}

const FIXERS = new Map([
  [31887, (caseRecord, changes) => replaceText(caseRecord, 'rationale.correct', /\ba\.figure significantly\b/g, 'a figure significantly', changes)],
  [35212, (caseRecord, changes) => replaceText(caseRecord, 'rationale.correct', /\bRotenone- a\.fish poison\b/g, 'Rotenone, a fish poison', changes)],
  [39451, (caseRecord, changes) => replaceText(caseRecord, 'rationale.correct', /\ba\.feature\b/g, 'a feature', changes)],
  [19014, repair19014],
  [980124, repair980124],
  [66563, quarantine66563],
]);

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const byId = new Map(cases.map((caseRecord) => [Number(caseRecord._id), caseRecord]));
  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
  };

  for (const [caseId, fixer] of FIXERS.entries()) {
    const caseRecord = byId.get(caseId);
    if (!caseRecord) continue;
    const changes = [];
    fixer(caseRecord, changes);
    markTouched(caseRecord, changes, caseId === 66563 ? 'quarantine_source_splice' : 'repair_source_text_residual');
    if (changes.length > 0) {
      report.modified_cases.push({
        _id: caseRecord._id,
        case_code: caseRecord.case_code || '',
        source: caseRecord.meta?.source || caseRecord.source || 'unknown',
        changes,
      });
    }
  }

  const repository = createCasebankRepository();
  try {
    const modifiedIds = new Set(report.modified_cases.map((item) => Number(item._id)));
    repository.updateCaseSnapshots(cases.filter((caseRecord) => modifiedIds.has(Number(caseRecord._id))));
  } finally {
    repository.close();
  }

  writeJsonAtomically(DATA_FILE, cases, true);
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Source text residual microfix applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report: ${REPORT_FILE}`);
}

main();
