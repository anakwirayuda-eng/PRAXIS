import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'metric_collision_micro_audit_wave1_report.json');
const BASIS = 'deterministic:metric-collision-micro-audit-wave1';

const FIXES = [
  {
    id: '4899',
    prompt: 'These arterial blood gas values are most consistent with which acid-base disorder?',
    narrative: 'pH 7.24, PaO2 55 mmHg, PaCO2 50 mmHg, and HCO3- 30 mEq/L.',
    rationale:
      'A pH below 7.35 indicates acidemia. The PaCO2 is elevated at 50 mmHg, which identifies a primary respiratory process. The bicarbonate is mildly elevated at 30 mEq/L, consistent with metabolic compensation. The best available answer choice is respiratory acidosis.',
    notes:
      'Normalized ABG units to mmHg and mEq/L, split the lab values into a clean vignette, and rewrote the rationale into a concise acid-base explanation.',
  },
  {
    id: '28604',
    prompt: 'Which method is the fastest and most accurate way to confirm correct endotracheal intubation?',
    narrative:
      'An infant with respiratory distress has been intubated. Which method is the fastest and most accurate way to confirm correct endotracheal tube placement?',
    rationale:
      'Continuous capnography is the fastest and most reliable method to confirm tracheal intubation. Sustained end-tidal CO2 indicates tracheal placement, whereas absent ETCO2 strongly suggests esophageal intubation. End-tidal CO2 is normally a few mmHg lower than arterial PaCO2.',
    notes:
      'Collapsed the noisy capnography wrapper into a short rationale and standardized the unit wording so the case no longer mixes mmHg variants.',
  },
  {
    id: '35227',
    prompt: 'Which of the following drugs should NOT be used in this patient?',
    narrative:
      'A patient presents with headache, profuse sweating, and blood pressure 200/120 mmHg. Which of the following drugs should NOT be used?',
    rationale:
      'Immediate-release nifedipine should be avoided because it can cause an abrupt and unpredictable fall in blood pressure with risk of ischemia. Sodium nitroprusside can be used in hypertensive emergencies, and phenoxybenzamine is appropriate when pheochromocytoma is suspected. Methyldopa is not the key contraindicated choice in this setting.',
    notes:
      'Replaced an unrelated pulmonary-hypertension rationale with a focused explanation for severe hypertension and standardized the blood-pressure unit to mmHg.',
  },
  {
    id: '38772',
    prompt: 'Which of the following is NOT a clinical criterion for brain death?',
    narrative:
      'Brain death is the irreversible cessation of all brain function. Clinical criteria include coma, absence of brainstem reflexes, and absence of motor activity. Spinal cord reflexes may still be present and are not part of the criteria.',
    rationale:
      'Absent spinal cord reflexes are not required for the diagnosis of brain death, so option C is the correct answer. Brain death requires coma, absence of brainstem reflexes, and absent spontaneous respirations on apnea testing, typically with PaCO2 reaching at least 60 mmHg or rising 20 mmHg above baseline.',
    notes:
      'Standardized PaCO2 thresholds to mmHg and rewrote the rationale into a clean summary without the previous mixed-unit artifacts.',
  },
];

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

function ensureVignette(caseRecord) {
  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object' || Array.isArray(caseRecord.vignette)) {
    caseRecord.vignette = {
      demographics: { age: null, sex: null },
      narrative: '',
      vitalSigns: null,
      labFindings: null,
    };
  }
  if (!caseRecord.vignette.demographics || typeof caseRecord.vignette.demographics !== 'object') {
    caseRecord.vignette.demographics = { age: null, sex: null };
  }
  return caseRecord.vignette;
}

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    caseRecord.rationale = {
      correct: '',
      distractors: {},
      pearl: '',
    };
  }
  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }
  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = caseRecord.rationale.correct == null ? '' : String(caseRecord.rationale.correct);
  }
  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = caseRecord.rationale.pearl == null ? '' : String(caseRecord.rationale.pearl);
  }
  return caseRecord.rationale;
}

function ensureQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
  }
}

