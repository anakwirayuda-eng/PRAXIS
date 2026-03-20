/**
 * MedCase Pro — MedMCQA Downloader (Dedicated, with rate limit handling)
 * Downloads from HuggingFace with exponential backoff
 * Usage: node ingestion/download-medmcqa.js
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const OUT_DIR = join(import.meta.dirname, 'sources', 'medmcqa');
const OUT_FILE = join(OUT_DIR, 'medmcqa_raw.json');
const MAX_ROWS = 10000; // Grab 10K rows (scalable)
const BATCH_SIZE = 100;
const BASE_DELAY = 1500; // 1.5s between requests (conservative)

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBatch(offset, retries = 3) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=openlifescienceai/medmcqa&config=default&split=train&offset=${offset}&length=${BATCH_SIZE}`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const wait = BASE_DELAY * Math.pow(2, attempt + 1);
        console.log(`  ⏳ Rate limited. Waiting ${wait/1000}s... (attempt ${attempt+1}/${retries})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.rows?.map(r => r.row) || [];
    } catch (err) {
      if (attempt < retries - 1) {
        await sleep(BASE_DELAY * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log('═══════════════════════════════════════');
  console.log(' MedCase Pro — MedMCQA Downloader');
  console.log(` Target: ${MAX_ROWS} rows with ${BASE_DELAY}ms delay`);
  console.log('═══════════════════════════════════════\n');

  const allRows = [];
  let consecutiveErrors = 0;

  for (let offset = 0; offset < MAX_ROWS; offset += BATCH_SIZE) {
    try {
      const rows = await fetchBatch(offset);
      if (rows.length === 0) { console.log('  📭 No more rows.'); break; }
      allRows.push(...rows);
      consecutiveErrors = 0;

      if ((offset / BATCH_SIZE) % 10 === 0) {
        console.log(`  ✅ ${allRows.length} rows downloaded...`);
      }
      await sleep(BASE_DELAY);
    } catch (err) {
      console.log(`  ⚠️ Error at offset ${offset}: ${err.message}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 5) { console.log('  🛑 Too many consecutive errors. Stopping.'); break; }
      await sleep(BASE_DELAY * 4);
    }
  }

  console.log(`\n💾 Saving ${allRows.length} rows to ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(allRows, null, 0), 'utf-8');
  console.log(`✅ MedMCQA download complete! Got ${allRows.length} rows.`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
