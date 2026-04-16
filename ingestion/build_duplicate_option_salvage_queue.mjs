import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_duplicate_option_queue.json');
const SUMMARY_FILE = join(__dirname, 'output', 'readability_duplicate_option_summary.json');

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

function createQueueRecord(caseRecord, duplicateGroups) {
  const evidence = duplicateGroups
    .map((group) => group.map((option) => `${option.id}:${normalizeWhitespace(option.text)}`).join(' = '))
    .join(' | ');

  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code ?? '',
    hash_id: caseRecord.hash_id ?? null,
    source: normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || ''),
    category: caseRecord.category ?? '',
    priority: 240 + Math.min(duplicateGroups.length * 10, 30),
    lane: 'ai_adjudication',
    playbook: 'clinical_rewrite',
    lane_rationale: 'Published options still contain duplicate visible text; rewrite option wording to keep a single best answer without repeated distractors.',
    next_lane_if_unresolved: 'human_shortlist',
    reason_codes: ['duplicate_options'],
    reasons: [
      {
        code: 'duplicate_options',
        label: 'Duplicate option text in published case',
        origin: 'build_duplicate_option_salvage_queue',
        evidence,
        action: 'Rewrite the option texts using the existing option ids so each choice is distinct and learner-facing.',
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
    },
  };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const queue = [];
  const summary = {
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    counts: {
      total_candidates: 0,
    },
    by_source: {},
    sample: [],
  };

  for (const caseRecord of cases) {
    if (!Array.isArray(caseRecord.options) || caseRecord.options.length === 0) {
      continue;
    }

    const seen = new Map();
    for (const option of caseRecord.options) {
      const text = normalizeWhitespace(option?.text);
      if (!text) continue;
      const key = text.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, []);
      }
      seen.get(key).push({
        id: normalizeWhitespace(option?.id),
        text,
        is_correct: option?.is_correct === true,
      });
    }

    const duplicateGroups = [...seen.values()].filter((group) => group.length > 1);
    if (duplicateGroups.length === 0) {
      continue;
    }

    queue.push(createQueueRecord(caseRecord, duplicateGroups));
    const source = normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || 'unknown');
    summary.counts.total_candidates += 1;
    summary.by_source[source] = (summary.by_source[source] || 0) + 1;
    if (summary.sample.length < 12) {
      summary.sample.push({
        _id: caseRecord._id,
        case_code: caseRecord.case_code ?? '',
        source,
        prompt: compactText(caseRecord.prompt || caseRecord.title || ''),
        duplicate_groups: duplicateGroups,
      });
    }
  }

  queue.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return String(left.case_code || '').localeCompare(String(right.case_code || ''));
  });
  summary.by_source = Object.fromEntries(Object.entries(summary.by_source).sort((a, b) => b[1] - a[1]));

  writeJson(QUEUE_FILE, queue);
  writeJson(SUMMARY_FILE, summary);

  console.log('Duplicate option salvage queue built');
  console.log(`  Candidates: ${queue.length}`);
  console.log(`  Queue:      ${QUEUE_FILE}`);
  console.log(`  Summary:    ${SUMMARY_FILE}`);
}

main();
