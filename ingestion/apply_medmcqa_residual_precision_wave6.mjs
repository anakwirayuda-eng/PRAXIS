import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'medmcqa_residual_precision_wave6_report.json');
const BASIS = 'deterministic:medmcqa-residual-precision-wave6';

const FIXES = [
  {
    id: '16',
    prompt: 'Glucose symport occurs with which ion?',
    narrative: 'Glucose is transported into intestinal and renal tubular cells by symport with which ion?',
    rationale:
      'Glucose is cotransported with sodium through sodium-glucose cotransporters (SGLT) in the intestine and renal tubules. Therefore, Na+ is the correct answer.',
    options: [
      { id: 'A', text: 'Na+', is_correct: true },
      { id: 'B', text: 'Ca++', is_correct: false },
      { id: 'C', text: 'K+', is_correct: false },
      { id: 'D', text: 'Cl-', is_correct: false },
    ],
    notes: 'Recovered a truncated physiology stem and replaced the contaminated rationale with the standard sodium-glucose symport explanation.',
  },
  {
    id: '4969',
    prompt: 'HLA class III genes code for which of the following?',
    narrative: 'HLA class III genes code for which of the following?',
    rationale:
      'HLA class III genes encode several complement components, including C2, C4, and factor B. Therefore, complement is the correct answer.',
    options: [
      { id: 'A', text: 'Immunological reaction in graft rejection', is_correct: false },
      { id: 'B', text: 'Complement', is_correct: true },
      { id: 'C', text: 'Graft versus host reaction', is_correct: false },
      { id: 'D', text: 'Immunoglobulins', is_correct: false },
    ],
    notes: 'Repaired the likely class-number typo in the stem and aligned the answer with the known class III HLA complement locus.',
  },
  {
    id: '6935',
    prompt: 'Which of the following is false regarding delusions?',
    narrative: 'Which of the following statements is false regarding delusions?',
    rationale:
      'Delusions are false, fixed beliefs held with strong conviction and not amenable to reasoning. They are not shared by people of the same cultural or social background. Therefore, option D is the false statement.',
    options: [
      { id: 'A', text: 'Held with absolute conviction', is_correct: false },
      { id: 'B', text: 'Usually false', is_correct: false },
      { id: 'C', text: 'Not amenable to reasoning', is_correct: false },
      { id: 'D', text: 'Shared by those of a common social background', is_correct: true },
    ],
    notes: 'Removed the dated prompt fragment and restored the intended psychiatry question about the defining properties of delusions.',
  },
  {
    id: '32315',
    prompt: 'Initial investigation of choice for dysphagia for solids is:',
    narrative: 'A patient presents with dysphagia predominantly for solids. What is the initial investigation of choice?',
    rationale:
      'Dysphagia for solids suggests a structural esophageal lesion. A barium swallow is the initial investigation of choice to evaluate mechanical obstruction, whereas manometry is reserved for suspected motility disorders.',
    options: [
      { id: 'A', text: 'Barium swallow', is_correct: true },
      { id: 'B', text: 'Endoscopy', is_correct: false },
      { id: 'C', text: 'X-ray chest', is_correct: false },
      { id: 'D', text: 'CT scan', is_correct: false },
    ],
    notes: 'Replaced the mismatched manometry/CT rationale with the standard structural-dysphagia workup and restored the answer key to barium swallow.',
  },
  {
    id: '36866',
    prompt: 'Which of the following biomarkers can be associated with chronic kidney disease?',
    narrative: 'Which of the following biomarkers can be associated with chronic kidney disease?',
    rationale:
      'NGAL, KIM-1, and asymmetric dimethylarginine have all been studied as biomarkers associated with chronic kidney disease and CKD progression. The best answer is the summary option that includes all three markers.',
    options: [
      { id: 'A', text: 'NGAL', is_correct: false },
      { id: 'B', text: 'KIM-1', is_correct: false },
      { id: 'C', text: 'Asymmetric dimethylarginine', is_correct: false },
      { id: 'D', text: 'All of the above biomarkers can be associated with chronic kidney disease', is_correct: true },
    ],
    notes: 'Resolved the all-of-the-above ambiguity by making option D an explicit summary statement rather than a trap answer.',
  },
  {
    id: '37204',
    prompt: 'What dose of adrenaline (epinephrine) is given to a child with cardiac arrest?',
    narrative: 'What dose of adrenaline (epinephrine) is given to a child with cardiac arrest?',
    rationale:
      'The standard pediatric cardiac arrest dose is 0.01 mg/kg IV/IO, which is 0.1 mL/kg of a 1:10,000 solution. Therefore, option C is correct.',
    options: [
      { id: 'A', text: '0.1 mL/kg of 1:1000 solution', is_correct: false },
      { id: 'C', text: '0.1 mL/kg of 1:10000 solution', is_correct: true },
    ],
    notes: 'Filled the missing numeric dose and corrected the answer key to the standard 1:10,000 pediatric arrest concentration.',
  },
  {
    id: '39380',
    prompt: "Which ONE feature helps differentiate Alzheimer's dementia from delirium in a 70-year-old man with a urinary tract infection?",
    narrative: "Which ONE feature helps differentiate Alzheimer's dementia from delirium in a 70-year-old man with a urinary tract infection?",
    rationale:
      "Apraxia is a cortical feature of Alzheimer's dementia and is not a typical feature of delirium. Memory disturbance and delusions can occur in both conditions, but apraxia more strongly favors dementia.",
    options: [
      { id: 'A', text: 'Memory disturbance', is_correct: false },
      { id: 'B', text: 'Apraxia', is_correct: true },
      { id: 'C', text: 'Delusion', is_correct: false },
    ],
    notes: 'Aligned the answer key with the prior phase-2 adjudication: apraxia is the best differentiating feature among the listed options.',
  },
  {
    id: '42953',
    prompt: 'Humans are the definitive host for which of the following combinations?',
    narrative: 'Among the organisms listed below, humans act as the definitive host for which combination?',
    rationale:
      'Humans are definitive hosts for Taenia solium and Taenia saginata. Echinococcus species and Toxocara canis use other carnivores as definitive hosts. Therefore, option A is correct.',
    options: [
      { id: 'A', text: 'Taenia solium and Taenia saginata', is_correct: true },
      { id: 'B', text: 'Taenia saginata only', is_correct: false },
      { id: 'C', text: 'Echinococcus granulosus and Taenia saginata', is_correct: false },
      { id: 'D', text: 'Echinococcus granulosus and Toxocara canis', is_correct: false },
    ],
    notes: 'Decoded the compressed answer-combination options into readable parasite names and restored the intended microbiology question.',
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

function ensureOptions(caseRecord) {
  if (!Array.isArray(caseRecord.options)) {
    caseRecord.options = [];
  }
  return caseRecord.options;
}

function ensureQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
  }
}

