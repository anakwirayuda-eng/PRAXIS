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

function markResolved(caseData, resolution) {
  caseData.meta = caseData.meta || {};
  delete caseData.meta.status;
  caseData.meta.ai_conflict_resolved = true;
  caseData.meta.ai_conflict_resolution_lane = 'clinical_phase2';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE2_CLINICAL_KEYFIX';
}

function updateOptionText(caseData, optionId, newText) {
  caseData.options = (caseData.options || []).map((option) => (
    String(option.id) === String(optionId)
      ? { ...option, text: newText }
      : option
  ));
}

const CURATED_REKEY = new Map([
  [27806, { targetId: 'B', basis: 'manual_rekey_bronchogenic_carcinoma_hemoptysis' }],
  [30451, { targetId: 'C', basis: 'manual_rekey_urinary_iodine_most_sensitive' }],
  [30771, { targetId: 'C', basis: 'manual_rekey_length_tension_point_D' }],
  [32190, { targetId: 'C', basis: 'manual_rekey_brechner_bethune_plethysmography' }],
  [39274, { targetId: 'B', basis: 'manual_rekey_ovarian_cancer_alkylating_response_rate' }],
  [39660, { targetId: 'B', basis: 'manual_rekey_cardiac_output_peak_mid_gestation' }],
  [43795, { targetId: 'C', basis: 'manual_rekey_endometrial_biopsy_mid_secretory' }],
  [44090, { targetId: 'C', basis: 'manual_rekey_first_school_health_service_usa' }],
  [44352, { targetId: 'B', basis: 'manual_rekey_finder_excludes_thumb_pair' }],
  [45504, { targetId: 'B', basis: 'manual_rekey_shamrock_access' }],
  [45584, { targetId: 'C', basis: 'manual_rekey_black_primary_cutting_edge_angle' }],
  [46397, { targetId: 'A', basis: 'manual_rekey_sealer_properties_determining_penetration' }],
  [46459, { targetId: 'A', basis: 'manual_rekey_ferrier_separator_exception' }],
  [46551, { targetId: 'B', basis: 'manual_rekey_subjective_fear' }],
  [46584, { targetId: 'A', basis: 'manual_rekey_ttc_infarcted_myocardium_white' }],
]);

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();
const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && CURATED_REKEY.has(item._id);
});

const resolved = [];

for (const item of candidates) {
  const config = CURATED_REKEY.get(item._id);
  if (!config) continue;

  switch (item._id) {
    case 30771:
      updateOptionText(item, 'C', 'D');
      break;
    case 45504:
      updateOptionText(item, 'B', 'Shamrock access');
      break;
    default:
      break;
  }

  setSingleCorrect(item, config.targetId);
  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'clinical_phase2';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = config.basis;
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE2_CLINICAL_KEYFIX';

  const currentCorrect = (item.options || []).find((option) => option?.is_correct === true);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    prompt: item.prompt,
    current_correct_id: currentCorrect?.id ?? null,
    current_correct_text: currentCorrect?.text ?? null,
    basis: config.basis,
  });
}

if (candidates.length > 0) {
  repo.updateCaseSnapshots(candidates);
}

const report = {
  generated_at: new Date().toISOString(),
  resolved_count: resolved.length,
  resolved,
};

writeFileSync(join(outputDir, 'ai_conflict_resolved_clinical_phase2.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
