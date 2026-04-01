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
    .replace(/\b(a|an|the|of|and|or|to|in|is|are|for|with|without|by|on|at|from|that|this|be|it)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) table[i][0] = i;
  for (let j = 0; j < cols; j += 1) table[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + cost,
      );
    }
  }

  return {
    distance: table[left.length][right.length],
    leftLength: left.length,
    rightLength: right.length,
  };
}

function getRationaleText(item) {
  if (typeof item.rationale === 'string') return item.rationale;
  return item.rationale?.correct || '';
}

function getMentionedOptionIds(rationaleText, options) {
  const normalizedRationale = normalizeText(rationaleText);
  const mentioned = [];

  for (const option of options) {
    const normalizedOption = normalizeText(option?.text);
    if (normalizedOption && normalizedOption.length >= 4 && normalizedRationale.includes(normalizedOption)) {
      mentioned.push(String(option.id || '').trim().toUpperCase());
    }
  }

  return mentioned;
}

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const candidates = allCases.filter((item) => {
  const meta = item.meta || {};
  return meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT'
    && (meta.truncated === true || meta.answer_anchor_text || meta.hack5_contradiction === true)
    && !meta.fase2_correct;
});

const resolved = [];
const modified = [];

for (const item of candidates) {
  const options = Array.isArray(item.options) ? item.options : [];
  const currentCorrect = options.find((option) => option?.is_correct === true);
  if (!currentCorrect?.text) continue;

  const rationaleText = getRationaleText(item);
  const mentionedOptionIds = getMentionedOptionIds(rationaleText, options);
  const normalizedCurrentId = String(currentCorrect.id || '').trim().toUpperCase();

  let basis = null;

  const anchorText = item.meta?.answer_anchor_text;
  if (anchorText) {
    const { distance, leftLength, rightLength } = levenshteinDistance(anchorText, currentCorrect.text);
    const maxLength = Math.max(leftLength, rightLength, 1);
    if ((distance / maxLength) <= 0.25) {
      basis = 'answer_anchor_text_fuzzy';
    }
  }

  if (!basis) {
    const qualityScore = Number(item.meta?.quality_score || 0);
    if (qualityScore >= 70 && mentionedOptionIds.length === 1 && mentionedOptionIds[0] === normalizedCurrentId) {
      basis = 'single_option_rationale';
    }
  }

  if (!basis) continue;

  delete item.meta.status;
  item.meta.ai_conflict_resolved = true;
  item.meta.ai_conflict_resolution_lane = 'mechanical_phase2';
  item.meta.ai_conflict_resolved_at = new Date().toISOString();
  item.meta.ai_conflict_resolution_basis = basis;
  item.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE2_MECHANICAL';

  modified.push(item);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    basis,
    quality_score: item.meta?.quality_score ?? null,
    prompt: item.prompt,
    current_correct_id: normalizedCurrentId,
    current_correct_text: currentCorrect.text,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_mechanical_phase2.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  total_scanned: candidates.length,
  resolved_count: resolved.length,
}, null, 2));

repo.close();
