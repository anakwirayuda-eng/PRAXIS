/**
 * MedCase Pro — Dataset Downloader
 * Downloads MedQA and MedMCQA from HuggingFace (easier than Google Drive)
 * 
 * Usage: node ingestion/download.js
 * 
 * HuggingFace datasets API provides direct JSON access without auth.
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources');

// HuggingFace datasets hub API — stream rows as JSON
const DATASETS = {
  medqa: {
    url: 'https://huggingface.co/datasets/GBaker/MedQA-USMLE-4-options/resolve/main/data/train-00000-of-00001.parquet',
    jsonApi: 'https://datasets-server.huggingface.co/rows?dataset=GBaker/MedQA-USMLE-4-options&config=default&split=train&offset=0&length=100',
    description: 'MedQA USMLE 4-option MCQs',
  },
  medmcqa: {
    url: 'https://huggingface.co/datasets/openlifescienceai/medmcqa/resolve/main/data/train-00000-of-00001.parquet',
    jsonApi: 'https://datasets-server.huggingface.co/rows?dataset=openlifescienceai/medmcqa&config=default&split=train&offset=0&length=100',
    description: 'MedMCQA AIIMS/NEET PG MCQs',
  }
};

async function downloadBatch(dataset, split, offset, length) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=default&split=${split}&offset=${offset}&length=${length}`;
  console.log(`  📡 Fetching ${dataset} offset=${offset} length=${length}...`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  return data.rows?.map(r => r.row) || [];
}

async function downloadDataset(name, dataset, maxRows = 5000) {
  const outDir = join(SOURCES_DIR, name);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const outFile = join(outDir, `${name}_raw.json`);
  
  // Check if already downloaded
  if (existsSync(outFile)) {
    console.log(`⏭️  ${name} already downloaded, skip.`);
    return;
  }

  console.log(`\n🔽 Downloading ${name}: ${dataset}...`);

  const BATCH_SIZE = 100;
  const allRows = [];
  
  for (let offset = 0; offset < maxRows; offset += BATCH_SIZE) {
    try {
      const rows = await downloadBatch(dataset, 'train', offset, BATCH_SIZE);
      if (rows.length === 0) break;
      allRows.push(...rows);
      
      // Rate limiting — be nice to HuggingFace
      await new Promise(r => setTimeout(r, 300));
      
      // Progress
      if ((offset / BATCH_SIZE) % 10 === 0) {
        console.log(`  ✅ ${allRows.length} rows downloaded...`);
      }
    } catch (err) {
      console.log(`  ⚠️  Error at offset ${offset}: ${err.message}`);
      break;
    }
  }

  console.log(`💾 Saving ${allRows.length} rows to ${outFile}`);
  writeFileSync(outFile, JSON.stringify(allRows, null, 0), 'utf-8');
  console.log(`✅ ${name} download complete!`);
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' MedCase Pro — Dataset Downloader');
  console.log('═══════════════════════════════════════\n');

  // Download MedQA (USMLE) — ~12K total, grab first 5000
  await downloadDataset('medqa', 'GBaker/MedQA-USMLE-4-options', 5000);

  // Download MedMCQA (AIIMS/NEET) — ~194K total, grab first 5000
  await downloadDataset('medmcqa', 'openlifescienceai/medmcqa', 5000);

  console.log('\n═══════════════════════════════════════');
  console.log(' Download Phase Complete!');
  console.log(' Next: run "node ingestion/parsers/parse-all.js"');
  console.log('═══════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ Download failed:', err);
  process.exit(1);
});
