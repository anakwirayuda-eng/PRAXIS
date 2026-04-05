import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const QUEUE_FILE = path.join(__dirname, 'output', 'readability_ai_adjudication_queue.json');
const DATA_FILE = path.join(ROOT, 'public', 'data', 'compiled_cases.json');
const OUTPUT_ROOT = path.join(__dirname, 'output', 'readability_ai_packs');
const ENV_FILE = path.join(ROOT, '.env');

const DEFAULT_MODEL = process.env.OPENAI_BATCH_MODEL || 'gpt-4.1-mini';
const DEFAULT_COMPLETION_WINDOW = '24h';
const PLAYBOOK_ORDER = [
  'answer_key_adjudication',
  'needs_review_adjudication',
  'ambiguity_rewrite',
];
const RESPONSE_SCHEMA_HINT = {
  _id: 'string case id',
  decision: 'PASS|HOLD',
  confidence: 'HIGH|MEDIUM|LOW',
  correct_option_id: 'option id or empty string',
  reasoning: 'short explanation',
  rewritten_prompt: 'empty string if no rewrite is needed',
  rewritten_narrative: 'empty string if unchanged',
  rewrite_notes: 'empty string if none',
};
const PLAYBOOK_PROMPTS = {
  answer_key_adjudication: {
    system:
      'You are a senior medical exam adjudication panel. Reconstruct the single best answer for a possibly broken or conflicting answer key. Return strict JSON only.',
    focus:
      'Decide whether this case can safely PASS with a single best answer, or HOLD if the source remains too ambiguous. Prefer HOLD over guessing.',
  },
  needs_review_adjudication: {
    system:
      'You are a senior medical exam reviewer. Resolve explicit review flags and determine whether this item can safely PASS as a single-best-answer question. Return strict JSON only.',
    focus:
      'Use the full case context to decide PASS or HOLD. If PASS, provide the correct option id and a short evidence-based reasoning.',
  },
  ambiguity_rewrite: {
    system:
      'You are a senior medical exam editor. Resolve ambiguous wording, logic traps, and unit collisions while preserving clinical intent. Return strict JSON only.',
    focus:
      'If the item can be salvaged, return PASS with the best answer and provide a concise rewrite for the prompt and/or narrative only when needed to remove ambiguity.',
  },
};

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseArgs(argv) {
  const options = {
    sources: [],
    packName: '',
    submitOpenai: false,
    model: DEFAULT_MODEL,
    completionWindow: DEFAULT_COMPLETION_WINDOW,
  };

  for (const arg of argv) {
    if (arg.startsWith('--sources=')) {
      options.sources = arg
        .slice('--sources='.length)
        .split(',')
        .map((part) => normalizeWhitespace(part))
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('--pack-name=')) {
      options.packName = normalizeWhitespace(arg.slice('--pack-name='.length));
      continue;
    }
    if (arg === '--submit-openai') {
      options.submitOpenai = true;
      continue;
    }
    if (arg.startsWith('--model=')) {
      options.model = normalizeWhitespace(arg.slice('--model='.length)) || DEFAULT_MODEL;
      continue;
    }
    if (arg.startsWith('--completion-window=')) {
      options.completionWindow = normalizeWhitespace(arg.slice('--completion-window='.length)) || DEFAULT_COMPLETION_WINDOW;
    }
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, records) {
  ensureDir(path.dirname(filePath));
  const payload = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(filePath, payload ? `${payload}\n` : '', 'utf8');
}

function loadEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }
  if (!fs.existsSync(ENV_FILE)) {
    return '';
  }

  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'pack';
}

function loadCaseMap() {
  const cases = readJson(DATA_FILE, []);
  const map = new Map();
  for (const caseRecord of cases) {
    if (!caseRecord || typeof caseRecord !== 'object') continue;
    map.set(String(caseRecord._id), caseRecord);
  }
  return map;
}

function getNarrative(caseRecord) {
  if (!caseRecord) return '';
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

function getPrompt(caseRecord, queueItem) {
  return normalizeWhitespace(
    caseRecord?.prompt
      || caseRecord?.title
      || queueItem?.preview?.prompt
      || '',
  );
}

function getRationale(caseRecord) {
  if (!caseRecord) return '';
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }
  if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }
  return '';
}

function getOptions(caseRecord, queueItem) {
  if (Array.isArray(caseRecord?.options) && caseRecord.options.length > 0) {
    return caseRecord.options.map((option, index) => ({
      id: String(option?.id ?? `op${String.fromCharCode(97 + index)}`),
      text: normalizeWhitespace(option?.text),
      is_correct: option?.is_correct === true,
    }));
  }
  const previewOptions = queueItem?.preview?.options ?? [];
  return previewOptions.map((text, index) => ({
    id: `op${String.fromCharCode(97 + index)}`,
    text: normalizeWhitespace(text),
    is_correct: false,
  }));
}

