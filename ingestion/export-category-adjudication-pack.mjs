import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, 'server', 'data', 'casebank.db');
const OUTPUT_ROOT = path.join(ROOT, 'ingestion', 'output', 'category_ai_packs');
const DEFAULT_PACK_NAME = 'medmcqa-category-adjudication-wave1';
const DEFAULT_MODEL = 'gpt-4.1-mini';

const RESPONSE_SCHEMA_HINT = {
  _id: 'numeric case id copied from payload',
  decision: 'PROMOTE_RUNNER_UP | KEEP_CURRENT | MANUAL_REVIEW',
  recommended_category: 'must be one of current_category or runner_up_category',
  confidence: 'HIGH | MEDIUM | LOW',
  reasoning: 'brief explanation grounded in stem semantics and metadata quality',
  evidence: ['flat list of short supporting points'],
};

const CATEGORY_ADJUDICATION_SYSTEM = [
  'You are adjudicating noisy medical exam category labels.',
  'Prefer semantic meaning of the stem over stale source labels.',
  'Do not invent a new category.',
  'Only use current_category or runner_up_category as recommended_category.',
  'Choose PROMOTE_RUNNER_UP only when the stem clearly belongs to runner_up_category.',
  'Choose KEEP_CURRENT when current_category is still more defensible.',
  'Choose MANUAL_REVIEW when evidence remains mixed.',
  `Return strict JSON only using this shape: ${JSON.stringify(RESPONSE_SCHEMA_HINT)}`,
].join('\n');

const BUCKETS = [
  {
    id: 'anatomy-core-vs-surgery-ipd-runner3',
    label: 'Core anatomy vs surgery from stale IPD raw labels',
    rationale: 'Core anatomy stems with only a plain anatomy tag where raw IPD barely beats a Bedah runner-up by one point.',
    focus: 'Decide whether this stem is still a broad internal-medicine item or should be promoted to surgery/bedah because the content is really orthopaedic or surgical anatomy.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && Number(res.runner_up_score) <= 3
        && normalize(caseRecord.subject) === 'anatomy'
        && Array.isArray(meta.tags)
        && meta.tags.length === 1
        && hasTag(meta.tags, 'anatomy');
    },
  },
  {
    id: 'physiology-core-vs-surgery-ipd-runner3',
    label: 'Core physiology vs surgery from stale IPD raw labels',
    rationale: 'Plain physiology stems that currently sit in review against a Bedah runner-up.',
    focus: 'Decide whether the stem should remain in the current category or move to Bedah because the content is really surgical/clinical rather than physiology.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && Number(res.runner_up_score) <= 3
        && normalize(caseRecord.subject) === 'physiology'
        && Array.isArray(meta.tags)
        && meta.tags.length === 1
        && hasTag(meta.tags, 'physiology');
    },
  },
  {
    id: 'general-anatomy-vs-anatomi-ipd-runner6',
    label: 'General anatomy stems held in IPD',
    rationale: 'Anatomy/general-anatomy stems where a broad IPD raw label still suppresses the Anatomi runner-up.',
    focus: 'Decide whether this is truly an anatomy/basic-science item that should move to Anatomi, or whether current_category should be preserved.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Anatomi'
        && Number(res.runner_up_score) <= 6
        && normalize(caseRecord.subject) === 'anatomy'
        && hasTag(meta.tags, 'anatomy')
        && hasTag(meta.tags, 'general anatomy');
    },
  },
];

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hasTag(tags, expected) {
  if (!Array.isArray(tags)) return false;
  const normalizedExpected = normalize(expected);
  return tags.some((tag) => normalize(tag) === normalizedExpected);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  const payload = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, payload ? `${payload}\n` : '', 'utf8');
}

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK_NAME,
    model: DEFAULT_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || options.packName;
      index += 1;
    } else if (arg === '--model') {
      options.model = argv[index + 1] || options.model;
      index += 1;
    }
  }

  return options;
}

