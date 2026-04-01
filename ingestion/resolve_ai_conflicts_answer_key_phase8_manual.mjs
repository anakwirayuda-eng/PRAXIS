import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

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
  caseData.meta.ai_conflict_resolution_lane = 'answer_key_phase8_manual';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  caseData.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE8_MANUAL_KEYCONFIRM';
}

const TARGET_ID = 46285;

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const item = repo.getAllCases().find((entry) => entry._id === TARGET_ID && entry.meta?.status === 'QUARANTINED_AI_CONFLICT');

const resolved = [];

if (item) {
  item.title = 'Drug causing nail pigmentation except';
  item.prompt = 'Pigmentation of the nails is classically caused by all of the following drugs except:';
  setNarrative(item, item.prompt);
  item.rationale = {
    correct:
      'Cyclophosphamide and chloroquine are recognized causes of nail pigmentation, and phenothiazines such as chlorpromazine can also cause pigmentary nail changes. Amiodarone is more classically associated with blue-grey cutaneous pigmentation rather than nail pigmentation.',
    distractors: {},
    pearl: 'When a drug is famous for photosensitive skin discoloration but not nail pigmentation, it often becomes the “except” answer in older pharmacology MCQs.',
  };
  markResolved(item, 'Current key confirmed after manual pharmacology review of nail pigmentation causes.');

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

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase8_manual.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
