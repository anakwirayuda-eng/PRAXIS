import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function isAllowedReason(reason) {
  return [
    'truncated',
    'ocr_or_restored_source_noise',
    'hack5_contradiction',
    'fase2_minor',
  ].includes(reason);
}

function looksAmbiguousAnswer(text) {
  return /(both|all of the above|none of the above|all)$/i.test(String(text || '').trim());
}

function deriveReasons(meta) {
  const reasons = [];
  if (meta.truncated === true) reasons.push('truncated');
  if (meta.answer_anchor_text) reasons.push('answer_anchor_text');
  if (meta.hack5_contradiction === true) reasons.push('hack5_contradiction');
  if (String(meta.fase2_verdict || '').toUpperCase() === 'MINOR') reasons.push('fase2_minor');

  const prompt = String(meta.restored_prompt || meta.original_prompt || '');
  if (!reasons.length && /[a-z]{2,}.*[a-z]{2,}/i.test(prompt) === false) {
    reasons.push('ocr_or_restored_source_noise');
  }

  return reasons;
}

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  const reasons = deriveReasons(meta);
  const currentCorrect = Array.isArray(item.options)
    ? item.options.find((option) => option?.is_correct === true)
    : null;

  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && !meta.fase2_correct
    && !meta.answer_anchor_text
    && Number(meta.quality_score || 0) >= 75
    && String(item.prompt || '').trim().length >= 8
    && currentCorrect?.text
    && !looksAmbiguousAnswer(currentCorrect.text)
    && reasons.length > 0
    && reasons.every(isAllowedReason);
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const currentCorrect = item.options.find((option) => option?.is_correct === true);

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'mechanical_phase3';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = 'high_quality_mechanical_residue';
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE3_MECHANICAL';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    quality_score: item.meta?.quality_score ?? null,
    prompt: item.prompt,
    current_correct_text: currentCorrect?.text ?? null,
    reasons: deriveReasons(item.meta || {}),
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_mechanical_phase3.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
