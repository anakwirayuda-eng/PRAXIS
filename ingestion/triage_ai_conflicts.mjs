import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', 'server', 'data', 'casebank.db'));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveOptionIndexById(options, targetId) {
  const normalized = normalizeId(targetId);
  if (!normalized) return null;

  const letter = normalized.startsWith('OP') ? normalized.slice(2) : normalized;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const optionId = normalizeId(option.option_id || option.id);
    if (optionId === normalized || optionId === letter || optionId === `OP${letter}`) {
      return index;
    }
  }

  if (/^[A-E]$/.test(letter)) {
    return letter.charCodeAt(0) - 65;
  }

  return null;
}

function isLikelyMechanical(meta, row) {
  return Boolean(
    meta.truncated === true
      || meta.answer_anchor_text
      || meta.hack5_contradiction === true
      || /\bl0{2,}0|\bl7o\b|aboion|pubey|aery|hypeension|detion/i.test(row.prompt || '')
      || /\[RESTORED SOURCE\]/i.test(row.rationale || ''),
  );
}

function classifyConflict(row, options) {
  const meta = parseJson(row.meta_json, {});
  const quality = Number(meta.quality_score || 0);
  const fase2Correct = meta.fase2_correct ? String(meta.fase2_correct) : null;
  const fase2Verdict = String(meta.fase2_verdict || '').toUpperCase();
  const mappedFase2Index = fase2Correct ? resolveOptionIndexById(options, fase2Correct) : null;

  const reasons = [];
  const mechanical = isLikelyMechanical(meta, row);
  if (mechanical) {
    if (meta.truncated === true) reasons.push('truncated');
    if (meta.answer_anchor_text) reasons.push('answer_anchor_text');
    if (meta.hack5_contradiction === true) reasons.push('hack5_contradiction');
    if (reasons.length === 0) reasons.push('ocr_or_restored_source_noise');
  }

  const hasAnswerKeySignal = mappedFase2Index !== null || fase2Verdict === 'FATAL' || fase2Verdict === 'MINOR';
  if (mappedFase2Index !== null) reasons.push('fase2_correct');
  if (fase2Verdict === 'FATAL') reasons.push('fase2_fatal');
  if (fase2Verdict === 'MINOR') reasons.push('fase2_minor');

  let lane = 'clinical';
  if (mechanical) {
    lane = 'mechanical';
  } else if (hasAnswerKeySignal) {
    lane = 'answer_key';
  }

  let phase1Candidate = false;
  if (lane === 'mechanical') {
    phase1Candidate = Boolean(
      quality >= 70 && (mappedFase2Index !== null || meta.answer_anchor_text || meta.truncated === true),
    );
  } else if (lane === 'answer_key') {
    phase1Candidate = Boolean(
      quality >= 80 && mappedFase2Index !== null && meta.hack5_contradiction !== true && meta.truncated !== true,
    );
  }

  return {
    case_id: row.case_id,
    case_code: row.case_code,
    title: row.title,
    category: row.category,
    subject: row.subject,
    lane,
    reasons,
    phase1_candidate: phase1Candidate,
    quality_score: quality,
    fase2_verdict: meta.fase2_verdict || null,
    fase2_correct: fase2Correct,
    truncated: Boolean(meta.truncated),
    has_anchor_text: Boolean(meta.answer_anchor_text),
    hack5_contradiction: Boolean(meta.hack5_contradiction),
    option_count: options.length,
    prompt: row.prompt,
    options: options.map((option) => ({
      id: option.option_id,
      text: option.option_text,
      is_correct: Boolean(option.is_correct),
    })),
  };
}

const conflictRows = db.prepare(`
  SELECT
    case_id,
    case_code,
    category,
    title,
    prompt,
    subject,
    meta_json,
    rationale_json
  FROM cases
  WHERE source = 'medmcqa'
    AND meta_status = 'QUARANTINED_AI_CONFLICT'
  ORDER BY case_id
`).all();

const optionStmt = db.prepare(`
  SELECT option_id, option_text, is_correct
  FROM case_options
  WHERE case_id = ?
  ORDER BY sort_order
`);

const lanes = {
  mechanical: [],
  answer_key: [],
  clinical: [],
};

for (const row of conflictRows) {
  const options = optionStmt.all(row.case_id);
  const classified = classifyConflict(
    {
      ...row,
      rationale: parseJson(row.rationale_json, {}).correct || '',
    },
    options,
  );
  lanes[classified.lane].push(classified);
}

const summary = {
  generated_at: new Date().toISOString(),
  total_conflicts: conflictRows.length,
  lanes: {
    mechanical: {
      total: lanes.mechanical.length,
      phase1_candidates: lanes.mechanical.filter((item) => item.phase1_candidate).length,
    },
    answer_key: {
      total: lanes.answer_key.length,
      phase1_candidates: lanes.answer_key.filter((item) => item.phase1_candidate).length,
    },
    clinical: {
      total: lanes.clinical.length,
      phase1_candidates: 0,
    },
  },
  top_phase1_examples: [
    ...lanes.mechanical.filter((item) => item.phase1_candidate).slice(0, 10),
    ...lanes.answer_key.filter((item) => item.phase1_candidate).slice(0, 10),
  ],
};

writeFileSync(join(outputDir, 'ai_conflict_lane_summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputDir, 'ai_conflict_lane_mechanical.json'), `${JSON.stringify(lanes.mechanical, null, 2)}\n`);
writeFileSync(join(outputDir, 'ai_conflict_lane_answer_key.json'), `${JSON.stringify(lanes.answer_key, null, 2)}\n`);
writeFileSync(join(outputDir, 'ai_conflict_lane_clinical.json'), `${JSON.stringify(lanes.clinical, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
db.close();
