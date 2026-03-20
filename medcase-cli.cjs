#!/usr/bin/env node
/**
 * MedCase Pro — Unified CLI
 * 
 * Consolidates 39+ one-off scripts into a single entry point.
 * 
 * Usage:
 *   node medcase-cli.js <command> [options]
 * 
 * Commands:
 *   stats         Show dataset statistics
 *   audit         Run deep quality audit
 *   batch-status  Check OpenAI batch statuses
 *   batch-download Download completed batch results
 *   images        Extract/process images (WorldMedQA-V, PDF)
 *   wire-images   Wire PDF images to UKMPPD questions
 *   labels        Add/update source labels
 *   fix           Auto-fix structural issues from audit
 *   help          Show this help
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'ingestion', 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, 'public', 'data', 'compiled_cases.json');
const MANIFEST = path.join(OUTPUT_DIR, 'god_tier_batches.json');

// Load API key — bulletproof regex (handles quotes, whitespace, \r)
function getApiKey() {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    const match = envFile.match(/^OPENAI_API_KEY\s*=\s*['"]?([^'"\r\n]+)['"]?/m);
    return match ? match[1].trim() : null;
  } catch (e) {
    console.log('⚠️ File .env tidak ditemukan!');
    return null;
  }
}

function loadCases() {
  return JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
}

function saveCases(cases) {
  // ATOMIC SAVE: Write to .tmp then rename (prevents 0-byte corruption on crash)
  const TMP_COMPILED = `${COMPILED}.tmp`;
  fs.writeFileSync(TMP_COMPILED, JSON.stringify(cases), 'utf-8');
  fs.renameSync(TMP_COMPILED, COMPILED);

  // PAYLOAD OPTIMIZER: Only send clean cases to React frontend
  const frontendCases = cases.filter(c => {
    if (c.meta?.quarantined) return false;
    if (c.meta?.quarantine_flag) return false;
    return true;
  });

  const TMP_PUBLIC = `${PUBLIC_COMPILED}.tmp`;
  fs.writeFileSync(TMP_PUBLIC, JSON.stringify(frontendCases), 'utf-8');
  fs.renameSync(TMP_PUBLIC, PUBLIC_COMPILED);

  console.log(`\n🛡️ Master: ${cases.length.toLocaleString()} cases`);
  console.log(`🚀 Frontend: ${frontendCases.length.toLocaleString()} clean cases (${(cases.length - frontendCases.length).toLocaleString()} blocked)`);
}

// ═══════════════════════════════════════════════════
// COMMAND: stats
// ═══════════════════════════════════════════════════
function cmdStats() {
  const cases = loadCases();
  const sources = {};
  let withImages = 0, verified = 0, translated = 0, audited = 0, fatal = 0, quarantined = 0;
  
  for (const c of cases) {
    const src = c.meta?.source || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
    if (c.images?.length > 0) withImages++;
    if (c.meta?.hasVerifiedAnswer) verified++;
    if (c.meta?.translated) translated++;
    if (c.meta?.fase2_verdict) { audited++; if (c.meta.fase2_verdict === 'FATAL') fatal++; }
    if (c.meta?.quarantined || c.meta?.quarantine_flag) quarantined++;
  }

  console.log('═══ MedCase Pro Dataset Stats ═══\n');
  console.log(`Total cases:         ${cases.length.toLocaleString()}`);
  console.log(`Cases with images:   ${withImages}`);
  console.log(`Verified answers:    ${verified}`);
  console.log(`Translated (FR→EN):  ${translated}`);
  console.log(`FASE 2 audited:      ${audited} (FATAL: ${fatal}, ${(fatal/Math.max(audited,1)*100).toFixed(1)}%)`);
  console.log(`Quarantined:         ${quarantined} (hidden from frontend)`);
  console.log(`\nSource breakdown:`);
  for (const [src, count] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(30)} ${count.toLocaleString()}`);
  }
}

// ═══════════════════════════════════════════════════
// COMMAND: audit
// ═══════════════════════════════════════════════════
function cmdAudit() {
  console.log('Running deep audit... (delegating to deep-audit.mjs)');
  require('child_process').execSync('node ingestion/deep-audit.mjs', { stdio: 'inherit', cwd: __dirname });
}

// ═══════════════════════════════════════════════════
// COMMAND: batch-status
// ═══════════════════════════════════════════════════
async function cmdBatchStatus() {
  const API_KEY = getApiKey();
  if (!fs.existsSync(MANIFEST)) { console.log('No batch manifest found.'); return; }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const batches = manifest.batches || {};

  console.log('═══ OpenAI Batch Status ═══\n');
  for (const [name, id] of Object.entries(batches)) {
    if (!id) continue;
    try {
      const r = await (await fetch(`https://api.openai.com/v1/batches/${id}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      })).json();
      const rc = r.request_counts || {};
      const status = r.status || 'unknown';
      const icon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : status === 'in_progress' ? '🔄' : '⏳';
      console.log(`${icon} ${name.padEnd(25)} ${status.padEnd(14)} done=${String(rc.completed||0).padStart(6)} fail=${String(rc.failed||0).padStart(5)} total=${String(rc.total||0).padStart(6)}`);
    } catch (e) {
      console.log(`❓ ${name}: error checking`);
    }
  }
}

// ═══════════════════════════════════════════════════
// COMMAND: batch-download
// ═══════════════════════════════════════════════════
async function cmdBatchDownload() {
  console.log('Downloading completed batches... (delegating to sweep-results.cjs)');
  require('child_process').execSync('node ingestion/sweep-results.cjs', { stdio: 'inherit', cwd: __dirname });
}

// ═══════════════════════════════════════════════════
// COMMAND: images
// ═══════════════════════════════════════════════════
function cmdImages() {
  console.log('Running image pipeline... (delegating to extract-images.cjs)');
  require('child_process').execSync('node ingestion/extract-images.cjs', { stdio: 'inherit', cwd: __dirname });
}

// ═══════════════════════════════════════════════════
// COMMAND: wire-images
// ═══════════════════════════════════════════════════
function cmdWireImages() {
  console.log('Wiring PDF images to questions... (delegating to wire-pdf-images.cjs)');
  require('child_process').execSync('node ingestion/wire-pdf-images.cjs', { stdio: 'inherit', cwd: __dirname });
}

// ═══════════════════════════════════════════════════
// COMMAND: labels
// ═══════════════════════════════════════════════════
function cmdLabels() {
  console.log('Updating source labels... (delegating to add-source-labels.cjs)');
  require('child_process').execSync('node ingestion/add-source-labels.cjs', { stdio: 'inherit', cwd: __dirname });
}

// ═══════════════════════════════════════════════════
// COMMAND: fix — Auto-fix structural issues
// ═══════════════════════════════════════════════════
function cmdFix() {
  console.log('═══ Auto-Fix Structural Issues ═══\n');
  let cases = loadCases();
  let fixes = { title: 0, prompt: 0, markdown: 0, ansPrefix: 0, examType: 0, duplicateNarrative: 0, phantomImage: 0 };

  const seenNarratives = new Map();

  for (const c of cases) {
    // Fix missing title
    if (!c.title && c.vignette?.narrative) {
      c.title = c.vignette.narrative.substring(0, 80) + (c.vignette.narrative.length > 80 ? '...' : '');
      fixes.title++;
    }

    // Fix missing prompt
    if (!c.prompt) {
      c.prompt = c.q_type === 'MCQ' ? 'Choose the correct answer.' : '';
      fixes.prompt++;
    }

    // Clean markdown from narrative
    if (c.vignette?.narrative) {
      const cleaned = c.vignette.narrative
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → bold
        .replace(/__([^_]+)__/g, '$1');       // __italic__ → italic
      if (cleaned !== c.vignette.narrative) {
        c.vignette.narrative = cleaned;
        fixes.markdown++;
      }
    }

    // Clean "Ans. X" prefix from explanations
    if (c.rationale?.correct) {
      const cleaned = c.rationale.correct.replace(/^Ans\.\s*[A-Za-z]\.?\s*/i, '');
      if (cleaned !== c.rationale.correct) {
        c.rationale.correct = cleaned;
        fixes.ansPrefix++;
      }
    }

    // Fix unknown examType → 'BOTH'
    const VALID = new Set(['USMLE', 'UKMPPD', 'MIR-Spain', 'Academic', 'Research', 'Clinical', 'BOTH', 'International']);
    if (c.meta?.examType && !VALID.has(c.meta.examType)) {
      c.meta.examType = 'BOTH';
      fixes.examType++;
    }

    // HARD QUARANTINE: Duplicate narratives (strip non-alphanum for typo-resistant matching)
    const nKey = (c.vignette?.narrative || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 150);
    if (nKey.length > 50) {
      if (seenNarratives.has(nKey)) {
        c.meta = c.meta || {};
        c.meta.quarantine_flag = true;
        c.meta.quarantine_reason = 'DUPLICATE_NARRATIVE';
        fixes.duplicateNarrative++;
      } else {
        seenNarratives.set(nKey, c._id);
      }
    }

    // HARD QUARANTINE: Phantom images (question references image but none attached)
    const textToCheck = ((c.vignette?.narrative || '') + ' ' + (c.prompt || '')).toLowerCase();
    const needsImage = /(perhatikan gambar|gambar berikut|rontgen|ekg|ct scan|mri|tampak pada gambar|shown in the image|following image|radiograph|x-ray shown)/i.test(textToCheck);
    if (needsImage && (!c.images || c.images.length === 0)) {
      c.meta = c.meta || {};
      c.meta.quarantine_flag = true;
      c.meta.quarantine_reason = 'PHANTOM_IMAGE';
      fixes.phantomImage++;
    }
  }

  saveCases(cases);
  console.log('Fixes applied:');
  for (const [k, v] of Object.entries(fixes)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }
  console.log('\nDone!');
}

