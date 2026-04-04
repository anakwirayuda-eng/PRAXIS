#!/usr/bin/env node
/**
 * MedCase Pro — Automaton Pipeline (The Command Center)
 * 
 * Usage:
 *   npm run pipeline           # Full: fetch → compile → validate → deploy
 *   npm run pipeline:fetch     # Only fetch new data 
 *   npm run pipeline:compile   # Only re-parse, validate, and deploy
 *   npm run pipeline:deploy    # Only atomic deploy to public/
 *   npm run pipeline:status    # Show manifest + source status
 *   npm run pipeline:dry       # Dry run — check without downloading
 * 
 * Genius Hacks:
 *   1. HEAD-First ETag — zero-bandwidth idempotency
 *   2. NDJSON Streaming — crash-safe resume from any row
 *   3. Jittered Exponential Backoff — anti-DDoS
 *   4. Atomic Swap Deployment — zero-downtime
 *   5. Smart Incremental Bypass — skip compile when no upstream changes
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Manifest } from './engine/manifest.js';
import { FetchEngine } from './engine/fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const command = process.argv[2] || 'all';
const isDryRun = process.argv.includes('--dry-run');

// ═══════════════════════════════════════
// Directory Setup
// ═══════════════════════════════════════
const DIRS = {
  sources: path.resolve(__dirname, 'sources'),
  output: path.resolve(__dirname, 'output'),
  public: path.resolve(PROJECT_ROOT, 'public'),
  publicData: path.resolve(PROJECT_ROOT, 'public', 'data'),
  legacyFlatFile: path.resolve(PROJECT_ROOT, 'public', 'compiled_cases.json'),
};

// ═══════════════════════════════════════
// Source Registry — all datasets to fetch
// ═══════════════════════════════════════
const HF_SOURCES = [
  // Tier 1: HuggingFace datasets
  { id: 'medqa', dataset: 'GBaker/MedQA-USMLE-4-options', config: 'default', split: 'train', expectedRows: 11410 },
  { id: 'medmcqa', dataset: 'openlifescienceai/medmcqa', config: 'default', split: 'train', expectedRows: 34073 },
  { id: 'pubmedqa', dataset: 'qiaojin/PubMedQA', config: 'pqa_labeled', split: 'train', expectedRows: 1000 },
  { id: 'medexpqa', dataset: 'HiTZ/MedExpQA', config: 'en', split: 'test', expectedRows: 125 },
  // MMLU medical subsets
  { id: 'mmlu-clinical_knowledge', dataset: 'cais/mmlu', config: 'clinical_knowledge', split: 'test', expectedRows: 299 },
  { id: 'mmlu-medical_genetics', dataset: 'cais/mmlu', config: 'medical_genetics', split: 'test', expectedRows: 116 },
  { id: 'mmlu-anatomy', dataset: 'cais/mmlu', config: 'anatomy', split: 'test', expectedRows: 154 },
  { id: 'mmlu-college_medicine', dataset: 'cais/mmlu', config: 'college_medicine', split: 'test', expectedRows: 200 },
  { id: 'mmlu-college_biology', dataset: 'cais/mmlu', config: 'college_biology', split: 'test', expectedRows: 165 },
  { id: 'mmlu-professional_medicine', dataset: 'cais/mmlu', config: 'professional_medicine', split: 'test', expectedRows: 306 },
  { id: 'mmlu-nutrition', dataset: 'cais/mmlu', config: 'nutrition', split: 'test', expectedRows: 336 },
  { id: 'mmlu-virology', dataset: 'cais/mmlu', config: 'virology', split: 'test', expectedRows: 189 },
  { id: 'mmlu-professional_psychology', dataset: 'cais/mmlu', config: 'professional_psychology', split: 'test', expectedRows: 570 },
  { id: 'mmlu-high_school_biology', dataset: 'cais/mmlu', config: 'high_school_biology', split: 'test', expectedRows: 343 },
  { id: 'mmlu-human_aging', dataset: 'cais/mmlu', config: 'human_aging', split: 'test', expectedRows: 251 },
];

const SCRAPERS = [
  { id: 'litfl', script: 'ingestion/download-litfl.js' },
  { id: 'ukmppd-web', script: 'ingestion/download-ukmppd.js' },
  { id: 'docquiz', script: 'ingestion/download-docquiz.js' },
];

// ═══════════════════════════════════════
// STAGE 1: SMART FETCH
// ═══════════════════════════════════════
async function stageFetch() {
  console.log('\n══════════════════════════════════════');
  console.log(' 🌐 STAGE 1: SMART FETCH');
  console.log('══════════════════════════════════════');

  let anyChanges = false;

  // HuggingFace sources
  for (const src of HF_SOURCES) {
    try {
      const changed = await FetchEngine.smartFetchHF(
        src.id, src.dataset, src.config, src.split, src.expectedRows, isDryRun
      );
      if (changed) anyChanges = true;
    } catch (err) {
      console.error(`  ❌ [${src.id}] Failed: ${err.message}`);
    }
  }

  // Web scrapers (with 24h cooldown)
  for (const scraper of SCRAPERS) {
    try {
      const changed = await FetchEngine.runScraper(scraper.id, scraper.script, isDryRun);
      if (changed) anyChanges = true;
    } catch (err) {
      console.error(`  ❌ [${scraper.id}] Scraper failed: ${err.message}`);
    }
  }

  return anyChanges;
}

// ═══════════════════════════════════════
// STAGE 2 & 3: COMPILE + VALIDATE
// ═══════════════════════════════════════
function stageCompileAndValidate() {
  console.log('\n══════════════════════════════════════');
  console.log(' ⚙️ STAGE 2 & 3: COMPILE + VALIDATE');
  console.log('══════════════════════════════════════');

  console.log('\n📦 Running parse-all.js...');
  execSync('node ingestion/parsers/parse-all.js', { stdio: 'inherit', cwd: PROJECT_ROOT });

  console.log('\n🧭 Running normalize-categories.mjs...');
  execSync('node ingestion/normalize-categories.mjs --target output', { stdio: 'inherit', cwd: PROJECT_ROOT });

  console.log('\n🔍 Running validate-v3.js (Enterprise Edition)...');
  execSync('node ingestion/validators/validate-v3.js', { stdio: 'inherit', cwd: PROJECT_ROOT });

  // Read output stats
  const outputPath = path.join(DIRS.output, 'compiled_cases.json');
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    const cases = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    const totalCases = Array.isArray(cases) ? cases.length : 0;
    Manifest.markCompiled(totalCases);
    console.log(`\n📊 Compiled: ${totalCases.toLocaleString()} cases (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
  }
}

// ═══════════════════════════════════════
// STAGE 4: ATOMIC DEPLOY
// ═══════════════════════════════════════
function stageDeploy() {
  console.log('\n══════════════════════════════════════');
  console.log(' 🚀 STAGE 4: ATOMIC DEPLOYMENT');
  console.log('══════════════════════════════════════');

  const sourceFile = path.join(DIRS.output, 'compiled_cases.json');
  const targetFile = path.join(DIRS.publicData, 'compiled_cases.json');

  if (!fs.existsSync(sourceFile)) {
    console.log('  ⚠️ No compiled output found. Skipping deploy.');
    return;
  }

  fs.mkdirSync(DIRS.publicData, { recursive: true });

  if (fs.existsSync(DIRS.legacyFlatFile)) {
    fs.rmSync(DIRS.legacyFlatFile, { force: true });
    console.log('  🗑️ Removed stale flat deploy target: public/compiled_cases.json');
  }

  // 2. 🔥 Hack 4: Atomic Swap — write to .tmp, then rename (0ms, zero-downtime)
  const tmpTarget = `${targetFile}.tmp`;
  fs.copyFileSync(sourceFile, tmpTarget);
  fs.renameSync(tmpTarget, targetFile);

  const stats = fs.statSync(targetFile);
  Manifest.markDeployed();
  console.log(`  ✅ Atomic deploy → public/data/compiled_cases.json (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
}

// ═══════════════════════════════════════
// STATUS: Show Pipeline Health
// ═══════════════════════════════════════
function showStatus() {
  const manifest = Manifest.load();
  
  console.log('\n══════════════════════════════════════');
  console.log(' 📋 MEDCASE PIPELINE STATUS');
  console.log('══════════════════════════════════════\n');
  
  console.log(`  Total Cases:  ${manifest.totalCases?.toLocaleString() || 'unknown'}`);
  console.log(`  Last Compile: ${manifest.lastCompile || 'never'}`);
  console.log(`  Last Deploy:  ${manifest.lastDeploy || 'never'}`);
  console.log(`  Manifest Ver: ${manifest.version}\n`);

  const sources = manifest.sources || {};
  const rows = Object.entries(sources).map(([id, s]) => ({
    Source: id,
    Status: s.status || '?',
    Rows: s.rowCount || 0,
    'Last Fetch': s.lastFetch ? new Date(s.lastFetch).toLocaleDateString() : 'never',
    ETag: s.etag ? s.etag.substring(0, 12) + '...' : 'none',
  }));

  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.log('  No sources tracked yet. Run `npm run pipeline:fetch` first.');
  }
}

// ═══════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════
async function main() {
  const startTime = Date.now();
  
  console.log('═══════════════════════════════════════');
  console.log(' 🧬 MEDCASE PRO — AUTOMATON PIPELINE');
  console.log(`   Command: ${command}${isDryRun ? ' (DRY RUN)' : ''}`);
  console.log('═══════════════════════════════════════');

  if (command === 'status') {
    showStatus();
    return;
  }

  try {
    let hasChanges = false;

    // STAGE 1: FETCH
    if (['all', 'fetch'].includes(command)) {
      hasChanges = await stageFetch();
    }

    // STAGE 2 & 3: COMPILE + VALIDATE
    if (['all', 'compile'].includes(command)) {
      // 🔥 Hack 5: Smart Incremental Bypass
      if (command === 'all' && !hasChanges && !isDryRun) {
        console.log('\n══════════════════════════════════════');
        console.log(' ⏭️ STAGE 2 & 3: SKIPPED (No upstream changes)');
        console.log('══════════════════════════════════════');
      } else if (!isDryRun) {
        stageCompileAndValidate();
      }
    }

    // STAGE 4: DEPLOY
    if (['all', 'compile', 'deploy'].includes(command) && !isDryRun) {
      stageDeploy();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✨ PIPELINE FINISHED in ${elapsed}s ✨`);

  } catch (err) {
    console.error(`\n💥 PIPELINE ABORTED: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
