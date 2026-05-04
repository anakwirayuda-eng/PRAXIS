import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOrchestrator } from './openclaw.mjs';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';
import { applyResolvedCategory } from '../src/data/categoryResolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'public', 'data', 'compiled_cases.json');
const OUTPUT_ROOT = path.join(__dirname, 'output', 'category_ai_packs');
const REPORT_FILE = path.join(__dirname, 'output', 'openclaw_category_adjudication_report.json');
const DEFAULT_MODEL = '';

const ACCEPTED_DECISIONS = new Set(['KEEP_CURRENT', 'PROMOTE_RUNNER_UP', 'MANUAL_REVIEW']);
const APPLYABLE_DECISIONS = new Set(['KEEP_CURRENT', 'PROMOTE_RUNNER_UP']);
const APPLYABLE_CONFIDENCE = new Set(['HIGH', 'MEDIUM']);

function parseArgs(argv) {
  const options = {
    packName: 'category-review-top8b-20260428-medqa',
    label: 'openclaw-category-adjudication',
    limit: null,
    batchSize: 3,
    delayMs: 750,
    backoff429Ms: 30000,
    maxDelayMs: 60000,
    maxRetries: 2,
    model: DEFAULT_MODEL,
    bucketPattern: '',
    stopAfterRateLimitFailures: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || options.packName;
      index += 1;
    } else if (arg.startsWith('--pack-name=')) {
      options.packName = arg.slice('--pack-name='.length) || options.packName;
    } else if (arg === '--label') {
      options.label = argv[index + 1] || options.label;
      index += 1;
    } else if (arg.startsWith('--label=')) {
      options.label = arg.slice('--label='.length) || options.label;
    } else if (arg === '--limit') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (arg === '--batch-size') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.batchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : options.batchSize;
      index += 1;
    } else if (arg.startsWith('--batch-size=')) {
      const parsed = Number.parseInt(arg.slice('--batch-size='.length), 10);
      options.batchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : options.batchSize;
    } else if (arg === '--delay-ms') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.delayMs;
      index += 1;
    } else if (arg.startsWith('--delay-ms=')) {
      const parsed = Number.parseInt(arg.slice('--delay-ms='.length), 10);
      options.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.delayMs;
    } else if (arg === '--backoff-429-ms') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.backoff429Ms = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.backoff429Ms;
      index += 1;
    } else if (arg.startsWith('--backoff-429-ms=')) {
      const parsed = Number.parseInt(arg.slice('--backoff-429-ms='.length), 10);
      options.backoff429Ms = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.backoff429Ms;
    } else if (arg === '--max-delay-ms') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.maxDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.maxDelayMs;
      index += 1;
    } else if (arg.startsWith('--max-delay-ms=')) {
      const parsed = Number.parseInt(arg.slice('--max-delay-ms='.length), 10);
      options.maxDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.maxDelayMs;
    } else if (arg === '--max-retries') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.maxRetries = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.maxRetries;
      index += 1;
    } else if (arg.startsWith('--max-retries=')) {
      const parsed = Number.parseInt(arg.slice('--max-retries='.length), 10);
      options.maxRetries = Number.isFinite(parsed) && parsed >= 0 ? parsed : options.maxRetries;
    } else if (arg === '--stop-after-rate-limit-failures') {
      const parsed = Number.parseInt(argv[index + 1] || '', 10);
      options.stopAfterRateLimitFailures = Number.isFinite(parsed) && parsed > 0 ? parsed : options.stopAfterRateLimitFailures;
      index += 1;
    } else if (arg.startsWith('--stop-after-rate-limit-failures=')) {
      const parsed = Number.parseInt(arg.slice('--stop-after-rate-limit-failures='.length), 10);
      options.stopAfterRateLimitFailures = Number.isFinite(parsed) && parsed > 0 ? parsed : options.stopAfterRateLimitFailures;
    } else if (arg === '--model') {
      options.model = argv[index + 1] || options.model;
      index += 1;
    } else if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length) || options.model;
    } else if (arg === '--bucket-pattern') {
      options.bucketPattern = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--bucket-pattern=')) {
      options.bucketPattern = arg.slice('--bucket-pattern='.length);
    }
  }

  return options;
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  return safeJsonParse(readFileSync(filePath, 'utf8')) ?? fallback;
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse(line))
    .filter(Boolean);
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function extractResponseText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return normalizeWhitespace(content);
  if (Array.isArray(content)) {
    return content
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function parseCustomId(customId) {
  const parts = normalizeWhitespace(customId).split('|');
  if (parts.length < 4) return null;
  return {
    bucket_id: parts[1],
    source: parts[2],
    case_id: parts[3],
  };
}

function buildTargetMaps(packName, bucketPattern) {
  const packDir = path.join(OUTPUT_ROOT, packName);
  const manifest = readJson(path.join(packDir, 'manifest.json'), {});
  const bucketRegex = bucketPattern ? new RegExp(bucketPattern) : null;
  const targetMetaById = new Map();
  const requestById = new Map();

  for (const bucket of manifest.buckets || []) {
    if (!bucket?.total_items) continue;
    if (bucketRegex && !bucketRegex.test(bucket.id)) continue;

    const shortlistPath = path.join(ROOT, bucket.files.shortlist || '');
    for (const item of readJson(shortlistPath, [])) {
      targetMetaById.set(String(item._id), {
        bucket_id: bucket.id,
        bucket_label: bucket.label,
        current_category: normalizeWhitespace(item.current_category),
        target_category: normalizeWhitespace(item.target_category),
        runner_up_category: normalizeWhitespace(item.runner_up_category),
        runner_up_score: item.runner_up_score ?? null,
      });
    }

    const requestPath = path.join(ROOT, bucket.files.openai || '');
    for (const request of readJsonl(requestPath)) {
      const parsed = parseCustomId(request.custom_id);
      if (!parsed?.case_id) continue;
      requestById.set(String(parsed.case_id), {
        custom_id: request.custom_id,
        bucket_id: parsed.bucket_id,
        source: parsed.source,
        body: request.body,
      });
    }
  }

  return {
    manifest,
    targetMetaById,
    requestById,
  };
}

function getCaseSource(caseRecord) {
  return normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source);
}

