/**
 * MedCase Pro — Tier 1 Mass Downloader v2
 * 
 * Fixes:
 *  - HeadQA: download raw ZIP → extract JSON (deferred — PDF-only dataset)
 *  - MMLU-Nutrition: confirmed valid config, retry
 *  - MedQA: expand to full 12,723 (train+test)
 *  - MedMCQA: expand to 50K (train+validation+test)
 *  - Added more MMLU subsets for topic diversity (virology, professional_psychology, high_school_biology)
 *
 * Usage: node ingestion/download-tier1-v2.js
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources');
const BASE_DELAY = 2000;
const BATCH_SIZE = 100;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBatch(dataset, config, split, offset, length = BATCH_SIZE, retries = 5) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${length}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const wait = BASE_DELAY * Math.pow(2, attempt + 1);
        console.log(`  ⏳ Rate limited, waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries})...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${res.statusText} — ${body.substring(0, 200)}`);
      }
      const data = await res.json();
      return data.rows?.map(r => r.row) || [];
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = BASE_DELAY * Math.pow(2, attempt);
        console.log(`  ⚠️ Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  return [];
}

/**
 * Download a dataset with resume support.
 * Downloads from multiple splits if provided.
 */
async function downloadDataset(name, hfDataset, hfConfig, splits, maxRowsPerSplit, outFile) {
  const dir = join(SOURCES_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, outFile);

  // Check existing data
  let existingData = [];
  if (existsSync(fullPath)) {
    try {
      existingData = JSON.parse(readFileSync(fullPath, 'utf-8'));
      if (!Array.isArray(existingData)) existingData = [];
    } catch { existingData = []; }
  }

  const totalTarget = maxRowsPerSplit * splits.length;
  if (existingData.length >= totalTarget) {
    console.log(`⏭️  ${name}: already ${existingData.length} rows (target: ${totalTarget}), skip.`);
    return existingData.length;
  }

  console.log(`\n🔽 ${name} (${hfDataset}) — have ${existingData.length}, target ~${totalTarget}`);

  const newRows = [];
  for (const split of splits) {
    console.log(`  📂 Split: ${split}`);
    let consecutiveErrors = 0;
    let splitRows = 0;

    for (let offset = 0; offset < maxRowsPerSplit; offset += BATCH_SIZE) {
      try {
        const rows = await fetchBatch(hfDataset, hfConfig, split, offset);
        if (rows.length === 0) { console.log(`    📭 No more rows in split "${split}" at offset ${offset}.`); break; }
        newRows.push(...rows);
        splitRows += rows.length;
        consecutiveErrors = 0;
        if ((offset / BATCH_SIZE) % 20 === 0) {
          console.log(`    ✅ ${splitRows} rows from "${split}" (total new: ${newRows.length})`);
        }
        await sleep(BASE_DELAY);
      } catch (err) {
        console.log(`    ⚠️ Error at ${split}/${offset}: ${err.message}`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          console.log(`    🛑 Too many errors in split "${split}". Moving on.`);
          break;
        }
        await sleep(BASE_DELAY * 4);
      }
    }
    console.log(`    📊 Got ${splitRows} from split "${split}"`);
  }

  // Merge: existing + new, deduplicate by question text
  const seen = new Set(existingData.map(r => (r.question || r.qtext || JSON.stringify(r)).substring(0, 100)));
  let dupes = 0;
  for (const row of newRows) {
    const key = (row.question || row.qtext || JSON.stringify(row)).substring(0, 100);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    existingData.push(row);
  }

  console.log(`💾 Saving ${existingData.length} rows (${dupes} duplicates removed) → ${name}`);
  writeFileSync(fullPath, JSON.stringify(existingData, null, 0), 'utf-8');
  return existingData.length;
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — TIER 1 MASS DOWNLOAD v2');
  console.log(' Fixes: MMLU-Nutrition, MedQA/MedMCQA expansion');
  console.log(' + Topic diversity (virology, psych, biology)');
  console.log('══════════════════════════════════════════════════\n');

  const results = {};

  // ──────────────────────────────────────
  // 1. MedQA — full dataset (train + test)
  // ──────────────────────────────────────
  results.medqa = await downloadDataset(
    'medqa', 'GBaker/MedQA-USMLE-4-options', 'default',
    ['train', 'test'], 15000, 'medqa_raw.json'
  );

  // ──────────────────────────────────────
  // 2. MedMCQA — expand to 50K (train + validation)
  // ──────────────────────────────────────
  results.medmcqa = await downloadDataset(
    'medmcqa', 'openlifescienceai/medmcqa', 'default',
    ['train', 'validation'], 30000, 'medmcqa_raw.json'
  );

  // ──────────────────────────────────────
  // 3. PubMedQA
  // ──────────────────────────────────────
  results.pubmedqa = await downloadDataset(
    'pubmedqa', 'qiaojin/PubMedQA', 'pqa_labeled',
    ['train'], 1000, 'pubmedqa_raw.json'
  );

  // ──────────────────────────────────────
  // 4. MedExpQA
  // ──────────────────────────────────────
  results.medexpqa = await downloadDataset(
    'medexpqa', 'HiTZ/MedExpQA', 'en',
    ['test'], 500, 'medexpqa_raw.json'
  );

  // ──────────────────────────────────────
  // 5. MMLU Medical Subsets + NEW topic-diverse subsets
  // ──────────────────────────────────────
  const mmluSubsets = [
    // Original medical subsets
    'clinical_knowledge',
    'medical_genetics',
    'anatomy',
    'college_medicine',
    'college_biology',
    'professional_medicine',
    'nutrition',                  // ← was 0KB, retrying
    // NEW: Topic diversity (IKM, public health, forensic, psych)
    'virology',                   // → infectious disease
    'professional_psychology',    // → psychiatry / behavioral health
    'high_school_biology',        // → basic science breadth
    'human_aging',                // → geriatrics
  ];

  let mmluTotal = 0;
  for (const subset of mmluSubsets) {
    const count = await downloadDataset(
      `mmlu-${subset}`, 'cais/mmlu', subset,
      ['test', 'validation', 'dev'], 500, `${subset}_raw.json`
    );
    mmluTotal += count;
  }
  results.mmlu = mmluTotal;

  // ──────────────────────────────────────
  // Summary
  // ──────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(' TIER 1 DOWNLOAD v2 COMPLETE');
  console.log('══════════════════════════════════════════════════');
  for (const [name, count] of Object.entries(results)) {
    console.log(`  ${name}: ${count} rows`);
  }
  const grand = Object.values(results).reduce((a, b) => a + b, 0);
  console.log(`  ─────────────────────`);
  console.log(`  TOTAL: ${grand.toLocaleString()} rows`);
  console.log('══════════════════════════════════════════════════');
  console.log(' Next: node ingestion/parsers/parse-all.js');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
