import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

const CURATED_REKEY = new Map([
  [13891, { targetId: 'B', basis: 'manual_rekey_presbyopia_bifocal' }],
  [35365, { targetId: 'B', basis: 'manual_rekey_race_file_design' }],
  [46053, { targetId: 'B', basis: 'manual_rekey_counter_bevel_occlusal_surface' }],
  [46915, { targetId: 'A', basis: 'manual_rekey_hand_to_hand_transfer_visual_motor' }],
  [46359, { targetId: 'C', basis: 'manual_rekey_elderly_focal_seizure_levetiracetam' }],
  [46416, { targetId: 'C', basis: 'manual_rekey_non_central_rash_secondary_syphilis' }],
  [46464, { targetId: 'B', basis: 'manual_rekey_resting_potential_hyperpolarization' }],
  [46793, { targetId: 'C', basis: 'manual_rekey_spurious_drug_definition' }],
]);

function findIndexByOptionId(options, targetId) {
  const normalized = String(targetId || '').trim().toUpperCase();
  return options.findIndex((option) => String(option?.id || '').trim().toUpperCase() === normalized);
}

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
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const fromIndex = options.findIndex((option) => option?.is_correct === true);
  const config = CURATED_REKEY.get(item._id);
  const toIndex = findIndexByOptionId(options, config?.targetId);

  if (toIndex < 0 || fromIndex === toIndex) continue;

  for (let index = 0; index < options.length; index += 1) {
    options[index].is_correct = index === toIndex;
  }

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'answer_key_phase5';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = config.basis;
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE5_KEYFIX';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    from_id: options[fromIndex]?.id ?? null,
    from_text: options[fromIndex]?.text ?? null,
    to_id: options[toIndex]?.id ?? null,
    to_text: options[toIndex]?.text ?? null,
    basis: config.basis,
    fase2_reasoning: item.meta?.fase2_reasoning ?? null,
  });
}

if (modified.length > 0) {
  repo.updateCaseSnapshots(modified);
}

const report = {
  generated_at: new Date().toISOString(),
  total_scanned: candidates.length,
  resolved_count: resolved.length,
  resolved,
};

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase5.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
