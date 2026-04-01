import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveIndexByOptionId(options, optionId) {
  const normalized = String(optionId || '').trim().toUpperCase();
  return options.findIndex((option) => String(option?.id || '').trim().toUpperCase() === normalized);
}

function extractExplicitTargetOption(reasoning) {
  const text = String(reasoning || '');
  const match = text.match(/(?:option\s+|so\s+option\s+|therefore\s+option\s+)([A-E])\s+is\s+correct/i)
    || text.match(/\b([A-E])\s+is\s+correct\b/i);
  return match ? match[1].toUpperCase() : null;
}

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT';
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentIndex = options.findIndex((option) => option?.is_correct === true);
  if (currentIndex < 0) continue;

  let targetIndex = null;
  let basis = null;

  const explicitTarget = extractExplicitTargetOption(item.meta?.fase2_reasoning);
  if (explicitTarget) {
    const resolvedIndex = resolveIndexByOptionId(options, explicitTarget);
    if (resolvedIndex >= 0) {
      targetIndex = resolvedIndex;
      basis = 'fase2_reasoning_explicit_option';
    }
  }

  if (targetIndex === null && item.meta?.fase2_correct) {
    const normalizedTarget = normalizeText(item.meta.fase2_correct);
    const exactMatches = options
      .map((option, index) => ({ index, text: normalizeText(option?.text) }))
      .filter((entry) => entry.text && entry.text === normalizedTarget);
    if (exactMatches.length === 1) {
      targetIndex = exactMatches[0].index;
      basis = 'fase2_correct_exact_text';
    }
  }

  if (targetIndex === null || targetIndex === currentIndex) continue;

  for (let index = 0; index < options.length; index += 1) {
    options[index].is_correct = index === targetIndex;
  }

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'answer_key_phase3';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = basis;
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE3_KEYFIX';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    from_index: currentIndex,
    to_index: targetIndex,
    from_text: options[currentIndex]?.text ?? null,
    to_text: options[targetIndex]?.text ?? null,
    fase2_correct: item.meta?.fase2_correct ?? null,
    basis,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase3.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
