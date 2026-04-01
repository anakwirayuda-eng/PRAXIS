import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function setSingleCorrect(caseData, optionId) {
  caseData.options = (caseData.options || []).map((option) => ({
    ...option,
    is_correct: String(option.id) === String(optionId),
  }));
}

function setNarrative(caseData, text) {
  caseData.vignette = {
    ...(caseData.vignette || {}),
    narrative: text,
  };
}

function markResolved(caseData, resolution) {
  caseData.meta = caseData.meta || {};
  delete caseData.meta.status;
  caseData.meta.ai_conflict_resolved = true;
  caseData.meta.ai_conflict_resolution_lane = 'answer_key_phase7_manual';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  caseData.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE7_MANUAL_KEYFIX';
}

const TARGET_ID = 45918;

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const item = repo.getAllCases().find((entry) => entry._id === TARGET_ID && entry.meta?.status === 'QUARANTINED_AI_CONFLICT');

const resolved = [];

if (item) {
  item.title = 'Calculate FEV1/FVC ratio from spirometry values';
  item.prompt = 'A patient has an FEV1 of 2.6 L and an FVC of 4.0 L. The FEV1/FVC ratio falls in which range?';
  setNarrative(item, item.prompt);
  item.rationale = {
    correct:
      'FEV1/FVC = 2.6 / 4.0 = 0.65, or 65%. Therefore the ratio falls in the 60-69% range.',
    distractors: {},
    pearl: 'Always convert the ratio to a percentage before choosing the nearest range option.',
  };
  setSingleCorrect(item, 'A');
  markResolved(item, 'Missing-curve item rewritten into explicit numeric spirometry ratio question.');

  repo.updateCaseSnapshots([item]);
  const currentCorrect = (item.options || []).find((option) => option?.is_correct === true);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    prompt: item.prompt,
    current_correct_id: currentCorrect?.id ?? null,
    current_correct_text: currentCorrect?.text ?? null,
    resolution: item.meta?.ai_conflict_resolution_basis ?? null,
  });
}

const report = {
  generated_at: new Date().toISOString(),
  resolved_count: resolved.length,
  resolved,
};

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase7_manual.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
