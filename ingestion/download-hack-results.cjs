/**
 * Download and inject God-Tier Hack batch results
 * - Hack 2: UKMPPD Oracle (answer keys + explanations)
 * - Hack 1: FASE 2 MedMCQA audit (FATAL/MINOR/NONE)
 *
 * Usage: node ingestion/download-hack-results.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

async function downloadBatchResults(batchId, label) {
  console.log(`\n--- ${label} (${batchId}) ---`);
  
  // Get batch info
  const batchRes = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  const batch = await batchRes.json();
  console.log(`  Status: ${batch.status}`);
  console.log(`  Completed: ${batch.request_counts?.completed}/${batch.request_counts?.total}`);
  
  if (!batch.output_file_id) {
    console.log('  No output file yet');
    return null;
  }
  
  // Download output
  const fileRes = await fetch(`https://api.openai.com/v1/files/${batch.output_file_id}/content`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  const text = await fileRes.text();
  
  const outputFile = path.join(OUTPUT_DIR, `${label.replace(/\s+/g, '_').toLowerCase()}_results.jsonl`);
  fs.writeFileSync(outputFile, text, 'utf-8');
  
  // Parse results
  const results = text.trim().split('\n').map(line => {
    try {
      const obj = JSON.parse(line);
      const content = obj.response?.body?.choices?.[0]?.message?.content;
      let parsed = null;
      try { parsed = JSON.parse(content); } catch {}
      return { custom_id: obj.custom_id, parsed, raw: content };
    } catch { return null; }
  }).filter(Boolean);
  
  console.log(`  Downloaded: ${results.length} results → ${outputFile}`);
  return results;
}

(async () => {
  console.log('=== Download God-Tier Hack Results ===\n');
  
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
  const caseMap = new Map(cases.map(c => [String(c._id), c]));
  
  // ═══ HACK 2: UKMPPD Oracle ═══
  if (manifest.batches.hack2) {
    const results = await downloadBatchResults(manifest.batches.hack2, 'hack2_ukmppd_oracle');
    if (results) {
      let updated = 0, errors = 0;
      for (const r of results) {
        if (!r.parsed) { errors++; continue; }
        const caseId = r.custom_id.replace('ukmppd_oracle_', '');
        const c = caseMap.get(caseId);
        if (!c) continue;
        
        // Update answer key
        if (r.parsed.correct_answer) {
          const correctLetter = r.parsed.correct_answer.toUpperCase();
          for (const opt of c.options) {
            opt.is_correct = opt.id === correctLetter;
          }
          c.meta.hasVerifiedAnswer = true;
          c.meta.answerSource = 'gpt-5.4-oracle';
          c.confidence = r.parsed.confidence || 4.0;
          c.validation.layers.answer = 4;
        }
        
        // Update explanation
        if (r.parsed.explanation) {
          c.rationale.correct = r.parsed.explanation;
          c.validation.layers.explanation = 4;
        }
        
        // Update category if provided
        if (r.parsed.category) {
          c.category = r.parsed.category;
        }
        
        updated++;
      }
      console.log(`  UKMPPD Oracle: ${updated} updated, ${errors} parse errors`);
    }
  }
  
  // ═══ HACK 1: FASE 2 MedMCQA Audit ═══
  if (manifest.batches.hack1_chunk0) {
    const results = await downloadBatchResults(manifest.batches.hack1_chunk0, 'hack1_fase2_chunk0');
    if (results) {
      let fatal = 0, minor = 0, none = 0, errors = 0;
      for (const r of results) {
        if (!r.parsed) { errors++; continue; }
        const caseId = r.custom_id.replace('fase2_', '');
        const c = caseMap.get(caseId);
        if (!c) continue;
        
        const severity = (r.parsed.severity || '').toUpperCase();
        if (!c.meta) c.meta = {};
        c.meta.fase2_verdict = severity;
        c.meta.fase2_reasoning = r.parsed.reasoning || '';
        
        if (severity === 'FATAL') {
          fatal++;
          c.meta.fase2_quarantine = true;
          // Update correct answer if model provided one
          if (r.parsed.correct_answer) {
            c.meta.fase2_suggested_answer = r.parsed.correct_answer;
          }
        } else if (severity === 'MINOR') {
          minor++;
        } else {
          none++;
        }
      }
      console.log(`  FASE 2 Chunk 0: FATAL=${fatal}, MINOR=${minor}, NONE=${none}, errors=${errors}`);
      console.log(`  FATAL rate: ${(fatal / (fatal + minor + none) * 100).toFixed(1)}%`);
    }
  }
  
  // Save
  fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
  
  console.log(`\n📦 Saved. Total cases: ${cases.length.toLocaleString()}`);
  console.log(`  UKMPPD with verified answers: ${cases.filter(c => c.meta?.examType === 'UKMPPD' && c.meta?.hasVerifiedAnswer).length}`);
  console.log('Done!');
})();
