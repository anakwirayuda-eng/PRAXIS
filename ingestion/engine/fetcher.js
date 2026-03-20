import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Manifest } from './manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.resolve(__dirname, '..', 'sources');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * MedCase Pro — Immortal Fetch Engine
 * 
 * Genius Hacks:
 *  1. HEAD-First ETag — zero-bandwidth idempotency check
 *  2. NDJSON Streaming — crash-safe append, resume from any line
 *  3. Jittered Exponential Backoff — anti-DDoS, looks human
 */
export class FetchEngine {
  /**
   * 🔥 Hack 3: Jittered Exponential Backoff
   */
  static async fetchWithRetry(url, options = {}, retries = 5) {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;

        if ([429, 403].includes(res.status) || res.status >= 500) {
          if (i === retries) throw new Error(`HTTP ${res.status} after ${retries} retries: ${url}`);
          const jitter = Math.random() * 500;
          const delay = Math.pow(2, i) * 1000 + jitter;
          console.warn(`  ⚠️ [Retry ${i + 1}/${retries}] HTTP ${res.status}. Waiting ${Math.round(delay)}ms...`);
          await wait(delay);
        } else {
          throw new Error(`HTTP ${res.status}: ${url}`);
        }
      } catch (err) {
        if (err.message.startsWith('HTTP')) throw err;
        if (i === retries) throw err;
        const jitter = Math.random() * 500;
        const delay = Math.pow(2, i) * 1000 + jitter;
        console.warn(`  ⚠️ [Retry ${i + 1}/${retries}] Network error. Waiting ${Math.round(delay)}ms...`);
        await wait(delay);
      }
    }
  }

  /**
   * Smart fetch from HuggingFace with ETag check + NDJSON resume
   * Returns true if new data was fetched, false if up-to-date
   */
  static async smartFetchHF(sourceId, dataset, config, split, expectedRows, isDryRun = false) {
    const state = Manifest.getSource(sourceId);
    const sourceDir = path.join(SOURCES_DIR, sourceId);
    const destPath = path.join(sourceDir, `${sourceId}_raw.jsonl`);
    const baseUrl = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}`;

    console.log(`\n🔍 [${sourceId}] Checking...`);

    // Ensure source dir exists
    if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });

    // 🔥 Hack 1: HEAD-First ETag Bypass
    try {
      const headUrl = `${baseUrl}&offset=0&length=1`;
      const headRes = await this.fetchWithRetry(headUrl);
      const currentEtag = headRes.headers.get('etag') || headRes.headers.get('x-revision') || null;

      if (currentEtag && state.etag === currentEtag && state.status === 'complete' && fs.existsSync(destPath)) {
        console.log(`  ✅ Up-to-date (ETag match). Skipped.`);
        return false;
      }

      if (isDryRun) {
        console.log(`  🧪 [DRY-RUN] Needs update. ETag: ${state.etag || 'none'} → ${currentEtag || 'unknown'}`);
        return false;
      }

      // Update ETag in manifest
      Manifest.updateSource(sourceId, { etag: currentEtag });
    } catch (e) {
      console.log(`  ℹ️ ETag pre-flight failed (${e.message}), proceeding to full fetch.`);
    }

    // 🔥 Hack 2: NDJSON Resume
    let offset = 0;
    if (state.status === 'fetching' && state.resumeOffset > 0 && fs.existsSync(destPath)) {
      offset = state.resumeOffset;
      console.log(`  ♻️ Resuming from offset ${offset}/${expectedRows}`);
    } else {
      // Fresh start — clear old file
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }

    console.log(`  ⬇️ Fetching rows ${offset}→${expectedRows}...`);
    const chunkSize = 100;

    while (offset < expectedRows) {
      const length = Math.min(chunkSize, expectedRows - offset);
      const url = `${baseUrl}&offset=${offset}&length=${length}`;

      const res = await this.fetchWithRetry(url);
      const data = await res.json();

      if (!data.rows || data.rows.length === 0) break;

      // Append as NDJSON — each line is one independent JSON object
      const ndjson = data.rows.map((r) => JSON.stringify(r.row)).join('\n') + '\n';
      fs.appendFileSync(destPath, ndjson);

      offset += data.rows.length;

      // Save resume state after EVERY chunk
      Manifest.updateSource(sourceId, {
        resumeOffset: offset,
        status: 'fetching',
        rowCount: offset,
      });

      if (offset % 1000 === 0 || offset >= expectedRows) {
        process.stdout.write(`\r  ⏳ ${offset.toLocaleString()}/${expectedRows.toLocaleString()} rows`);
      }
    }

    Manifest.updateSource(sourceId, {
      resumeOffset: offset,
      rowCount: offset,
      status: 'complete',
      lastFetch: new Date().toISOString(),
    });

    console.log(`\n  🎉 [${sourceId}] Complete: ${offset.toLocaleString()} rows`);
    return true;
  }

  /**
   * Scrape a web source — delegates to existing download scripts
   * Returns true if the script produced output
   */
  static async runScraper(sourceId, scriptPath, isDryRun = false) {
    const state = Manifest.getSource(sourceId);
    console.log(`\n🔍 [${sourceId}] Checking scraper...`);

    if (isDryRun) {
      console.log(`  🧪 [DRY-RUN] Would run: node ${scriptPath}`);
      return false;
    }

    // Only re-scrape if not completed in last 24 hours
    if (state.status === 'complete' && state.lastFetch) {
      const hoursSince = (Date.now() - new Date(state.lastFetch).getTime()) / 3600000;
      if (hoursSince < 24) {
        console.log(`  ✅ Scraped ${Math.round(hoursSince)}h ago. Skipping (24h cooldown).`);
        return false;
      }
    }

    try {
      const { execSync } = await import('child_process');
      execSync(`node ${scriptPath}`, { stdio: 'inherit', cwd: path.resolve(__dirname, '..', '..') });
      Manifest.updateSource(sourceId, {
        status: 'complete',
        lastFetch: new Date().toISOString(),
      });
      return true;
    } catch (e) {
      console.error(`  ❌ Scraper failed: ${e.message}`);
      Manifest.updateSource(sourceId, { status: 'error', lastError: e.message });
      return false;
    }
  }
}