function getAllowedRecommendedCategories(result, shortlist) {
  const allowed = new Set();
  if (result.decision === 'KEEP_CURRENT') {
    allowed.add(shortlist.current_category);
  }
  if (result.decision === 'PROMOTE_RUNNER_UP') {
    allowed.add(shortlist.runner_up_category);
    allowed.add(shortlist.target_category);
  }
  return [...allowed].map(normalizeWhitespace).filter(Boolean);
}

function buildAdjudicationMeta(result, shortlist, packName, label, status, now) {
  return {
    status,
    playbook: 'category_adjudication',
    pack_name: packName,
    bucket_id: result.bucket_id,
    decision: result.decision,
    recommended_category: result.recommended_category,
    confidence: result.confidence || null,
    reasoning: result.reasoning || '',
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    current_category: shortlist.current_category || null,
    target_category: shortlist.target_category || null,
    runner_up_category: shortlist.runner_up_category || null,
    runner_up_score: shortlist.runner_up_score ?? null,
    applied_at: now,
    basis: `openclaw:${label}`,
  };
}

function mutateCase(caseRecord, result, shortlist, packName, label, now) {
  const canApplyDecision = APPLYABLE_DECISIONS.has(result.decision)
    && APPLYABLE_CONFIDENCE.has(result.confidence);
  const status = canApplyDecision ? 'applied' : 'manual_review';
  const nextMeta = {
    ...(caseRecord.meta || {}),
    category_adjudication: buildAdjudicationMeta(result, shortlist, packName, label, status, now),
  };

  if (canApplyDecision) {
    return applyResolvedCategory({
      ...caseRecord,
      meta: nextMeta,
    });
  }

  return {
    ...caseRecord,
    meta: {
      ...nextMeta,
      category_review_needed: true,
    },
  };
}

function createWorker(options, requestById, targetMetaById, report) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  return async function categoryClaw(item) {
    const caseId = String(item._id);
    const request = requestById.get(caseId);
    const shortlist = targetMetaById.get(caseId);
    if (!request || !shortlist) {
      report.skipped.push({ _id: item._id, reason: 'missing_request_or_shortlist' });
      return { success: false, error: 'missing_request_or_shortlist' };
    }

    const requestBody = {
      ...(request.body || {}),
      model: options.model || request.body?.model || 'gpt-4.1-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    let body = safeJsonParse(text);
    if (!response.ok) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') || '0', 10) || 0;
      const err = new Error(`OpenAI API HTTP Error: ${response.status}`);
      if (response.status === 429) {
        err.isRateLimit = true;
        report.rate_limit_failures += 1;
      }
      if (retryAfter) err.retryAfter = retryAfter;
      report.failed.push({ _id: item._id, bucket_id: request.bucket_id, error: text.slice(0, 300) });
      throw err;
    }
    if (!body) {
      report.skipped.push({ _id: item._id, bucket_id: request.bucket_id, reason: 'non_json_api_response' });
      return { success: false, error: 'non_json_api_response' };
    }

    const modelText = extractResponseText(body);
    const parsed = safeJsonParse(modelText);
    if (!parsed || typeof parsed !== 'object') {
      report.skipped.push({ _id: item._id, bucket_id: request.bucket_id, reason: 'invalid_model_json' });
      return { success: false, error: 'invalid_model_json' };
    }

    const result = {
      caseId,
      source: request.source,
      bucket_id: request.bucket_id,
      decision: normalizeWhitespace(parsed.decision).toUpperCase(),
      recommended_category: normalizeWhitespace(parsed.recommended_category),
      confidence: normalizeWhitespace(parsed.confidence).toUpperCase(),
      reasoning: normalizeWhitespace(parsed.reasoning),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(normalizeWhitespace).filter(Boolean) : [],
    };

    if (String(parsed._id) !== caseId || !ACCEPTED_DECISIONS.has(result.decision)) {
      report.skipped.push({ _id: item._id, bucket_id: request.bucket_id, reason: 'invalid_decision_or_id', result });
      return { success: false, error: 'invalid_decision_or_id' };
    }

    const allowed = getAllowedRecommendedCategories(result, shortlist);
    if (
      APPLYABLE_DECISIONS.has(result.decision)
      && !allowed.includes(result.recommended_category)
    ) {
      report.skipped.push({ _id: item._id, bucket_id: request.bucket_id, reason: 'recommended_category_mismatch', result, allowed });
      return { success: false, error: 'recommended_category_mismatch' };
    }

    const now = new Date().toISOString();
    const nextCase = mutateCase(item, result, shortlist, options.packName, options.label, now);
    const applied = nextCase?.meta?.category_review_needed !== true;
    report[applied ? 'applied' : 'manual_review'].push({
      _id: item._id,
      case_code: item.case_code,
      bucket_id: request.bucket_id,
      decision: result.decision,
      confidence: result.confidence,
      recommended_category: result.recommended_category,
      prior_category: item.category,
      next_category: nextCase.category,
    });

    return {
      success: true,
      data: nextCase,
    };
  };
}

