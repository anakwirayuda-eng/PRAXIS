import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';
import { applyResolvedCategory } from '../src/data/categoryResolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const OUTPUT_ROOT = join(__dirname, 'output', 'category_ai_packs');
const APPLY_LOCK_DIR = join(__dirname, 'output', '.casebank-apply.lock');
const APPLY_LOCK_INFO_FILE = join(APPLY_LOCK_DIR, 'owner.json');
const APPLY_LOCK_WAIT_MS = 250;
const APPLY_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PACK_NAME = 'medmcqa-category-adjudication-wave1';
const APPLYABLE_DECISIONS = new Set(['KEEP_CURRENT', 'PROMOTE_RUNNER_UP']);
const ACCEPTED_DECISIONS = new Set(['KEEP_CURRENT', 'PROMOTE_RUNNER_UP', 'MANUAL_REVIEW']);
const APPLYABLE_CONFIDENCE = new Set(['HIGH', 'MEDIUM']);

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK_NAME,
  };

  for (const arg of argv) {
    if (arg.startsWith('--pack-name=')) {
      options.packName = String(arg.slice('--pack-name='.length) || '').trim() || DEFAULT_PACK_NAME;
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

function stripCodeFence(text) {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractFirstJsonObject(text) {
  const stripped = stripCodeFence(text);
  const direct = safeJsonParse(stripped);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct;
  }

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return safeJsonParse(stripped.slice(start, end + 1));
}

function extractResponseText(entry) {
  const chatContent = entry?.response?.body?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') {
    return normalizeWhitespace(chatContent);
  }

  if (Array.isArray(chatContent)) {
    const combined = chatContent
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (combined) {
      return combined;
    }
  }

  const outputText = entry?.response?.body?.output_text;
  if (typeof outputText === 'string') {
    return normalizeWhitespace(outputText);
  }

  const output = entry?.response?.body?.output;
  if (Array.isArray(output)) {
    const combined = output
      .flatMap((item) => item?.content ?? [])
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (combined) {
      return combined;
    }
  }

  return '';
}

function decodeMaybeDigitDump(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) {
    return '';
  }

  if (!/^[0-9\s]+$/.test(trimmed)) {
    return String(rawText ?? '');
  }

  const numbers = trimmed.split(/\s+/).filter(Boolean);
  const bytes = Buffer.from(numbers.map((value) => Number(value)));
  return bytes.toString('utf8');
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const payload = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    try {
      rmSync(tempFile, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockOwner() {
  if (!existsSync(APPLY_LOCK_INFO_FILE)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(APPLY_LOCK_INFO_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function acquireApplyLock(label) {
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(APPLY_LOCK_DIR);
      writeFileSync(APPLY_LOCK_INFO_FILE, JSON.stringify({
        pid: process.pid,
        label,
        acquired_at: new Date().toISOString(),
      }, null, 2));
      return;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }

      let stale = false;
      try {
        stale = Date.now() - statSync(APPLY_LOCK_DIR).mtimeMs > APPLY_LOCK_TIMEOUT_MS;
      } catch {
        stale = false;
      }

      if (stale) {
        const owner = readLockOwner();
        console.warn(`Stale apply lock detected, removing (${owner?.label || 'unknown-owner'})`);
        rmSync(APPLY_LOCK_DIR, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt > APPLY_LOCK_TIMEOUT_MS) {
        const owner = readLockOwner();
        throw new Error(`Timed out waiting for casebank apply lock (${owner?.label || 'unknown-owner'})`);
      }

      sleepSync(APPLY_LOCK_WAIT_MS);
    }
  }
}

function releaseApplyLock() {
  rmSync(APPLY_LOCK_DIR, { recursive: true, force: true });
}

function getCaseSource(caseRecord) {
  return normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source);
}

function countReviewQueue(cases, sourceFilter) {
  return cases.filter((caseRecord) => (
    getCaseSource(caseRecord) === sourceFilter
    && caseRecord?.meta?.category_review_needed === true
  )).length;
}

function summarizeReviewQueue(cases, sourceFilter) {
  const counts = {};
  for (const caseRecord of cases) {
    if (getCaseSource(caseRecord) !== sourceFilter || caseRecord?.meta?.category_review_needed !== true) {
      continue;
    }
    const category = normalizeWhitespace(caseRecord.category) || '<missing>';
    counts[category] = (counts[category] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}

function buildShortlistIndex(manifest) {
  const byCaseId = new Map();

  for (const bucket of manifest.buckets || []) {
    const shortlistPath = join(ROOT, bucket?.files?.shortlist || '');
    if (!existsSync(shortlistPath)) {
      continue;
    }

    const shortlist = safeJsonParse(readFileSync(shortlistPath, 'utf8')) || [];
    for (const item of shortlist) {
      byCaseId.set(String(item._id), {
        bucket_id: bucket.id,
        bucket_label: bucket.label,
        current_category: normalizeWhitespace(item.current_category),
        target_category: normalizeWhitespace(item.target_category),
        runner_up_category: normalizeWhitespace(item.runner_up_category),
        runner_up_score: item.runner_up_score ?? null,
      });
    }

    const openAiPath = join(ROOT, bucket?.files?.openai || '');
    if (!existsSync(openAiPath)) {
      continue;
    }

    const lines = readFileSync(openAiPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const entry = safeJsonParse(line);
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const userMessage = Array.isArray(entry?.body?.messages)
        ? entry.body.messages.find((message) => message?.role === 'user')
        : null;
      const promptText = typeof userMessage?.content === 'string'
        ? userMessage.content
        : Array.isArray(userMessage?.content)
          ? userMessage.content.map((part) => normalizeWhitespace(part?.text ?? part?.content ?? '')).filter(Boolean).join('\n')
          : '';
      const payload = extractFirstJsonObject(promptText);
      const caseId = normalizeWhitespace(payload?._id);
      if (!caseId) {
        continue;
      }

      const existing = byCaseId.get(caseId) || {
        bucket_id: bucket.id,
        bucket_label: bucket.label,
        current_category: normalizeWhitespace(payload?.current_category),
        runner_up_category: normalizeWhitespace(payload?.runner_up_category),
        runner_up_score: payload?.runner_up_score ?? null,
      };
      const targetCategory = normalizeWhitespace(
        payload?.target_category
          || payload?.current_resolved_category,
      );

      byCaseId.set(caseId, {
        ...existing,
        current_category: existing.current_category || normalizeWhitespace(payload?.current_category),
        target_category: existing.target_category || targetCategory,
        runner_up_category: existing.runner_up_category || normalizeWhitespace(payload?.runner_up_category),
        runner_up_score: existing.runner_up_score ?? payload?.runner_up_score ?? null,
      });
    }
  }

  return byCaseId;
}

function getResultFiles(manifest, resultsDir) {
  const files = [];
  for (const bucket of manifest.buckets || []) {
    const fileName = String(bucket?.files?.openai || '').split(/[\\/]/).pop();
    if (!fileName) {
      continue;
    }
    files.push({
      bucket_id: bucket.id,
      fileName,
      filePath: join(resultsDir, fileName),
    });
  }
  return files;
}

function normalizeResultEntry(entry, bucketId) {
  const customId = normalizeWhitespace(entry?.custom_id);
  const parts = customId.split('|');
  if (parts.length < 4) {
    return null;
  }

  const [playbook, bucketFromId, source, customCaseId] = parts;
  if (playbook !== 'category_ai') {
    return null;
  }

  const payload = extractFirstJsonObject(extractResponseText(entry));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const caseId = normalizeWhitespace(payload._id || customCaseId);
  const decision = normalizeWhitespace(payload.decision).toUpperCase();
  const confidence = normalizeWhitespace(payload.confidence).toUpperCase();
  const recommendedCategory = normalizeWhitespace(payload.recommended_category);
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.map((item) => normalizeWhitespace(item)).filter(Boolean)
    : [];

  if (!caseId || !ACCEPTED_DECISIONS.has(decision) || !recommendedCategory) {
    return null;
  }

  return {
    caseId,
    source: normalizeWhitespace(source),
    bucket_id: normalizeWhitespace(bucketFromId || bucketId),
    decision,
    confidence,
    recommended_category: recommendedCategory,
    reasoning: normalizeWhitespace(payload.reasoning),
    evidence,
  };
}

function loadResults(manifest, packDir, stats) {
  const resultsDir = join(packDir, 'results');
  if (!existsSync(resultsDir)) {
    throw new Error(`Missing results directory: ${resultsDir}`);
  }

  const normalizedResultsDir = join(packDir, 'results_normalized');
  mkdirSync(normalizedResultsDir, { recursive: true });
  const results = [];

  for (const file of getResultFiles(manifest, resultsDir)) {
    if (!existsSync(file.filePath)) {
      stats.files_missing.push(file.fileName);
      continue;
    }

    const raw = readFileSync(file.filePath, 'utf8');
    const decoded = decodeMaybeDigitDump(raw);
    writeFileSync(join(normalizedResultsDir, file.fileName), decoded, 'utf8');
    stats.files_scanned += 1;

    const lines = decoded
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    stats.lines_scanned += lines.length;
    for (const line of lines) {
      const entry = safeJsonParse(line);
      if (!entry) {
        stats.parse_errors += 1;
        continue;
      }

      const normalized = normalizeResultEntry(entry, file.bucket_id);
      if (!normalized) {
        stats.skipped_invalid_payload += 1;
        continue;
      }
      results.push(normalized);
    }
  }

  return results;
}

function buildAdjudicationMeta(result, shortlist, packName, status, now) {
  return {
    status,
    playbook: 'category_adjudication',
    pack_name: packName,
    bucket_id: result.bucket_id,
    decision: result.decision,
    recommended_category: result.recommended_category,
    confidence: result.confidence || null,
    reasoning: result.reasoning || '',
    evidence: result.evidence || [],
    current_category: shortlist.current_category || null,
    target_category: shortlist.target_category || null,
    runner_up_category: shortlist.runner_up_category || null,
    runner_up_score: shortlist.runner_up_score ?? null,
    applied_at: now,
  };
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

  return [...allowed].filter(Boolean);
}

function mutateCase(caseRecord, result, shortlist, packName, now) {
  const nextMeta = {
    ...(caseRecord.meta || {}),
    category_adjudication: buildAdjudicationMeta(
      result,
      shortlist,
      packName,
      'manual_review',
      now,
    ),
  };

  if (
    APPLYABLE_DECISIONS.has(result.decision)
    && APPLYABLE_CONFIDENCE.has(result.confidence)
  ) {
    nextMeta.category_adjudication = buildAdjudicationMeta(
      result,
      shortlist,
      packName,
      'applied',
      now,
    );
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = join(OUTPUT_ROOT, options.packName);
  const manifestFile = join(packDir, 'manifest.json');
  const reportFile = join(packDir, 'apply_report.json');
  const residualFile = join(packDir, 'residual_manual_review.json');

  if (!existsSync(manifestFile)) {
    throw new Error(`Missing manifest: ${manifestFile}`);
  }

  const manifest = safeJsonParse(readFileSync(manifestFile, 'utf8')) || {};
  const sourceFilter = normalizeWhitespace(manifest.source);
  const now = new Date().toISOString();

  const stats = {
    generated_at: now,
    pack_name: manifest.pack_name || options.packName,
    source: sourceFilter,
    files_scanned: 0,
    lines_scanned: 0,
    parse_errors: 0,
    skipped_invalid_payload: 0,
    files_missing: [],
    results_loaded: 0,
    applied_count: 0,
    keep_current_applied: 0,
    runner_up_promoted: 0,
    manual_review_marked: 0,
    invalid_recommendation: 0,
    missing_cases: 0,
    missing_shortlist_entries: 0,
    source_mismatches: 0,
    modified_json_cases: 0,
    modified_db_cases: 0,
    unchanged_results: 0,
    review_queue_before: 0,
    review_queue_after: 0,
    by_bucket: {},
    by_decision_confidence: {},
    unresolved_sample: [],
  };

  const shortlistByCaseId = buildShortlistIndex(manifest);
  acquireApplyLock(`category:${options.packName}`);
  try {
    const results = loadResults(manifest, packDir, stats);
    stats.results_loaded = results.length;

    const jsonCases = safeJsonParse(readFileSync(DATA_FILE, 'utf8')) || [];
    const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));
    stats.review_queue_before = countReviewQueue(jsonCases, sourceFilter);

    const repo = createCasebankRepository(openCasebankDb());
    const dbCases = repo.getAllCases();
    const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

    const modifiedDbIds = new Set();
    const modifiedJsonIds = new Set();
    const residualManual = [];

    try {
      for (const result of results) {
        const bucketKey = result.bucket_id || 'unknown';
        const decisionKey = `${result.decision}|${result.confidence || 'UNKNOWN'}`;
        stats.by_bucket[bucketKey] = (stats.by_bucket[bucketKey] || 0) + 1;
        stats.by_decision_confidence[decisionKey] = (stats.by_decision_confidence[decisionKey] || 0) + 1;

        const shortlist = shortlistByCaseId.get(result.caseId);
        if (!shortlist) {
          stats.missing_shortlist_entries += 1;
          stats.unresolved_sample.push({
            _id: result.caseId,
            reason: 'shortlist_missing',
            bucket_id: result.bucket_id,
          });
          continue;
        }

        const allowedCategories = getAllowedRecommendedCategories(result, shortlist);
        const canApplyDecision = APPLYABLE_DECISIONS.has(result.decision)
          && APPLYABLE_CONFIDENCE.has(result.confidence)
          && allowedCategories.includes(result.recommended_category);

        if (
          APPLYABLE_DECISIONS.has(result.decision)
          && !allowedCategories.includes(result.recommended_category)
        ) {
          stats.invalid_recommendation += 1;
          residualManual.push({
            _id: result.caseId,
            bucket_id: result.bucket_id,
            source: result.source,
            reason: 'recommended_category_mismatch',
            decision: result.decision,
            confidence: result.confidence,
            recommended_category: result.recommended_category,
            current_category: shortlist.current_category,
            target_category: shortlist.target_category,
            runner_up_category: shortlist.runner_up_category,
            allowed_categories: allowedCategories,
          });
          continue;
        }

        const jsonCase = jsonCaseMap.get(result.caseId);
        const dbCase = dbCaseMap.get(result.caseId);
        if (!jsonCase || !dbCase) {
          stats.missing_cases += 1;
          stats.unresolved_sample.push({
            _id: result.caseId,
            reason: 'case_missing_in_one_backend',
            bucket_id: result.bucket_id,
          });
          continue;
        }

        const jsonSource = getCaseSource(jsonCase);
        const dbSource = getCaseSource(dbCase);
        if ((jsonSource && jsonSource !== result.source) || (dbSource && dbSource !== result.source)) {
          stats.source_mismatches += 1;
          stats.unresolved_sample.push({
            _id: result.caseId,
            reason: 'source_mismatch',
            json_source: jsonSource,
            db_source: dbSource,
            source: result.source,
          });
          continue;
        }

        const nextJsonCase = mutateCase(jsonCase, result, shortlist, options.packName, now);
        const nextDbCase = mutateCase(dbCase, result, shortlist, options.packName, now);
        const jsonChanged = stableStringify(jsonCase) !== stableStringify(nextJsonCase);
        const dbChanged = stableStringify(dbCase) !== stableStringify(nextDbCase);

        if (jsonChanged) {
          jsonCaseMap.set(result.caseId, nextJsonCase);
          const index = jsonCases.findIndex((caseRecord) => String(caseRecord._id) === result.caseId);
          if (index >= 0) {
            jsonCases[index] = nextJsonCase;
          }
          modifiedJsonIds.add(result.caseId);
        }

        if (dbChanged) {
          dbCaseMap.set(result.caseId, nextDbCase);
          const index = dbCases.findIndex((caseRecord) => String(caseRecord._id) === result.caseId);
          if (index >= 0) {
            dbCases[index] = nextDbCase;
          }
          modifiedDbIds.add(result.caseId);
        }

        if (!jsonChanged && !dbChanged) {
          stats.unchanged_results += 1;
        }

        if (canApplyDecision) {
          stats.applied_count += 1;
          if (result.decision === 'KEEP_CURRENT') {
            stats.keep_current_applied += 1;
          } else if (result.decision === 'PROMOTE_RUNNER_UP') {
            stats.runner_up_promoted += 1;
          }
        } else {
          stats.manual_review_marked += 1;
          residualManual.push({
            _id: result.caseId,
            bucket_id: result.bucket_id,
            source: result.source,
            reason: result.decision === 'MANUAL_REVIEW'
              ? 'model_requested_manual_review'
              : 'confidence_below_apply_threshold',
            decision: result.decision,
            confidence: result.confidence,
            recommended_category: result.recommended_category,
            current_category: shortlist.current_category,
            target_category: shortlist.target_category,
            runner_up_category: shortlist.runner_up_category,
            reasoning: result.reasoning,
            evidence: result.evidence,
          });
        }
      }

      if (modifiedJsonIds.size > 0) {
        writeJsonAtomically(DATA_FILE, jsonCases);
      }
      if (modifiedDbIds.size > 0) {
        const modifiedDbCases = [...modifiedDbIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
        repo.updateCaseSnapshots(modifiedDbCases);
      }

      stats.modified_json_cases = modifiedJsonIds.size;
      stats.modified_db_cases = modifiedDbIds.size;
      stats.review_queue_after = countReviewQueue(jsonCases, sourceFilter);
      stats.review_queue_after_by_category = summarizeReviewQueue(jsonCases, sourceFilter);

      writeJsonAtomically(reportFile, stats);
      writeJsonAtomically(residualFile, residualManual);
    } finally {
      repo.close();
    }
  } finally {
    releaseApplyLock();
  }

  console.log('Category adjudication pack apply complete');
  console.log(`  Pack:               ${options.packName}`);
  console.log(`  Source:             ${sourceFilter}`);
  console.log(`  Results loaded:     ${stats.results_loaded}`);
  console.log(`  Applied:            ${stats.applied_count}`);
  console.log(`  Keep current:       ${stats.keep_current_applied}`);
  console.log(`  Promoted runner-up: ${stats.runner_up_promoted}`);
  console.log(`  Manual residual:    ${stats.manual_review_marked}`);
  console.log(`  Review queue:       ${stats.review_queue_before} -> ${stats.review_queue_after}`);
  console.log(`  Report:             ${reportFile}`);
  console.log(`  Residuals:          ${residualFile}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
