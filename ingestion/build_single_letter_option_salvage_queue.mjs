import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const NON_IMAGE_QUEUE_FILE = join(__dirname, 'output', 'readability_single_letter_non_image_queue.json');
const IMAGE_QUEUE_FILE = join(__dirname, 'output', 'readability_single_letter_image_queue.json');
const SUMMARY_FILE = join(__dirname, 'output', 'readability_single_letter_summary.json');

const IMAGE_DEPENDENT_RE = /\b(?:figure|figures|image|images|graph|graphs|histology|slide|slides|scan|scans|x-ray|x-rays|picture|pictures|diagram|diagrams|shown|according to (?:the )?(?:image|figure)|based on (?:the )?(?:image|figure))\b/i;
const COLLAPSED_TABLE_RE = /\bA\s+(?:Increased|Decreased|Normal)\b/i;
const TABLE_HEADER_RE = /\b(?:24-hour urine sodium|aldosterone|angiotensin ii|peripheral vascular resistance|renin)\b/i;

const SOURCE_PREFIX_MAP = new Map([
  ['MQA-', 'medqa'],
  ['MMC-', 'medmcqa'],
  ['TWM-', 'tw-medqa'],
  ['WMQ-', 'worldmedqa'],
  ['HQA-', 'headqa'],
  ['LTF-', 'litfl'],
  ['PMQ-', 'pubmedqa'],
  ['PEX-', 'medexpqa'],
  ['PLD-', 'polish-ldek-en'],
  ['GRK-', 'greek-mcqa'],
  ['AIP-', 'aipki-ugm'],
  ['UKP-', 'ukmppd-pdf'],
]);

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

function compactText(value, limit = 180) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) {
    return text;
  }
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

function inferSource(caseRecord) {
  const explicit = normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || '');
  if (explicit) return explicit;

  const caseCode = normalizeWhitespace(caseRecord?.case_code || '');
  for (const [prefix, source] of SOURCE_PREFIX_MAP.entries()) {
    if (caseCode.startsWith(prefix)) {
      return source;
    }
  }

  const hashId = normalizeWhitespace(caseRecord?.hash_id || '').toLowerCase();
  if (hashId.startsWith('medqa_')) return 'medqa';
  if (hashId.startsWith('medmcqa_')) return 'medmcqa';
  if (hashId.startsWith('worldmedqa_')) return 'worldmedqa';
  if (hashId.startsWith('headqa_')) return 'headqa';
  return '';
}

function createQueueRecord(caseRecord, options) {
  const narrative = getNarrative(caseRecord);
  const prompt = normalizeWhitespace(caseRecord.prompt || caseRecord.title || narrative);
  const source = inferSource(caseRecord);
  const queueRecord = {
    _id: caseRecord._id,
    case_code: caseRecord.case_code ?? '',
    hash_id: caseRecord.hash_id ?? null,
    source,
    category: caseRecord.category ?? '',
    priority: options.priority,
    lane: 'ai_adjudication',
    playbook: 'clinical_rewrite',
    lane_rationale: options.laneRationale,
    next_lane_if_unresolved: 'human_shortlist',
    reason_codes: options.reasonCodes,
    reasons: options.reasonCodes.map((reasonCode, index) => ({
      code: reasonCode,
      label: index === 0
        ? 'Options collapsed to letter placeholders'
        : 'Visible table/list payload collapsed into stem',
      origin: 'build_single_letter_option_salvage_queue',
      evidence: options.evidence,
      action: 'Rewrite the stem and options into a clean self-contained single-best-answer item.',
    })),
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
      prompt: compactText(prompt),
      narrative: compactText(narrative),
      options: (caseRecord.options ?? []).slice(0, 5).map((option) => compactText(option?.text ?? '', 80)),
    },
  };
  return queueRecord;
}

