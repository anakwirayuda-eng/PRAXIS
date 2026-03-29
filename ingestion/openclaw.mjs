import fs from 'fs/promises';
import path from 'path';

/**
 * OpenClaw Orchestrator v1.0
 * A resilient batch processing engine for AI-driven data remediation.
 * Supports rate limiting, auto-retries, chunked saving, and telemetry.
 */

// Base Configuration (Default safeguards)
const DEFAULT_CONFIG = {
  BATCH_SIZE: 10,
  DELAY_MS: 3000, 
  MAX_RETRIES: 5,
  BACKOFF_429_MS: 30000,  // Base wait for 429 rate-limits
  MAX_DELAY_MS: 60000,    // Adaptive throttle ceiling
};

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'openclaw.log');
const DB_PATH = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 200;

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function logMsg(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  try {
    await fs.appendFile(LOG_FILE, line + '\n');
  } catch (err) {
    // silently fail
  }
}

export async function readCompiledCases() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    await logMsg(`🚨 Fatal: Cannot read DB at ${DB_PATH}. ${err.message}`);
    process.exit(1);
  }
}

let LAST_BACKUP_TIME = Date.now();
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 menit

async function rotateBackups() {
  try {
    const b1 = DB_PATH + '.bak.1';
    const b2 = DB_PATH + '.bak.2';
    const b3 = DB_PATH + '.bak.3';
    
    const b2Exists = await fs.stat(b2).then(()=>true).catch(()=>false);
    if (b2Exists) await fs.rename(b2, b3);
    
    const b1Exists = await fs.stat(b1).then(()=>true).catch(()=>false);
    if (b1Exists) await fs.rename(b1, b2);
    
    await fs.copyFile(DB_PATH, b1);
    await logMsg(`🛡️ Data Security: Rotating Backup completed (.bak.1, .bak.2, .bak.3).`);
  } catch(e) {
    await logMsg(`⚠️ Warning: Failed to rotate backups. ${e.message}`);
  }
}

export function isRetryableRenameError(err) {
  return err?.code === 'EPERM' || err?.code === 'EACCES';
}

async function cleanupTmpFile(tmpPath, fileOps = fs) {
  try {
    await fileOps.rm(tmpPath, { force: true });
  } catch {
    // best effort cleanup only
  }
}

export async function renameWithRetry(sourcePath, destPath, options = {}) {
  const {
    fileOps = fs,
    maxAttempts = RENAME_RETRY_ATTEMPTS,
    retryDelayMs = RENAME_RETRY_DELAY_MS,
    sleepFn = sleep,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fileOps.rename(sourcePath, destPath);
      return attempt;
    } catch (err) {
      lastError = err;
      if (!isRetryableRenameError(err) || attempt === maxAttempts) {
        throw err;
      }
      await sleepFn(retryDelayMs);
    }
  }

  throw lastError || new Error('Rename failed without an error object.');
}

export async function saveCompiledCases(dataset, options = {}) {
  const {
    dbPath = DB_PATH,
    fileOps = fs,
    logFn = logMsg,
    sleepFn = sleep,
    rotateBackupsFn = rotateBackups,
    nowFn = Date.now,
    backupIntervalMs = BACKUP_INTERVAL_MS,
  } = options;
  const tmpPath = `${dbPath}.tmp`;

  try {
    await fileOps.writeFile(tmpPath, JSON.stringify(dataset, null, 2), 'utf-8');
    const attemptCount = await renameWithRetry(tmpPath, dbPath, { fileOps, sleepFn });

    await logFn(`Database securely synced to disk (Atomic Write, attempt ${attemptCount}/${RENAME_RETRY_ATTEMPTS}) (${dataset.length} cases).`);

    if (nowFn() - LAST_BACKUP_TIME > backupIntervalMs) {
      await rotateBackupsFn();
      LAST_BACKUP_TIME = nowFn();
    }
  } catch (err) {
    await cleanupTmpFile(tmpPath, fileOps);
    await logFn(`Fatal: Cannot save DB! ${err.message}`);
    throw err;
  }
}

/**
 * Runs a specific "claw" (worker function) over a strictly filtered subset.
 * 
 * @param {string} taskName - Name of the remediation task
 * @param {Array} fullDataset - The entire JSON database Array
 * @param {Function} selectorFn - Filter function: (item) => boolean to identify targets
 * @param {Function} clawFn - Async worker function(item) that returns { success, computedPatch, error }
 * @param {Object} overrideConfig - Custom batch and delay configurations
 */