function hydrateCases(db) {
  const caseRows = db.prepare(`
    SELECT
      case_id,
      case_code,
      hash_id,
      q_type,
      category,
      title,
      prompt,
      source,
      subject,
      topic,
      vignette_json,
      rationale_json,
      meta_json
    FROM cases
    WHERE source = 'medmcqa'
    ORDER BY case_id
  `).all();

  const optionRows = db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    WHERE case_id IN (SELECT case_id FROM cases WHERE source = 'medmcqa')
    ORDER BY case_id, sort_order
  `).all();

  const optionsByCaseId = new Map();
  for (const row of optionRows) {
    const list = optionsByCaseId.get(row.case_id) || [];
    list.push({
      id: row.option_id,
      text: row.option_text,
      is_correct: Boolean(row.is_correct),
    });
    optionsByCaseId.set(row.case_id, list);
  }

  return caseRows.map((row) => ({
    _id: row.case_id,
    case_code: row.case_code ?? '',
    hash_id: row.hash_id ?? null,
    q_type: row.q_type ?? '',
    category: row.category ?? '',
    title: row.title ?? '',
    prompt: row.prompt ?? '',
    source: row.source ?? '',
    subject: row.subject ?? '',
    topic: row.topic ?? '',
    vignette: JSON.parse(row.vignette_json || '{}'),
    rationale: JSON.parse(row.rationale_json || '{}'),
    meta: JSON.parse(row.meta_json || '{}'),
    options: optionsByCaseId.get(row.case_id) || [],
  }));
}

function getNarrative(caseRecord) {
  const vignette = caseRecord?.vignette;
  if (!vignette) return '';
  if (typeof vignette === 'string') return vignette;
  return vignette.narrative || '';
}

function buildPayload(caseRecord, bucket) {
  const meta = caseRecord.meta || {};
  const resolution = meta.category_resolution || {};
  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code,
    source: caseRecord.source,
    bucket_id: bucket.id,
    bucket_label: bucket.label,
    bucket_rationale: bucket.rationale,
    current_category: caseRecord.category,
    raw_category: resolution.raw_category || null,
    raw_normalized_category: resolution.raw_normalized_category || null,
    current_resolved_category: resolution.resolved_category || null,
    runner_up_category: resolution.runner_up_category || null,
    runner_up_score: Number.isFinite(resolution.runner_up_score) ? resolution.runner_up_score : null,
    confidence: resolution.confidence || null,
    winning_signals: Array.isArray(resolution.winning_signals) ? resolution.winning_signals : [],
    subject: caseRecord.subject || meta.subject || '',
    topic: caseRecord.topic || meta.topic || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    organ_system: meta.organ_system || '',
    topic_keywords: Array.isArray(meta.topic_keywords) ? meta.topic_keywords : [],
    title: caseRecord.title || '',
    prompt: caseRecord.prompt || '',
    narrative: getNarrative(caseRecord),
    options: (caseRecord.options || []).map((option) => ({
      id: option.id,
      text: option.text,
    })),
  };
}

function buildUserPrompt(payload, bucket) {
  return [
    `Playbook: category_adjudication`,
    `Bucket: ${bucket.id}`,
    `Focus: ${bucket.focus}`,
    'Task: decide whether the item should keep the current category, promote to the runner-up category, or stay manual-review only.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function buildOpenAiRequest(caseRecord, payload, bucket, model) {
  return {
    custom_id: `category_ai|${bucket.id}|${caseRecord.source}|${caseRecord._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: CATEGORY_ADJUDICATION_SYSTEM,
        },
        {
          role: 'user',
          content: buildUserPrompt(payload, bucket),
        },
      ],
    },
  };
}

function buildGeminiRequest(caseRecord, payload, bucket) {
  return {
    custom_id: `category_ai|${bucket.id}|${caseRecord.source}|${caseRecord._id}`,
    playbook: 'category_adjudication',
    bucket_id: bucket.id,
    source: caseRecord.source,
    model: 'gemini-2.5-pro',
    response_mime_type: 'application/json',
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    system_instruction: CATEGORY_ADJUDICATION_SYSTEM,
    user_prompt: buildUserPrompt(payload, bucket),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new Database(DB_PATH, { readonly: true });
  const cases = hydrateCases(db);
  db.close();

  const packDir = path.join(OUTPUT_ROOT, slugify(options.packName));
  fs.rmSync(packDir, { recursive: true, force: true });
  const shortlistDir = path.join(packDir, 'shortlists');
  const openAiDir = path.join(packDir, 'openai');
  const geminiDir = path.join(packDir, 'gemini');
  ensureDir(shortlistDir);
  ensureDir(openAiDir);
  ensureDir(geminiDir);

  const manifestBuckets = [];

  for (const bucket of BUCKETS) {
    const selected = cases.filter((caseRecord) => bucket.match(caseRecord));
    const shortlist = selected.map((caseRecord) => {
      const meta = caseRecord.meta || {};
      const resolution = meta.category_resolution || {};
      return {
        _id: caseRecord._id,
        case_code: caseRecord.case_code,
        current_category: caseRecord.category,
        runner_up_category: resolution.runner_up_category || null,
        runner_up_score: resolution.runner_up_score ?? null,
        subject: caseRecord.subject || meta.subject || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        organ_system: meta.organ_system || '',
        title: caseRecord.title || '',
        prompt: caseRecord.prompt || '',
      };
    });

    const openAiRows = selected.map((caseRecord) => {
      const payload = buildPayload(caseRecord, bucket);
      return buildOpenAiRequest(caseRecord, payload, bucket, options.model);
    });
    const geminiRows = selected.map((caseRecord) => {
      const payload = buildPayload(caseRecord, bucket);
      return buildGeminiRequest(caseRecord, payload, bucket);
    });

    const shortlistPath = path.join(shortlistDir, `${bucket.id}.json`);
    const openAiPath = path.join(openAiDir, `${bucket.id}.jsonl`);
    const geminiPath = path.join(geminiDir, `${bucket.id}.jsonl`);
    writeJson(shortlistPath, shortlist);
    writeJsonl(openAiPath, openAiRows);
    writeJsonl(geminiPath, geminiRows);

    manifestBuckets.push({
      id: bucket.id,
      label: bucket.label,
      rationale: bucket.rationale,
      focus: bucket.focus,
      total_items: selected.length,
      files: {
        shortlist: path.relative(ROOT, shortlistPath).replace(/\\/g, '/'),
        openai: path.relative(ROOT, openAiPath).replace(/\\/g, '/'),
        gemini: path.relative(ROOT, geminiPath).replace(/\\/g, '/'),
      },
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    pack_name: options.packName,
    db_path: path.relative(ROOT, DB_PATH).replace(/\\/g, '/'),
    source: 'medmcqa',
    playbook: 'category_adjudication',
    model: options.model,
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    buckets: manifestBuckets,
    notes: [
      'OpenAI files are ready for /v1/batches submission.',
      'Gemini files are prompt packs with system_instruction and user_prompt payloads.',
      'recommended_category must stay within current_category or runner_up_category only.',
    ],
  };

  const manifestPath = path.join(packDir, 'manifest.json');
  writeJson(manifestPath, manifest);

  console.log('Category adjudication pack export complete');
  console.log(`Pack:     ${packDir}`);
  console.log(`Manifest: ${manifestPath}`);
  for (const bucket of manifestBuckets) {
    console.log(`  ${bucket.id}: ${bucket.total_items}`);
  }
}

main();
