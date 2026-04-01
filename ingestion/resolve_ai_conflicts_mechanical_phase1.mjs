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

function hasExplicitCue(text) {
  return /(answer|correct|ans\.?|i\.e\.|option)/i.test(String(text || ''));
}

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && (meta.truncated === true || meta.answer_anchor_text || meta.hack5_contradiction === true);
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentCorrect = options.find((option) => option?.is_correct === true);
  if (!currentCorrect?.text) continue;

  const rationaleText = typeof item.rationale === 'string'
    ? item.rationale
    : item.rationale?.correct || '';

  const normalizedCorrect = normalizeText(currentCorrect.text);
  const normalizedRationale = normalizeText(rationaleText);
  const normalizedAnchor = normalizeText(item.meta?.answer_anchor_text);

  const anchorAligned = Boolean(normalizedAnchor) && normalizedAnchor === normalizedCorrect;
  const explicitCueAligned = hasExplicitCue(rationaleText) && normalizedRationale.includes(normalizedCorrect);

  if (!anchorAligned && !explicitCueAligned) continue;

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'mechanical_phase1';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = anchorAligned ? 'answer_anchor_text' : 'explicit_rationale_cue';
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE1_MECHANICAL';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    basis: item.meta.ai_conflict_resolution_basis,
    current_correct: currentCorrect.text,
    prompt: item.prompt,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_mechanical_phase1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
