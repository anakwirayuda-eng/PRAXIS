import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

const CURATED_SAFE_IDS = new Map([
  [4241, 'rationale_supports_current_key'],
  [28102, 'rationale_supports_current_key'],
  [30085, 'rationale_supports_current_key'],
  [30211, 'rationale_supports_current_key'],
  [32491, 'rationale_supports_current_key'],
  [34067, 'fase2_correct_matches_current_text'],
  [35557, 'rationale_supports_current_key'],
  [36713, 'rationale_supports_current_key'],
  [38613, 'rationale_supports_current_key'],
  [40383, 'rationale_supports_current_key'],
  [40550, 'rationale_supports_current_key'],
  [41282, 'rationale_supports_current_key'],
  [42232, 'rationale_supports_current_key'],
  [42576, 'rationale_supports_current_key'],
  [43809, 'rationale_supports_current_key'],
  [44760, 'rationale_supports_current_key'],
  [44774, 'rationale_supports_current_key'],
  [46123, 'rationale_supports_current_key'],
  [46661, 'rationale_supports_current_key'],
  [46769, 'rationale_supports_current_key'],
]);

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && CURATED_SAFE_IDS.has(item._id);
});

const resolved = [];

for (const item of candidates) {
  const currentCorrect = (item.options || []).find((option) => option?.is_correct === true);
  if (!currentCorrect) continue;

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'clinical_phase1';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = CURATED_SAFE_IDS.get(item._id);
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE1_CLINICAL_CONFIRM';

  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    prompt: item.prompt,
    current_correct_id: currentCorrect.id,
    current_correct_text: currentCorrect.text,
    basis: CURATED_SAFE_IDS.get(item._id),
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_clinical_phase1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