// ═══════════════════════════════════════════════════
// COMMAND: help
// ═══════════════════════════════════════════════════
function cmdHelp() {
  console.log(`
MedCase Pro CLI — Unified Pipeline Tool

Usage: node medcase-cli.js <command>

Commands:
  stats           Show dataset statistics (sources, counts, quality)
  audit           Run deep quality audit on all cases
  batch-status    Check status of all OpenAI batch jobs
  batch-download  Download and inject completed batch results
  images          Extract images (WorldMedQA-V + PDF)
  wire-images     Wire PDF images to matching questions
  labels          Update source labels on all cases
  fix             Auto-fix structural issues (titles, markdown, etc.)
  help            Show this help

Examples:
  node medcase-cli.js stats
  node medcase-cli.js audit
  node medcase-cli.js batch-status
  node medcase-cli.js fix
`);
}

// ═══════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════
const command = process.argv[2] || 'help';
const COMMANDS = {
  stats: cmdStats,
  audit: cmdAudit,
  'batch-status': cmdBatchStatus,
  'batch-download': cmdBatchDownload,
  images: cmdImages,
  'wire-images': cmdWireImages,
  labels: cmdLabels,
  fix: cmdFix,
  help: cmdHelp,
};

if (COMMANDS[command]) {
  const result = COMMANDS[command]();
  if (result instanceof Promise) result.catch(e => console.error(e));
} else {
  console.log(`Unknown command: ${command}\n`);
  cmdHelp();
}
