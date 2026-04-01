import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

const CURATED_STALE_IDS = new Map([
  [1789, 'rationale_supports_current_key'],
  [3553, 'rationale_supports_current_key'],
  [34416, 'fase2_correct_matches_current_text'],
  [39167, 'fase2_correct_matches_current_text'],
  [39963, 'fase2_correct_matches_current_text'],
  [43061, 'fase2_correct_matches_current_text'],
  [45592, 'rationale_supports_current_key'],
  [45661, 'rationale_supports_current_key'],
  [45774, 'rationale_supports_current_key'],
  [46588, 'rationale_supports_current_key'],
  [46754, 'rationale_supports_current_key'],
  [46805, 'rationale_supports_current_key'],
  [46903, 'rationale_supports_current_key'],
]);

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && CURATED_STALE_IDS.has(item._id);
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentCorrect = options.find((option) => option?.is_correct === true);
  if (!currentCorrect) continue;

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'answer_key_phase4';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = CURATED_STALE_IDS.get(item._id);
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE4_KEYCONFIRM';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    prompt: item.prompt,
    current_correct_id: currentCorrect.id,
    current_correct_text: currentCorrect.text,
    basis: CURATED_STALE_IDS.get(item._id),
    fase2_correct: item.meta?.fase2_correct ?? null,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase4.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