function buildCasePayload(queueItem, caseRecord) {
  const options = getOptions(caseRecord, queueItem);
  const meta = {
    ...(caseRecord?.meta && typeof caseRecord.meta === 'object' ? caseRecord.meta : {}),
    ...(queueItem?.meta && typeof queueItem.meta === 'object' ? queueItem.meta : {}),
  };
  return {
    _id: String(queueItem._id),
    case_code: queueItem.case_code ?? caseRecord?.case_code ?? '',
    hash_id: queueItem.hash_id ?? caseRecord?.hash_id ?? null,
    source: normalizeWhitespace(queueItem.source ?? caseRecord?.meta?.source ?? caseRecord?.source ?? ''),
    category: queueItem.category ?? caseRecord?.category ?? '',
    q_type: caseRecord?.q_type ?? '',
    playbook: queueItem.playbook,
    lane_rationale: queueItem.lane_rationale ?? '',
    reason_codes: Array.isArray(queueItem.reason_codes) ? queueItem.reason_codes : [],
    prompt: getPrompt(caseRecord, queueItem),
    narrative: getNarrative(caseRecord) || normalizeWhitespace(queueItem?.preview?.narrative),
    options,
    rationale: getRationale(caseRecord),
    current_correct_option_ids: options.filter((option) => option.is_correct).map((option) => option.id),
    meta: {
      needs_review: meta.needs_review === true,
      needs_review_reason: meta.needs_review_reason ?? null,
      needs_review_reasons: Array.isArray(meta.needs_review_reasons) ? meta.needs_review_reasons : [],
      truncated: meta.truncated === true,
      quarantined: meta.quarantined === true,
      status: meta.status ?? '',
      quarantine_reason: meta.quarantine_reason ?? '',
      clinical_consensus: meta.clinical_consensus ?? '',
      readability_ai_pass: meta.readability_ai_pass === true,
    },
  };
}

function buildUserPrompt(payload, playbook) {
  return [
    `Playbook: ${playbook}`,
    'Task: review the following medical exam item and return only the requested JSON object.',
    PLAYBOOK_PROMPTS[playbook]?.focus ?? '',
    '',
    JSON.stringify(payload, null, 2),
  ].filter(Boolean).join('\n');
}

