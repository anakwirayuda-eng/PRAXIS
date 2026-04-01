import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function resolveOptionIndexById(options, targetId) {
  const normalized = String(targetId || '').trim().toUpperCase();
  if (!normalized) return null;

  const letter = normalized.startsWith('OP') ? normalized.slice(2) : normalized;
  for (let index = 0; index < options.length; index += 1) {
    const optionId = String(options[index]?.id || '').trim().toUpperCase();
    if (optionId === normalized || optionId === letter || optionId === `OP${letter}`) {
      return index;
    }
  }

  if (/^[A-E]$/.test(letter)) {
    return letter.charCodeAt(0) - 65;
  }

  return null;
}

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && meta.fase2_correct
    && meta.truncated !== true
    && meta.hack5_contradiction !== true
    && Number(meta.quality_score || 0) >= 80;
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentCorrectIndex = options.findIndex((option) => option?.is_correct === true);
  const targetIndex = resolveOptionIndexById(options, item.meta?.fase2_correct);

  if (targetIndex === null || targetIndex < 0 || targetIndex >= options.length) continue;
  if (currentCorrectIndex === targetIndex) continue;

  for (let index = 0; index < options.length; index += 1) {
    options[index].is_correct = index === targetIndex;
  }

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'answer_key_phase1';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = 'fase2_correct';
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE1_KEYFIX';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    from_index: currentCorrectIndex,
    to_index: targetIndex,
    from_text: currentCorrectIndex >= 0 ? options[currentCorrectIndex]?.text ?? null : null,
    to_text: options[targetIndex]?.text ?? null,
    fase2_correct: item.meta?.fase2_correct ?? null,
    fase2_verdict: item.meta?.fase2_verdict ?? null,
    quality_score: item.meta?.quality_score ?? null,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