export async function runOrchestrator(taskName, fullDataset, selectorFn, clawFn, overrideConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrideConfig };
  const saveFn = overrideConfig.saveFn || saveCompiledCases;

  await logMsg(`\n======================================================`);
  await logMsg(`🚀 [START] OpenClaw Orchestrator initialized.`);
  await logMsg(`📋 Task Designation: ${taskName}`);

  // 1. Target Selection
  const targets = [];
  for (let i = 0; i < fullDataset.length; i++) {
    if (selectorFn(fullDataset[i])) {
      targets.push({ originalIndex: i, item: fullDataset[i] });
    }
  }

  await logMsg(`🎯 Targets Acquired: ${targets.length} cases out of ${fullDataset.length}`);
  if (targets.length === 0) {
    await logMsg(`🏁 Task completed immediately (0 targets found).`);
    return { successCount: 0, failCount: 0 };
  }

  let successCount = 0;
  let failCount = 0;
  let currentDelay = config.DELAY_MS; // Mutable for adaptive throttling

  // 2. Batch Processing Loop
  for (let i = 0; i < targets.length; i += config.BATCH_SIZE) {
    const batch = targets.slice(i, i + config.BATCH_SIZE);
    await logMsg(`🔄 Processing batch ${Math.floor(i/config.BATCH_SIZE) + 1} of ${Math.ceil(targets.length/config.BATCH_SIZE)}...`);

    const promises = batch.map(async (target) => {
      let retries = 0;
      while (retries <= config.MAX_RETRIES) {
        try {
          const result = await clawFn(target.item);
          if (result && result.success && result.data) {
             return { success: true, target, computedPatch: result.data };
          } else {
             const errMsg = result?.error || 'Worker rejected the payload or returned no patch data';
             const err = new Error(errMsg);
             // Propagate retryAfter from worker if available
             if (result?.retryAfter) err.retryAfter = result.retryAfter;
             if (errMsg.includes('429')) err.isRateLimit = true;
             throw err;
          }
        } catch (err) {
          retries++;
          if (retries > config.MAX_RETRIES) {
             return { success: false, target, error: err.message, isRateLimit: !!err.isRateLimit };
          }
          // 429-aware backoff: use Retry-After or fallback to long exponential pause
          if (err.isRateLimit || err.message?.includes('429')) {
            const waitMs = err.retryAfter
              ? Math.max(err.retryAfter * 1000, config.BACKOFF_429_MS)
              : config.BACKOFF_429_MS * retries;
            await logMsg(`⚠️ 429 Rate-limited on item ${target.item._id}. Backing off ${(waitMs/1000).toFixed(0)}s (retry ${retries}/${config.MAX_RETRIES})...`);
            await sleep(waitMs);
          } else {
            await sleep(2000 * retries); // standard exponential backoff
          }
        }
      }
    });

    const results = await Promise.all(promises);
    let batchModified = false;
    const modifiedItems = [];
    let batchFailCount = 0;
    
    // 3. Tally & Apply Fixes
    for (const res of results) {
      if (res.success) {
        successCount++;
        // Safely spread the original item with the new patched data
        fullDataset[res.target.originalIndex] = { ...res.target.item, ...res.computedPatch };
        modifiedItems.push(fullDataset[res.target.originalIndex]);
        batchModified = true;
      } else {
        failCount++;
        batchFailCount++;
        await logMsg(`❌ Failed item ${res.target.item._id}: ${res.error}`);
      }
    }

    // 4. Save checkpoint safely
    if (batchModified) {
      try {
        await saveFn(fullDataset, { modifiedItems });
      } catch (err) {
        await logMsg('Aborting task after checkpoint save failure. No further batches will be processed.');
        throw err;
      }
    }

    // 5. Adaptive Throttle: if >50% of batch failed, double the delay (up to ceiling)
    const batchFailRate = batchFailCount / batch.length;
    if (batchFailRate > 0.5) {
      currentDelay = Math.min(currentDelay * 2, config.MAX_DELAY_MS);
      await logMsg(`🔥 High failure rate (${(batchFailRate*100).toFixed(0)}%). Adaptive throttle → ${(currentDelay/1000).toFixed(0)}s`);
    } else if (batchFailRate === 0 && currentDelay > config.DELAY_MS) {
      // Gradually recover if things are healthy
      currentDelay = Math.max(Math.floor(currentDelay / 1.5), config.DELAY_MS);
      await logMsg(`✅ Clean batch. Recovering throttle → ${(currentDelay/1000).toFixed(0)}s`);
    }

    // 6. Throttle (Skip if DELAY_MS is 0)
    if (currentDelay > 0 && i + config.BATCH_SIZE < targets.length) {
      await logMsg(`⏳ Batch finished. Cooling down API for ${(currentDelay/1000).toFixed(0)}s...`);
      await sleep(currentDelay);
    }
  }

  await logMsg(`🏁 [END] Task: ${taskName}`);
  await logMsg(`📊 Final Results: ${successCount} Healed | ${failCount} Failed.`);
  return { successCount, failCount };
}
