import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_editorial_rough_rationale_queue.json');
const SUMMARY_FILE = join(__dirname, 'output', 'readability_editorial_rough_rationale_summary.json');

const TARGET_BASES = new Set([
  'openai-batch:medmcqa-ipd-high-wave1:clinical_rewrite:high',
  'openai-batch:medmcqa-bedah-high-wave1-residual6-editorial:clinical_rewrite:high',
]);

const REFERENCE_HEAVY_RE = /\b(?:REF\s*:|Ref\s*:|See APPENDIX|APPENDIX-|Harrison\b|KDT\b|Bailey & Love|Part I page|Drug of choice|Immediate treatment)\b/i;
const META_EDITOR_RE = /\b(?:The question and options are clear|The prompt and narrative are concise and appropriate)\b/i;
const SHOUTY_RE = /[A-Z][A-Z/ \-]{11,}/;

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value, limit = 220) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function getNarrative(caseRecord) {
  if (typeof caseRecord.question === 'string' && normalizeWhitespace(caseRecord.question)) {
    return normalizeWhitespace(caseRecord.question);
  }
  if (typeof caseRecord.vignette === 'string') {
    return normalizeWhitespace(caseRecord.vignette);
  }
  if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    return normalizeWhitespace(caseRecord.vignette.narrative);
  }
  return '';
}

function getRationale(caseRecord) {
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }
  if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }
  return '';
}

function detectSignals(text) {
  const signals = [];
  if (REFERENCE_HEAVY_RE.test(text)) signals.push('reference_heavy_rationale');
  if (META_EDITOR_RE.test(text)) signals.push('meta_editorial_rationale');
  if (SHOUTY_RE.test(text)) signals.push('all_caps_reference_dump');
  return signals;
}

function createQueueRecord(caseRecord, signals) {
  const rationale = getRationale(caseRecord);
  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code ?? '',
    hash_id: caseRecord.hash_id ?? null,
    source: normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || ''),
    category: caseRecord.category ?? '',
    priority: 210 + Math.min(signals.length * 10, 30),
    lane: 'ai_adjudication',
    playbook: 'clinical_rewrite',
    lane_rationale: 'The answer key is already stable, but the visible rationale still reads like a source dump or editorial note and needs clinician cleanup for the live UI.',
    next_lane_if_unresolved: 'human_shortlist',
    reason_codes: ['editorial_rough_rationale', ...signals],
    reasons: [
      {
        code: 'editorial_rough_rationale',
        label: 'Rationale still contains rough editorial/source artifacts',
        origin: 'build_editorial_rough_rationale_queue',
        evidence: compactText(rationale),
        action: 'Rewrite the rationale into clean learner-facing prose without reference dumps or editorial meta-commentary.',
      },
    ],
    suggested_scripts: [
      'ingestion/export_readability_ai_pack.mjs',
      'ingestion/apply_readability_ai_pack.mjs',
    ],
    meta: {
      needs_review: true,
      truncated: Boolean(caseRecord?.meta?.truncated),
      quarantined: Boolean(caseRecord?.meta?.quarantined),
      status: caseRecord?.meta?.status || '',
      category_review_needed: Boolean(caseRecord?.meta?.category_review_needed),
    },
    preview: {
      prompt: compactText(caseRecord.prompt || caseRecord.title || ''),
      narrative: compactText(getNarrative(caseRecord)),
      options: (caseRecord.options ?? []).slice(0, 5).map((option) => compactText(option?.text ?? '', 80)),
      rationale: compactText(rationale),
    },
  };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const queue = [];
  const summary = {
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    target_bases: [...TARGET_BASES],
    counts: {
      total_candidates: 0,
    },
    by_basis: {},
    by_signal: {},
    sample: [],
  };

  for (const caseRecord of cases) {
    const basis = normalizeWhitespace(caseRecord.readability_ai_basis || caseRecord?.meta?.readability_ai_basis || '');
    if (!TARGET_BASES.has(basis)) {
      continue;
    }

    const rationale = getRationale(caseRecord);
    const signals = detectSignals(rationale);
    if (signals.length === 0) {
      continue;
    }

    queue.push(createQueueRecord(caseRecord, signals));
    summary.counts.total_candidates += 1;
    summary.by_basis[basis] = (summary.by_basis[basis] || 0) + 1;
    for (const signal of signals) {
      summary.by_signal[signal] = (summary.by_signal[signal] || 0) + 1;
    }
    if (summary.sample.length < 12) {
      summary.sample.push({
        _id: caseRecord._id,
        case_code: caseRecord.case_code ?? '',
        basis,
        signals,
        prompt: compactText(caseRecord.prompt || caseRecord.title || ''),
        rationale: compactText(rationale),
      });
    }
  }

  queue.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return String(left.case_code || '').localeCompare(String(right.case_code || ''));
  });

  summary.by_basis = Object.fromEntries(Object.entries(summary.by_basis).sort((a, b) => b[1] - a[1]));
  summary.by_signal = Object.fromEntries(Object.entries(summary.by_signal).sort((a, b) => b[1] - a[1]));

  writeJson(QUEUE_FILE, queue);
  writeJson(SUMMARY_FILE, summary);

  console.log('Editorial rough rationale queue built');
  console.log(`  Candidates: ${queue.length}`);
  console.log(`  Queue:      ${QUEUE_FILE}`);
  console.log(`  Summary:    ${SUMMARY_FILE}`);
}

main();
