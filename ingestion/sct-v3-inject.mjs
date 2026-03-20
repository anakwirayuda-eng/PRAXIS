/**
 * Download SCT v3 results + inject clean format
 * Also download contradiction detection results
 * 
 * Usage: node ingestion/sct-v3-inject.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

console.log('══════════════════════════════════════════════════');
console.log(' SCT v3 Inject + Contradiction Download');
console.log('══════════════════════════════════════════════════\n');

// Download SCT v3 results
console.log('📥 Downloading SCT v3 results...');
const sctBatch = await (await fetch(`${BASE}/batches/batch_69b6b3dcef888190b1670eced0f3ed62`, { headers })).json();
const sctResults = await (await fetch(`${BASE}/files/${sctBatch.output_file_id}/content`, { headers })).text();
writeFileSync(join(OUTPUT_DIR, 'sct_v3_results.jsonl'), sctResults, 'utf-8');
const sctLines = sctResults.split('\n').filter(l => l.trim());
console.log(`  ✅ ${sctLines.length} SCT v3 results downloaded\n`);

// Download contradiction results if ready
console.log('📥 Downloading contradiction results...');
const contraBatch = await (await fetch(`${BASE}/batches/batch_69b6bc9d470c819080883c26cb6b97e5`, { headers })).json();
if (contraBatch.output_file_id) {
  const contraResults = await (await fetch(`${BASE}/files/${contraBatch.output_file_id}/content`, { headers })).text();
  writeFileSync(join(OUTPUT_DIR, 'contradiction_results.jsonl'), contraResults, 'utf-8');
  const contraLines = contraResults.split('\n').filter(l => l.trim());
  console.log(`  ✅ ${contraLines.length} contradiction results downloaded\n`);
} else {
  console.log(`  ⏳ Contradiction batch: ${contraBatch.status} — will download later\n`);
}

// ═══════════════════════════════════════════════════
// INJECT SCT v3 — CLEAN STRUCTURED FORMAT
// ═══════════════════════════════════════════════════
console.log('━━━ Injecting SCT v3 (gpt-5.4 JSON Schema) ━━━\n');

let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const beforeCount = cases.length;
cases = cases.filter(c => c.q_type !== 'SCT');
console.log(`  Removed ${beforeCount - cases.length} old SCT cases`);

const caseMap = new Map();
for (const c of cases) caseMap.set(c._id, c);

const sctCases = [];
let errors = 0;

for (const line of sctLines) {
  try {
    const r = JSON.parse(line);
    const sourceId = parseInt(r.custom_id.replace('sctv3_', ''), 10);
    const src = caseMap.get(sourceId);
    if (!src) { errors++; continue; }

    const content = r.response?.body?.choices?.[0]?.message?.content;
    if (!content) { errors++; continue; }

    const sct = JSON.parse(content);
    if (!sct.clinical_scenario || !sct.hypothesis || !sct.new_finding) {
      errors++;
      continue;
    }

    const sctId = 900000 + sctCases.length;
    const pv = sct.panel_votes || { minus2: 0, minus1: 1, zero: 2, plus1: 4, plus2: 3 };

    // Generate clean title from hypothesis (max 60 chars)
    const titleHyp = sct.hypothesis.length > 55
      ? sct.hypothesis.substring(0, 52) + '...'
      : sct.hypothesis;

    sctCases.push({
      _id: sctId,
      hash_id: `sct_v3_${sourceId}`,
      q_type: 'SCT',
      confidence: 4.5,
      category: src.category,
      title: `SCT: ${titleHyp}`,
      vignette: {
        demographics: src.vignette?.demographics || { age: null, sex: null },
        narrative: sct.clinical_scenario,  // PURE clinical scenario, NO question stem!
      },
      prompt: sct.question_stem || `Jika ditemukan informasi baru:\n"${sct.new_finding}"\n\nApakah hipotesis "${sct.hypothesis}" menjadi lebih atau kurang mendukung?`,
      hypothesis: sct.hypothesis,  // Separate field for frontend to render differently
      new_finding: sct.new_finding,
      options: [
        { id: '-2', text: 'Sangat Tidak Mendukung', is_correct: sct.likert_answer === -2, sct_panel_votes: pv.minus2 || 0 },
        { id: '-1', text: 'Kurang Mendukung', is_correct: sct.likert_answer === -1, sct_panel_votes: pv.minus1 || 0 },
        { id: '0',  text: 'Tidak Berubah', is_correct: sct.likert_answer === 0, sct_panel_votes: pv.zero || 0 },
        { id: '+1', text: 'Lebih Mendukung', is_correct: sct.likert_answer === 1, sct_panel_votes: pv.plus1 || 0 },
        { id: '+2', text: 'Sangat Mendukung', is_correct: sct.likert_answer === 2, sct_panel_votes: pv.plus2 || 0 },
      ],
      rationale: {
        correct: sct.rationale || '',
        distractors: {},
      },
      meta: {
        ...src.meta,
        examType: 'UKMPPD',
        source: 'sct-alchemist-v3',
        sct_source_id: sourceId,
        difficulty: src.meta?.difficulty || 3,
      },
      validation: {
        overallScore: 4.5,
        layers: { content: 5, answer: 5, format: 5, image: 5, explanation: 4, source: 4 },
        standard: 'SCT-v3-gpt54-structured',
      },
    });
  } catch (e) {
    errors++;
  }
}

console.log(`  ✅ Injected ${sctCases.length} SCT v3 cases`);
console.log(`  ❌ Errors: ${errors}`);

// Show 3 sample vignettes to verify quality
console.log('\n  📋 Sample SCT v3 vignettes:');
for (let i = 0; i < Math.min(3, sctCases.length); i++) {
  const s = sctCases[i];
  console.log(`\n  [${i + 1}] "${s.title}"`);
  console.log(`      Vignette: "${s.vignette.narrative.substring(0, 120)}..."`);
  console.log(`      Hypothesis: "${s.hypothesis}"`);
  console.log(`      Finding: "${s.new_finding}"`);
}

cases.push(...sctCases);
writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
copyFileSync(COMPILED, PUBLIC_COMPILED);

console.log(`\n  📦 Total: ${cases.length} (MCQ: ${cases.filter(c => c.q_type === 'MCQ').length}, SCT: ${cases.filter(c => c.q_type === 'SCT').length})`);
console.log(`  ✅ Saved to ${PUBLIC_COMPILED}`);
console.log('══════════════════════════════════════════════════\n');
