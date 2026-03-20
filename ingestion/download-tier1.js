/**
 * MedCase Pro — Tier 1 Mass Downloader
 * Downloads ALL Tier 1 datasets from HuggingFace Datasets API
 * 
 * Datasets: MedQA (remaining), MedMCQA (remaining), PubMedQA, HeadQA, MedExpQA
 * Usage: node ingestion/download-tier1.js
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources');
const BASE_DELAY = 2000;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBatch(dataset, config, split, offset, length = 100, retries = 3) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${length}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const wait = BASE_DELAY * Math.pow(2, attempt + 1);
        console.log(`  ⏳ Rate limited. Waiting ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      return data.rows?.map(r => r.row) || [];
    } catch (err) {
      if (attempt < retries - 1) { await sleep(BASE_DELAY * Math.pow(2, attempt)); continue; }
      throw err;
    }
  }
  return [];
}

async function downloadDataset(name, hfDataset, hfConfig, hfSplit, maxRows, outFile) {
  const dir = join(SOURCES_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, outFile);

  // If file exists and has data, check existing count
  let existingCount = 0;
  if (existsSync(fullPath)) {
    try {
      const existing = JSON.parse(readFileSync(fullPath, 'utf-8'));
      existingCount = existing.length;
      if (existingCount >= maxRows) {
        console.log(`⏭️  ${name} already has ${existingCount} rows, skip.`);
        return existingCount;
      }
      console.log(`🔄 ${name} has ${existingCount}, downloading more...`);
    } catch {
      // Ignore invalid partial file and redownload.
    }
  }

  console.log(`\n🔽 Downloading ${name} (${hfDataset}) — target: ${maxRows}`);

  const allRows = [];
  let consecutiveErrors = 0;

  for (let offset = existingCount; offset < maxRows; offset += 100) {
    try {
      const rows = await fetchBatch(hfDataset, hfConfig, hfSplit, offset);
      if (rows.length === 0) { console.log('  📭 No more rows.'); break; }
      allRows.push(...rows);
      consecutiveErrors = 0;
      if ((offset / 100) % 10 === 0) console.log(`  ✅ ${existingCount + allRows.length} rows...`);
      await sleep(BASE_DELAY);
    } catch (err) {
      console.log(`  ⚠️ Error at offset ${offset}: ${err.message}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 3) { console.log('  🛑 Too many errors. Moving on.'); break; }
      await sleep(BASE_DELAY * 4);
    }
  }

  // Merge with existing if any
  let finalRows = allRows;
  if (existingCount > 0 && existsSync(fullPath)) {
    try {
      const existing = JSON.parse(readFileSync(fullPath, 'utf-8'));
      finalRows = [...existing, ...allRows];
    } catch {
      // Ignore merge failure and keep newly downloaded rows.
    }
  }

  console.log(`💾 Saving ${finalRows.length} rows to ${name}`);
  writeFileSync(fullPath, JSON.stringify(finalRows, null, 0), 'utf-8');
  return finalRows.length;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' MedCase Pro — TIER 1 MASS DOWNLOAD');
  console.log(' Target: All HuggingFace medical datasets');
  console.log('═══════════════════════════════════════════\n');

  const results = {};

  // 1. MedQA remaining (we have 3600, total ~11K)
  results.medqa = await downloadDataset(
    'medqa', 'GBaker/MedQA-USMLE-4-options', 'default', 'train', 11000, 'medqa_raw.json'
  );

  // 2. MedMCQA remaining (we have 2900, grab up to 20K)
  results.medmcqa = await downloadDataset(
    'medmcqa', 'openlifescienceai/medmcqa', 'default', 'train', 20000, 'medmcqa_raw.json'
  );

  // 3. PubMedQA — expert-annotated biomedical questions
  results.pubmedqa = await downloadDataset(
    'pubmedqa', 'qiaojin/PubMedQA', 'pqa_labeled', 'train', 1000, 'pubmedqa_raw.json'
  );

  // 4. HeadQA — graduate medical exam (Spain, English version) 
  results.headqa = await downloadDataset(
    'headqa', 'dvilares/head_qa', 'en', 'train', 3000, 'headqa_raw.json'
  );

  // 5. MedExpQA — medical expert QA with reasoning
  results.medexpqa = await downloadDataset(
    'medexpqa', 'HiTZ/MedExpQA', 'en', 'test', 500, 'medexpqa_raw.json'
  );

  // 6. MMLU medical subsets (Clinical Knowledge, Medical Genetics, Anatomy, etc.)
  const mmluSubsets = [
    'clinical_knowledge', 'medical_genetics', 'anatomy', 'college_medicine',
    'college_biology', 'professional_medicine', 'nutrition'
  ];
  let mmluTotal = 0;
  for (const subset of mmluSubsets) {
    const count = await downloadDataset(
      `mmlu-${subset}`, 'cais/mmlu', subset, 'test', 500, `${subset}_raw.json`
    );
    mmluTotal += count;
  }
  results.mmlu = mmluTotal;

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log(' TIER 1 DOWNLOAD COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(' Results:');
  for (const [name, count] of Object.entries(results)) {
    console.log(`   ${name}: ${count} rows`);
  }
  console.log(`   TOTAL: ${Object.values(results).reduce((a,b) => a+b, 0)} rows`);
  console.log('═══════════════════════════════════════════');
  console.log(' Next: run "node ingestion/parsers/parse-all.js"');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
