import path from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

import { runOrchestrator } from './openclaw.mjs';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const DEFAULT_QUEUE_FILE = path.join(__dirname, 'output', 'readability_bedah_high_wave1_queue.json');
const REPORT_FILE = path.join(__dirname, 'output', 'openclaw_high03_conservative_report.json');
const APPLY_LOCK_DIR = path.join(__dirname, 'output', '.casebank-apply.lock');
const APPLY_LOCK_INFO_FILE = path.join(APPLY_LOCK_DIR, 'owner.json');
const APPLY_LOCK_WAIT_MS = 250;
const APPLY_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_DELAY_MS = 1500;

loadDotEnv();

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {
    queueFile: DEFAULT_QUEUE_FILE,
    label: 'openclaw-high03-conservative',
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    model: DEFAULT_MODEL,
    limit: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--queue-file=')) {
      options.queueFile = path.resolve(process.cwd(), arg.slice('--queue-file='.length));
      continue;
    }
    if (arg.startsWith('--label=')) {
      options.label = String(arg.slice('--label='.length) || '').trim() || options.label;
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      const parsed = Number.parseInt(arg.slice('--batch-size='.length), 10);
      options.batchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
      continue;
    }
    if (arg.startsWith('--delay-ms=')) {
      const parsed = Number.parseInt(arg.slice('--delay-ms='.length), 10);
      options.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      continue;
    }
    if (arg.startsWith('--model=')) {
      options.model = String(arg.slice('--model='.length) || '').trim() || DEFAULT_MODEL;
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

function addQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
  }
}

