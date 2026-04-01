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

const candidates = allCases.filter((item) => item.meta?.source === 'medmcqa' && item.meta?.status === 'QUARANTINED_AI_CONFLICT');
const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentCorrectIndex = options.findIndex((option) => option?.is_correct === true);
  if (currentCorrectIndex === -1) continue;

  const currentCorrectText = normalizeText(options[currentCorrectIndex]?.text);
  const fase2CorrectIndex = resolveOptionIndexById(options, item.meta?.fase2_correct);
  const anchorText = normalizeText(item.meta?.answer_anchor_text);

  const alignedWithFase2 = fase2CorrectIndex !== null && fase2CorrectIndex === currentCorrectIndex;
  const alignedWithAnchor = Boolean(anchorText) && anchorText === currentCorrectText;

  if (!alignedWithFase2 && !alignedWithAnchor) continue;

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'stale_aligned';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = alignedWithFase2 && alignedWithAnchor
    ? 'fase2_and_anchor'
    : alignedWithFase2
      ? 'fase2_correct'
      : 'answer_anchor_text';
  item.meta.clinical_consensus = item.meta.clinical_consensus || 'AI_CONFLICT_RESOLVED_PHASE1';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    basis: item.meta.ai_conflict_resolution_basis,
    current_correct: options[currentCorrectIndex]?.text ?? null,
    fase2_correct: item.meta?.fase2_correct ?? null,
    answer_anchor_text: item.meta?.answer_anchor_text ?? null,
  });
}

if (modified.length > 0) {
  repo.updateCaseSnapshots(modified);
}

const report = {
  generated_at: new Date().toISOString(),
  total_conflicts_scanned: candidates.length,
  resolved_count: resolved.length,
  resolved,
};

writeFileSync(join(outputDir, 'ai_conflict_resolved_stale.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_conflicts_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