function clearHoldFlags(meta) {
  let changed = false;
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

function clearReviewFlags(meta) {
  let changed = false;
  if (meta.needs_review !== false) {
    meta.needs_review = false;
    changed = true;
  }
  for (const key of ['needs_review_reason', 'needs_review_reasons', 'review_queue']) {
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
  if (meta.truncated === true) {
    meta.truncated = false;
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

function setReadabilityPass(meta, basis, now, rationale, notes, answerAnchor) {
  let changed = false;
  const updates = {
    review_confidence: 'HIGH',
    review_source: basis,
    reviewed_at: now,
    readability_ai_batch: basis,
    readability_ai_playbook: 'clinical_rewrite',
    ai_audited: true,
    reviewed: true,
    readability_ai_pass: true,
    readability_ai_basis: basis,
    readability_ai_pass_at: now,
    review_rationale: rationale,
    readability_ai_rewrite_notes: notes,
    answer_anchor_text: answerAnchor,
  };
  for (const [key, value] of Object.entries(updates)) {
    if (meta[key] !== value) {
      meta[key] = value;
      changed = true;
    }
  }
  return changed;
}

function applyFix(caseRecord, fix, now) {
  const meta = ensureMeta(caseRecord);
  const vignette = ensureVignette(caseRecord);
  const rationale = ensureRationale(caseRecord);
  const options = ensureOptions(caseRecord);
  let changed = false;

  const nextPrompt = normalizeWhitespace(fix.prompt);
  const nextNarrative = normalizeWhitespace(fix.narrative);
  const nextRationale = normalizeWhitespace(fix.rationale);
  const nextOptions = fix.options.map((option) => ({
    id: option.id,
    text: normalizeWhitespace(option.text),
    is_correct: option.is_correct === true,
  }));
  const answerAnchor = nextOptions.find((option) => option.is_correct)?.text ?? '';

  if (normalizeWhitespace(caseRecord.prompt) !== nextPrompt) {
    caseRecord.prompt = nextPrompt;
    changed = true;
  }
  if (normalizeWhitespace(caseRecord.title) !== nextPrompt) {
    caseRecord.title = nextPrompt;
    changed = true;
  }
  if ('question' in caseRecord && normalizeWhitespace(caseRecord.question) && normalizeWhitespace(caseRecord.question) !== nextNarrative) {
    caseRecord.question = nextNarrative;
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
  if (Object.keys(rationale.distractors).length > 0) {
    rationale.distractors = {};
    changed = true;
  }
  if (normalizeWhitespace(rationale.pearl) !== '') {
    rationale.pearl = '';
    changed = true;
  }

  const currentOptions = options.map((option) => ({
    id: String(option.id),
    text: normalizeWhitespace(option.text),
    is_correct: option.is_correct === true,
  }));
  if (JSON.stringify(currentOptions) !== JSON.stringify(nextOptions)) {
    caseRecord.options = nextOptions;
    changed = true;
  }

  changed = clearHoldFlags(meta) || changed;
  changed = clearReviewFlags(meta) || changed;
  changed = clearQuarantineFlags(meta) || changed;
  changed = setReadabilityPass(meta, BASIS, now, nextRationale, fix.notes, answerAnchor) || changed;

  ensureQualityFlag(meta, 'residual_precision_wave6');
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

    const changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => applyFix(caseRecord, fix, now));
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

  console.log('MedMCQA residual precision wave6 complete');
  console.log(`  Changed cases: ${report.changed_count}`);
  console.log(`  Missing cases: ${report.missing_cases.length}`);
  console.log(`  Report:       ${REPORT_FILE}`);
}

main();