function clearMetricCollisionArtifacts(caseRecord, fix, now) {
  const meta = ensureMeta(caseRecord);
  const vignette = ensureVignette(caseRecord);
  const rationale = ensureRationale(caseRecord);
  let changed = false;

  const nextPrompt = normalizeWhitespace(fix.prompt);
  const nextNarrative = normalizeWhitespace(fix.narrative);
  const nextRationale = normalizeWhitespace(fix.rationale);

  if (normalizeWhitespace(caseRecord.prompt) !== nextPrompt) {
    caseRecord.prompt = nextPrompt;
    changed = true;
  }
  if (normalizeWhitespace(caseRecord.title) !== nextPrompt) {
    caseRecord.title = nextPrompt;
    changed = true;
  }
  if (normalizeWhitespace(vignette.narrative) !== nextNarrative) {
    vignette.narrative = nextNarrative;
    changed = true;
  }
  if (normalizeWhitespace(rationale.correct) !== nextRationale) {
    rationale.correct = nextRationale;
    changed = true;
  }

  if (meta.needs_review !== false) {
    meta.needs_review = false;
    changed = true;
  }
  if (meta.reviewed !== true) {
    meta.reviewed = true;
    changed = true;
  }
  if (meta.ai_audited !== true) {
    meta.ai_audited = true;
    changed = true;
  }
  if (meta.review_source !== BASIS) {
    meta.review_source = BASIS;
    changed = true;
  }
  if (meta.readability_ai_batch !== BASIS) {
    meta.readability_ai_batch = BASIS;
    changed = true;
  }
  if (meta.readability_ai_basis !== BASIS) {
    meta.readability_ai_basis = BASIS;
    changed = true;
  }
  if (meta.readability_ai_playbook !== 'clinical_rewrite') {
    meta.readability_ai_playbook = 'clinical_rewrite';
    changed = true;
  }
  if (meta.review_confidence !== 'HIGH') {
    meta.review_confidence = 'HIGH';
    changed = true;
  }
  if (meta.readability_ai_pass !== true) {
    meta.readability_ai_pass = true;
    changed = true;
  }
  if (meta.reviewed_at !== now) {
    meta.reviewed_at = now;
    changed = true;
  }
  if (meta.readability_ai_pass_at !== now) {
    meta.readability_ai_pass_at = now;
    changed = true;
  }
  if (meta.review_rationale !== nextRationale) {
    meta.review_rationale = nextRationale;
    changed = true;
  }
  if (meta.readability_ai_rewrite_notes !== fix.notes) {
    meta.readability_ai_rewrite_notes = fix.notes;
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

  ensureQualityFlag(meta, 'metric_collision_cleared');
  ensureQualityFlag(meta, 'metric_collision_micro_audit_wave1');
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
  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const touchedDbCases = [];
  const report = {
    generated_at: now,
    basis: BASIS,
    targeted_cases: FIXES.length,
    changed_cases: [],
    missing_cases: [],
  };

  for (const fix of FIXES) {
    const jsonCase = jsonCaseMap.get(fix.id);
    const dbCase = dbCaseMap.get(fix.id);
    if (!jsonCase || !dbCase) {
      report.missing_cases.push(fix.id);
      continue;
    }

    const changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => clearMetricCollisionArtifacts(caseRecord, fix, now));
    if (!changed) {
      continue;
    }

    touchedDbCases.push(dbCase);
    report.changed_cases.push({
      _id: Number(fix.id),
      case_code: dbCase.case_code,
      prompt: dbCase.prompt,
      notes: fix.notes,
    });
  }

  if (touchedDbCases.length > 0) {
    repo.updateCaseSnapshots(touchedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases);
  }
  repo.close();

  report.changed_count = report.changed_cases.length;
  writeJsonAtomically(REPORT_FILE, report);

  console.log(`Metric collision micro-audit wave1 complete`);
  console.log(`  Changed cases: ${report.changed_count}`);
  console.log(`  Missing cases: ${report.missing_cases.length}`);
  console.log(`  Report:       ${REPORT_FILE}`);
}

main();