function sortQueue(records) {
  return [...records].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return String(left.case_code || '').localeCompare(String(right.case_code || ''));
  });
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const nonImageQueue = [];
  const imageQueue = [];
  const summary = {
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    notes: [
      'This bucket targets cases whose answer choices collapsed into single-letter placeholders in the published UI.',
      'Non-image items are routed to an immediate clinical_rewrite queue; image-linked items are deferred into a separate queue.',
      'Collapsed table/list payloads are prioritized above generic single-letter placeholder items.',
    ],
    counts: {
      total_candidates: 0,
      non_image_queue: 0,
      image_queue: 0,
      collapsed_table_candidates: 0,
    },
    by_source: {},
    samples: {
      non_image: [],
      image: [],
    },
  };

  for (const caseRecord of cases) {
    const options = Array.isArray(caseRecord.options)
      ? caseRecord.options.map((option) => normalizeWhitespace(option?.text))
      : [];
    const allSingleLetter = options.length >= 3 && options.every((value) => /^[A-E]$/.test(value));
    if (!allSingleLetter) {
      continue;
    }

    const prompt = normalizeWhitespace(caseRecord.prompt || caseRecord.title || '');
    const narrative = getNarrative(caseRecord);
    if (narrative.length < 140) {
      continue;
    }

    const combinedText = `${prompt}\n${narrative}`;
    const imageDependent = IMAGE_DEPENDENT_RE.test(combinedText);
    const collapsedTable = COLLAPSED_TABLE_RE.test(narrative) && TABLE_HEADER_RE.test(narrative);
    const source = inferSource(caseRecord) || 'unknown';
    const evidence = collapsedTable
      ? 'Narrative contains collapsed table headers and answer rows while options are single letters only.'
      : 'Narrative/stem still contains substantive content, but options in the published record are single-letter placeholders only.';

    const record = createQueueRecord(caseRecord, {
      priority: collapsedTable ? 260 : 220,
      laneRationale: collapsedTable
        ? 'Stem payload contains a collapsed table/list and option texts degraded to placeholders; the item needs clinician rewrite rather than UI-only handling.'
        : 'Option texts collapsed to single-letter placeholders; the item needs clinician rewrite to restore answer choices.',
      reasonCodes: collapsedTable
        ? ['single_letter_option_payload', 'collapsed_option_table']
        : ['single_letter_option_payload'],
      evidence,
    });

    summary.counts.total_candidates += 1;
    summary.by_source[source] = (summary.by_source[source] || 0) + 1;
    if (collapsedTable) {
      summary.counts.collapsed_table_candidates += 1;
    }

    if (imageDependent) {
      imageQueue.push(record);
      if (summary.samples.image.length < 10) {
        summary.samples.image.push({
          _id: caseRecord._id,
          case_code: caseRecord.case_code ?? '',
          source,
          prompt: compactText(prompt),
          narrative: compactText(narrative, 220),
        });
      }
    } else {
      nonImageQueue.push(record);
      if (summary.samples.non_image.length < 10) {
        summary.samples.non_image.push({
          _id: caseRecord._id,
          case_code: caseRecord.case_code ?? '',
          source,
          collapsed_table: collapsedTable,
          prompt: compactText(prompt),
          narrative: compactText(narrative, 220),
        });
      }
    }
  }

  const sortedNonImage = sortQueue(nonImageQueue);
  const sortedImage = sortQueue(imageQueue);

  summary.counts.non_image_queue = sortedNonImage.length;
  summary.counts.image_queue = sortedImage.length;
  summary.by_source = Object.fromEntries(
    Object.entries(summary.by_source).sort((left, right) => right[1] - left[1]),
  );

  writeJson(NON_IMAGE_QUEUE_FILE, sortedNonImage);
  writeJson(IMAGE_QUEUE_FILE, sortedImage);
  writeJson(SUMMARY_FILE, summary);

  console.log('Single-letter option salvage queues built');
  console.log(`  Non-image queue: ${sortedNonImage.length}`);
  console.log(`  Image queue:     ${sortedImage.length}`);
  console.log(`  Summary:         ${SUMMARY_FILE}`);
}

main();