function clearReadabilityHold(meta) {
  let changed = false;
  for (const key of [
    'readability_ai_hold',
    'readability_ai_hold_basis',
    'readability_ai_hold_at',
    'readability_ai_hold_reasoning',
    'readability_ai_hold_notes',
  ]) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function looksUnsafeRationale(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized || normalized.length < 80) {
    return true;
  }
  if (normalized.length > 1600) {
    return true;
  }
  if (/```|lorem ipsum|not available|see reference|refer to textbook/i.test(normalized)) {
    return true;
  }
  if (/[{}[\]]/.test(normalized)) {
    return true;
  }
  return false;
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

function writeJsonAtomically(filePath, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function buildTargetCases(queueFile, limit) {
  const queue = JSON.parse(readFileSync(queueFile, 'utf8'));
  const sliced = Array.isArray(queue) ? (limit ? queue.slice(0, limit) : queue) : [];
  return sliced.map((item) => ({
    _id: String(item._id),
    case_code: item.case_code,
    category: item.category,
    priority: item.priority,
    lane_rationale: item.lane_rationale,
    reason_codes: item.reason_codes || [],
  }));
}

function buildSelector(targetIds) {
  return function selector(item) {
    if (!targetIds.has(String(item._id))) {
      return false;
    }

    const meta = item.meta || {};
    const correctCount = Array.isArray(item.options)
      ? item.options.filter((option) => option.is_correct).length
      : 0;

    if (correctCount !== 1) {
      return false;
    }

    if (String(meta.status || '').startsWith('QUARANTINED')) {
      return false;
    }

    const hasConsensus = meta.clinical_consensus === 'AI_AGREES_WITH_BASELINE'
      || meta._openclaw_t9_v2 === true
      || meta._openclaw_t9_verified === true
      || String(meta.clinical_consensus || '').startsWith('AI_CONFLICT_RESOLVED_PHASE1');

    if (!hasConsensus) {
      return false;
    }

    if (meta._openclaw_high03_conservative === true) {
      return false;
    }

    return normalizeWhitespace(item.rationale?.correct).length >= 80;
  };
}

async function createWorker(options, targetMetaMap, report) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found in environment or .env');
  }

  return async function conservativeClaw(item) {
    const targetMeta = targetMetaMap.get(String(item._id)) || {};
    const currentCorrect = (item.options || []).find((option) => option.is_correct);
    if (!currentCorrect) {
      report.skipped.push({ _id: item._id, reason: 'missing_single_correct_option' });
      return { success: false, error: 'missing_single_correct_option' };
    }

    const optionsText = (item.options || [])
      .map((option) => `[${option.id}] ${normalizeWhitespace(option.text)}`)
      .join('\n');

    const payload = {
      _id: String(item._id),
      case_code: item.case_code || targetMeta.case_code || '',
      source: item.meta?.source || '',
      category: item.category || targetMeta.category || '',
      prompt: normalizeWhitespace(item.prompt),
      narrative: normalizeWhitespace(item.vignette?.narrative || item.vignette || ''),
      options: (item.options || []).map((option) => ({
        id: option.id,
        text: normalizeWhitespace(option.text),
        is_correct: option.is_correct === true,
      })),
      current_correct_option_id: currentCorrect.id,
      current_correct_option_text: normalizeWhitespace(currentCorrect.text),
      current_rationale: normalizeWhitespace(item.rationale?.correct || ''),
      lane_rationale: targetMeta.lane_rationale || '',
      reason_codes: targetMeta.reason_codes || [],
    };

    const prompt = [
      'You are performing a conservative OCR cleanup pass for a medical MCQ rationale.',
      'Rules:',
      `1. Treat the current correct option [${currentCorrect.id}] as fixed unless the item is clearly unsalvageable.`,
      '2. Rewrite only the rationale into clean, self-contained prose.',
      '3. Do not change the stem, vignette, or options.',
      '4. Use HOLD if the rationale still depends on missing image context, source text is too broken, or the current key looks unsafe.',
      '5. Keep the rewrite concise, factual, and exam-ready.',
      'Return strict JSON only with this shape:',
      '{"_id":"string","decision":"PASS|HOLD","confidence":"HIGH|MEDIUM|LOW","agreement":true,"correct_option_id":"A","reasoning":"short reason","rewritten_rationale":"clean rationale or empty string"}',
      '',
      JSON.stringify(payload, null, 2),
      '',
      'Options:',
      optionsText,
    ].join('\n');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number.parseInt(response.headers.get('retry-after') || '0', 10) || 0;
          return { success: false, error: 'OpenAI API HTTP Error: 429', retryAfter };
        }
        return { success: false, error: `OpenAI API HTTP Error: ${response.status}` };
      }

      const raw = await response.json();
      const parsed = JSON.parse(raw.choices?.[0]?.message?.content || '{}');
      const decision = normalizeWhitespace(parsed.decision).toUpperCase();
      const confidence = normalizeWhitespace(parsed.confidence).toUpperCase();
      const agreement = parsed.agreement === true;
      const correctOptionId = normalizeWhitespace(parsed.correct_option_id);
      const cleanedRationale = normalizeWhitespace(parsed.rewritten_rationale);
      const reasoning = normalizeWhitespace(parsed.reasoning);

      if (decision !== 'PASS' || confidence !== 'HIGH' || agreement !== true || correctOptionId !== String(currentCorrect.id)) {
        report.skipped.push({
          _id: item._id,
          reason: 'model_did_not_clear_safety_gate',
          decision,
          confidence,
          agreement,
          correct_option_id: correctOptionId,
          reasoning,
        });
        return { success: false, error: 'model_did_not_clear_safety_gate' };
      }

      if (looksUnsafeRationale(cleanedRationale)) {
        report.skipped.push({
          _id: item._id,
          reason: 'rewritten_rationale_failed_validation',
          reasoning,
        });
        return { success: false, error: 'rewritten_rationale_failed_validation' };
      }

      const now = new Date().toISOString();
      const nextMeta = {
        ...(item.meta || {}),
        needs_review: false,
        reviewed: true,
        ai_audited: true,
        review_confidence: 'HIGH',
        review_source: `openclaw:${options.label}`,
        reviewed_at: now,
        review_rationale: reasoning || 'Conservative rationale-only cleanup passed.',
        readability_ai_pass: true,
        readability_ai_basis: `openclaw:${options.label}`,
        readability_ai_pass_at: now,
        readability_ai_batch: options.label,
        readability_ai_playbook: 'clinical_rewrite',
        readability_ai_rewrite_notes: 'Conservative rationale-only cleanup for frozen high-03 OCR roughness.',
        _openclaw_high03_conservative: true,
        _rationale_regenerated: true,
      };
      clearReadabilityHold(nextMeta);
      addQualityFlag(nextMeta, 'openclaw_high03_conservative');
      addQualityFlag(nextMeta, 'readability_openclaw_rationale_cleanup');

      report.applied.push({
        _id: item._id,
        case_code: item.case_code || targetMeta.case_code || '',
        confidence,
        reasoning,
      });

      return {
        success: true,
        data: {
          rationale: {
            ...(item.rationale || {}),
            correct: cleanedRationale,
          },
          meta: nextMeta,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetCases = buildTargetCases(options.queueFile, options.limit);
  const targetIds = new Set(targetCases.map((item) => String(item._id)));
  const targetMetaMap = new Map(targetCases.map((item) => [String(item._id), item]));
  const dataset = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const repo = createCasebankRepository(openCasebankDb());
  const report = {
    generated_at: new Date().toISOString(),
    label: options.label,
    queue_file: options.queueFile,
    model: options.model,
    batch_size: options.batchSize,
    delay_ms: options.delayMs,
    target_count: targetCases.length,
    target_ids: targetCases.map((item) => Number(item._id)),
    applied: [],
    skipped: [],
    save_batches: [],
  };

  acquireApplyLock(`openclaw:${options.label}`);
  try {
    const worker = await createWorker(options, targetMetaMap, report);
    const selector = buildSelector(targetIds);
    const saveFn = async (fullDataset, context = {}) => {
      const modifiedItems = context.modifiedItems?.length ? context.modifiedItems : fullDataset.filter((item) => targetIds.has(String(item._id)));
      writeJsonAtomically(DATA_FILE, fullDataset);
      if (modifiedItems.length > 0) {
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
        MAX_RETRIES: 2,
        saveFn,
      },
    );

    report.success_count = result.successCount;
    report.fail_count = result.failCount;
  } finally {
    repo.close();
    releaseApplyLock();
  }

  mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('OpenClaw high-03 conservative fallback complete');
  console.log(`  Label:         ${options.label}`);
  console.log(`  Targets:       ${report.target_count}`);
  console.log(`  Applied:       ${report.applied.length}`);
  console.log(`  Skipped:       ${report.skipped.length}`);
  console.log(`  Report:        ${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
