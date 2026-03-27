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
  MAX_RETRIES: 2,
};

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'openclaw.log');
const DB_PATH = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

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

export async function saveCompiledCases(dataset) {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(dataset, null, 2), 'utf-8');
    await logMsg(`💾 Database securely synced to disk (${dataset.length} cases).`);
  } catch (err) {
    await logMsg(`🚨 Fatal: Cannot save DB! ${err.message}`);
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
             throw new Error(result?.error || 'Worker rejected the payload or returned no patch data');
          }
        } catch (err) {
          retries++;
          if (retries > config.MAX_RETRIES) {
             return { success: false, target, error: err.message };
          }
          await sleep(1500 * retries); // exponential backoff
        }
      }
    });

    const results = await Promise.all(promises);
    let batchModified = false;
    
    // 3. Tally & Apply Fixes
    for (const res of results) {
      if (res.success) {
        successCount++;
        // Safely spread the original item with the new patched data
        fullDataset[res.target.originalIndex] = { ...res.target.item, ...res.computedPatch };
        batchModified = true;
      } else {
        failCount++;
        await logMsg(`❌ Failed item ${res.target.item._id}: ${res.error}`);
      }
    }

    // 4. Save checkpoint safely
    if (batchModified) {
      await saveCompiledCases(fullDataset);
    }

    // 5. Throttle (Skip if DELAY_MS is 0)
    if (config.DELAY_MS > 0 && i + config.BATCH_SIZE < targets.length) {
      await logMsg(`⏳ Batch finished. Cooling down API for ${config.DELAY_MS/1000}s...`);
      await sleep(config.DELAY_MS);
    }
  }

  await logMsg(`🏁 [END] Task: ${taskName}`);
  await logMsg(`📊 Final Results: ${successCount} Healed | ${failCount} Failed.`);
  return { successCount, failCount };
}
