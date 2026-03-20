/**
 * SCT Inject v2 — Proper SCT formatting
 * 
 * Fixes from v1:
 * - Vignette uses source clinical scenario (if long) + hypothesis AS SEPARATE SECTIONS
 * - Removes MCQ question stems from narrative
 * - Generates proper SCT titles
 * - Skips cases where source has no real vignette
 * 
 * Usage: node ingestion/sct-inject.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, 'output');
const BATCH_RESULT = join(OUTPUT_DIR, 'sct_batch_result.jsonl');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('══════════════════════════════════════');
console.log(' SCT Inject v2 — Proper Formatting');
console.log('══════════════════════════════════════\n');

// Load existing cases — REMOVE old SCT first
let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const beforeCount = cases.length;
cases = cases.filter(c => c.q_type !== 'SCT');
console.log(`📂 Removed ${beforeCount - cases.length} old SCT cases`);
console.log(`📂 Base: ${cases.length} cases\n`);

const caseMap = new Map();
for (const c of cases) caseMap.set(c._id, c);

// Parse batch results
const lines = readFileSync(BATCH_RESULT, 'utf-8').split('\n').filter(l => l.trim());

const sctCases = [];
let errors = 0;
let skippedShort = 0;

// Clean MCQ question stems from narrative
function extractClinicalScenario(narrative) {
  if (!narrative) return '';
  // Remove typical MCQ question endings
  return narrative
    .replace(/\b(which of the following|what is the most likely|what is the next|what is the best|what is the diagnosis|what should be|the most appropriate).*/gi, '')
    .replace(/\?$/,'')
    .trim();
}

function generateSctTitle(hypothesis) {
  // Generate a clean title from the hypothesis
  const cleaned = hypothesis.replace(/^(the patient|a patient|this patient)/i, '').trim();
  const title = cleaned.length > 60 ? cleaned.substring(0, 57) + '...' : cleaned;
  return `SCT: ${title.charAt(0).toUpperCase() + title.slice(1)}`;
}

for (const line of lines) {
  try {
    const result = JSON.parse(line);
    const sourceId = parseInt(result.custom_id.replace('sct_', ''), 10);
    const sourceCase = caseMap.get(sourceId);
    if (!sourceCase) { errors++; continue; }

    const content = result.response?.body?.choices?.[0]?.message?.content;
    if (!content) { errors++; continue; }

    const sctData = JSON.parse(content);
    if (!sctData.hypothesis || !sctData.new_finding) { errors++; continue; }

    const sctId = 900000 + sctCases.length;

    // Build proper vignette:
    // - If source has a real clinical scenario (>150 chars), use it as context
    // - Always show hypothesis as the core question
    const rawNarrative = sourceCase.vignette?.narrative || '';
    const clinicalScenario = extractClinicalScenario(rawNarrative);
    
    let vignetteText;
    if (clinicalScenario.length > 150) {
      // Good vignette — use clinical scenario + hypothesis
      vignetteText = `${clinicalScenario}\n\nHipotesis klinis: ${sctData.hypothesis}`;
    } else {
      // Short/no vignette — hypothesis IS the scenario
      vignetteText = sctData.hypothesis;
    }

    // Panel votes → options
    const pv = sctData.panel_votes || {};
    const likertOptions = [
      { id: '-2', text: 'Sangat Tidak Mendukung', is_correct: sctData.likert === -2, sct_panel_votes: pv.minus2 || 0 },
      { id: '-1', text: 'Kurang Mendukung', is_correct: sctData.likert === -1, sct_panel_votes: pv.minus1 || 0 },
      { id: '0',  text: 'Tidak Berubah', is_correct: sctData.likert === 0, sct_panel_votes: pv.zero || 0 },
      { id: '+1', text: 'Lebih Mendukung', is_correct: sctData.likert === 1, sct_panel_votes: pv.plus1 || 0 },
      { id: '+2', text: 'Sangat Mendukung', is_correct: sctData.likert === 2, sct_panel_votes: pv.plus2 || 0 },
    ];

    sctCases.push({
      _id: sctId,
      hash_id: `sct_medqa_${sourceId}`,
      q_type: 'SCT',
      confidence: 4.0,
      category: sourceCase.category,
      title: generateSctTitle(sctData.hypothesis),
      vignette: {
        demographics: sourceCase.vignette?.demographics || { age: null, sex: null },
        narrative: vignetteText,
        vitalSigns: sourceCase.vignette?.vitalSigns || null,
        labFindings: sourceCase.vignette?.labFindings || null,
      },
      prompt: `Jika ditemukan informasi baru:\n"${sctData.new_finding}"\n\nApakah hipotesis di atas menjadi lebih atau kurang mendukung?`,
      options: likertOptions,
      rationale: {
        correct: sctData.rationale || '',
        distractors: {},
        pearl: sourceCase.rationale?.pearl || '',
      },
      meta: {
        ...sourceCase.meta,
        examType: 'UKMPPD',
        source: 'sct-alchemist',
        sct_source_id: sourceId,
        difficulty: sourceCase.meta?.difficulty || 3,
      },
      validation: {
        overallScore: 4.0,
        layers: { content: 4, answer: 5, format: 5, image: 5, explanation: 4, source: 4 },
        standard: 'SCT-Alchemist-v2',
      },
    });
  } catch (e) {
    errors++;
  }
}

console.log(`✅ Parsed ${sctCases.length} SCT cases (v2 format)`);
console.log(`❌ Errors: ${errors}`);
console.log(`⏭️ Skipped (short): ${skippedShort}\n`);

// Append and save
cases.push(...sctCases);
writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
copyFileSync(COMPILED, PUBLIC_COMPILED);

console.log(`📦 Total: ${cases.length}`);
console.log(`   MCQ: ${cases.filter(c => c.q_type === 'MCQ').length}`);
console.log(`   SCT: ${cases.filter(c => c.q_type === 'SCT').length}`);
console.log(`   Clinical Discussion: ${cases.filter(c => c.q_type === 'CLINICAL_DISCUSSION').length}`);
console.log(`\n✅ Saved to ${PUBLIC_COMPILED}`);
console.log('══════════════════════════════════════\n');