function buildOpenAiRequest(item, payload, model) {
  return {
    custom_id: `readability_ai|${item.playbook}|${item.source}|${item._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            PLAYBOOK_PROMPTS[item.playbook]?.system ?? '',
            `Return JSON with shape: ${JSON.stringify(RESPONSE_SCHEMA_HINT)}`,
            'Use empty strings for unknown text fields. Never invent option ids that do not exist.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildUserPrompt(payload, item.playbook),
        },
      ],
    },
  };
}

function buildGeminiPrompt(item, payload) {
  return {
    custom_id: `readability_ai|${item.playbook}|${item.source}|${item._id}`,
    playbook: item.playbook,
    source: item.source,
    model: 'gemini-2.5-pro',
    response_mime_type: 'application/json',
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    system_instruction: [
      PLAYBOOK_PROMPTS[item.playbook]?.system ?? '',
      'Return strict JSON only. Do not wrap in markdown.',
      `Use this response shape: ${JSON.stringify(RESPONSE_SCHEMA_HINT)}`,
    ].join('\n'),
    user_prompt: buildUserPrompt(payload, item.playbook),
  };
}

async function uploadOpenAiBatch(jsonlPath, metadata, apiKey, completionWindow) {
  const formData = new FormData();
  formData.append('purpose', 'batch');
  formData.append(
    'file',
    new Blob([fs.readFileSync(jsonlPath)]),
    path.basename(jsonlPath),
  );

  const uploadResponse = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });
  const uploadBody = await uploadResponse.json();
  if (!uploadResponse.ok || !uploadBody?.id) {
    throw new Error(`OpenAI file upload failed for ${path.basename(jsonlPath)}: ${JSON.stringify(uploadBody)}`);
  }

  const batchResponse = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: uploadBody.id,
      endpoint: '/v1/chat/completions',
      completion_window: completionWindow,
      metadata,
    }),
  });
  const batchBody = await batchResponse.json();
  if (!batchResponse.ok || !batchBody?.id) {
    throw new Error(`OpenAI batch creation failed for ${path.basename(jsonlPath)}: ${JSON.stringify(batchBody)}`);
  }

  return {
    file_id: uploadBody.id,
    batch_id: batchBody.id,
    status: batchBody.status,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const caseMap = loadCaseMap();
  const queue = readJson(QUEUE_FILE, []);
  const sourceFilter = new Set(options.sources);
  const selected = options.sources.length > 0
    ? queue.filter((item) => sourceFilter.has(normalizeWhitespace(item.source)))
    : queue;

  const packName = options.packName || (options.sources.length > 0
    ? `${options.sources.map(slugify).join('-')}-ai-adjudication`
    : `all-${selected.length}-ai-adjudication`);
  const packDir = path.join(OUTPUT_ROOT, slugify(packName));
  const openAiDir = path.join(packDir, 'openai');
  const geminiDir = path.join(packDir, 'gemini');
  ensureDir(openAiDir);
  ensureDir(geminiDir);

  const casesByPlaybook = new Map(PLAYBOOK_ORDER.map((playbook) => [playbook, []]));
  const missingCaseIds = [];

  for (const item of selected) {
    if (!PLAYBOOK_ORDER.includes(item.playbook)) {
      continue;
    }
    const caseRecord = caseMap.get(String(item._id));
    if (!caseRecord) {
      missingCaseIds.push(String(item._id));
      continue;
    }
    const payload = buildCasePayload(item, caseRecord);
    casesByPlaybook.get(item.playbook).push({
      item,
      payload,
    });
  }

  const openAiFiles = {};
  const geminiFiles = {};
  const countsByPlaybook = {};
  const countsBySource = {};

  for (const item of selected) {
    countsBySource[item.source || 'unknown'] = (countsBySource[item.source || 'unknown'] || 0) + 1;
    countsByPlaybook[item.playbook] = (countsByPlaybook[item.playbook] || 0) + 1;
  }

  for (const playbook of PLAYBOOK_ORDER) {
    const entries = casesByPlaybook.get(playbook) ?? [];
    const openAiPath = path.join(openAiDir, `${playbook}.jsonl`);
    const geminiPath = path.join(geminiDir, `${playbook}.jsonl`);

    writeJsonl(openAiPath, entries.map(({ item, payload }) => buildOpenAiRequest(item, payload, options.model)));
    writeJsonl(geminiPath, entries.map(({ item, payload }) => buildGeminiPrompt(item, payload)));

    openAiFiles[playbook] = path.relative(ROOT, openAiPath).replace(/\\/g, '/');
    geminiFiles[playbook] = path.relative(ROOT, geminiPath).replace(/\\/g, '/');
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    pack_name: packName,
    queue_file: path.relative(ROOT, QUEUE_FILE).replace(/\\/g, '/'),
    total_items: selected.length,
    source_filter: options.sources,
    model: options.model,
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    counts: {
      by_playbook: countsByPlaybook,
      by_source: countsBySource,
    },
    files: {
      openai: openAiFiles,
      gemini: geminiFiles,
    },
    missing_case_ids: missingCaseIds,
    notes: [
      'OpenAI files are ready for /v1/batches submission.',
      'Gemini files are prompt packs with system_instruction and user_prompt payloads.',
      'Only playbooks present in readability_ai_adjudication_queue are exported.',
    ],
  };
  writeJson(path.join(packDir, 'manifest.json'), manifest);

  if (options.submitOpenai) {
    const apiKey = loadEnvValue('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not available; export completed but submission was skipped.');
    }

    const submissions = [];
    for (const playbook of PLAYBOOK_ORDER) {
      const entries = casesByPlaybook.get(playbook) ?? [];
      if (entries.length === 0) {
        continue;
      }
      const jsonlPath = path.join(openAiDir, `${playbook}.jsonl`);
      const result = await uploadOpenAiBatch(
        jsonlPath,
        {
          purpose: 'readability-ai-adjudication',
          playbook,
          pack_name: packName,
          source_filter: options.sources.join(',') || 'all',
        },
        apiKey,
        options.completionWindow,
      );
      submissions.push({
        playbook,
        item_count: entries.length,
        file: openAiFiles[playbook],
        ...result,
      });
    }
    writeJson(path.join(packDir, 'openai_submissions.json'), {
      generated_at: new Date().toISOString(),
      pack_name: packName,
      model: options.model,
      completion_window: options.completionWindow,
      submissions,
    });
  }

  console.log(`Readability AI pack exported: ${packDir}`);
  console.log(`  Total items: ${selected.length}`);
  for (const playbook of PLAYBOOK_ORDER) {
    const count = casesByPlaybook.get(playbook)?.length ?? 0;
    console.log(`  ${playbook}: ${count}`);
  }
  if (options.submitOpenai) {
    console.log(`  OpenAI submissions: ${path.join(packDir, 'openai_submissions.json')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