function buildSelector(options, manifest, targetMetaById, requestById) {
  const source = normalizeWhitespace(manifest.source);
  let selected = 0;
  return function selector(item) {
    if (options.limit && selected >= options.limit) return false;
    if (!targetMetaById.has(String(item._id)) || !requestById.has(String(item._id))) return false;
    if (item?.meta?.category_review_needed !== true) return false;
    if (source && getCaseSource(item) !== source) return false;
    selected += 1;
    return true;
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { manifest, targetMetaById, requestById } = buildTargetMaps(options.packName, options.bucketPattern);
  if (!manifest?.pack_name) {
    throw new Error(`Missing or invalid pack manifest for ${options.packName}`);
  }

  const dataset = readJson(DATA_FILE, []);
  const repo = createCasebankRepository(openCasebankDb());
  const report = {
    generated_at: new Date().toISOString(),
    label: options.label,
    pack_name: options.packName,
    source: manifest.source || '',
    target_candidates: targetMetaById.size,
    request_candidates: requestById.size,
    limit: options.limit,
    batch_size: options.batchSize,
    delay_ms: options.delayMs,
    backoff_429_ms: options.backoff429Ms,
    max_delay_ms: options.maxDelayMs,
    max_retries: options.maxRetries,
    stop_after_rate_limit_failures: options.stopAfterRateLimitFailures,
    rate_limit_failures: 0,
    applied: [],
    manual_review: [],
    skipped: [],
    failed: [],
    save_batches: [],
  };

  try {
    const worker = createWorker(options, requestById, targetMetaById, report);
    const selector = buildSelector(options, manifest, targetMetaById, requestById);
    const saveFn = async (fullDataset, context = {}) => {
      const modifiedItems = context.modifiedItems?.length
        ? context.modifiedItems
        : fullDataset.filter((item) => targetMetaById.has(String(item._id)));
      writeJsonAtomically(DATA_FILE, fullDataset);
      if (modifiedItems.length) {
        repo.updateCaseSnapshots(modifiedItems);
        report.save_batches.push(modifiedItems.map((item) => Number(item._id)));
      }
    };

    const result = await runOrchestrator(
      options.label,
      dataset,
      selector,
      worker,
      {
        BATCH_SIZE: options.batchSize,
        DELAY_MS: options.delayMs,
        BACKOFF_429_MS: options.backoff429Ms,
        MAX_DELAY_MS: options.maxDelayMs,
        MAX_RETRIES: options.maxRetries,
        saveFn,
        shouldAbort: () => (
          options.stopAfterRateLimitFailures > 0
          && report.rate_limit_failures >= options.stopAfterRateLimitFailures
        ),
      },
    );
    report.success_count = result.successCount;
    report.fail_count = result.failCount;
  } finally {
    repo.close();
  }

  report.completed_at = new Date().toISOString();
  if (existsSync(DATA_FILE)) {
    report.data_file_bytes = statSync(DATA_FILE).size;
  }
  writeJsonAtomically(REPORT_FILE, report);

  console.log('OpenClaw category adjudication complete');
  console.log(`  Label:       ${options.label}`);
  console.log(`  Pack:        ${options.packName}`);
  console.log(`  Applied:     ${report.applied.length}`);
  console.log(`  Manual:      ${report.manual_review.length}`);
  console.log(`  Skipped:     ${report.skipped.length}`);
  console.log(`  Failed:      ${report.failed.length}`);
  console.log(`  Report:      ${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
