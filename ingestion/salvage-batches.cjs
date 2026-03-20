/**
 * Salvage partial results from failed batches
 * Downloads whatever completed before billing limit hit
 * 
 * Usage: node ingestion/salvage-batches.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

async function downloadResults(batchId, label) {
  const batchRes = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  const batch = await batchRes.json();
  console.log(`\n${label}: ${batch.status} (done=${batch.request_counts?.completed}, fail=${batch.request_counts?.failed})`);
  
  if (!batch.output_file_id) {
    console.log('  No output file');
    return [];
  }
  
  const fileRes = await fetch(`https://api.openai.com/v1/files/${batch.output_file_id}/content`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  const text = await fileRes.text();
  const outFile = path.join(OUTPUT_DIR, `${label}_salvaged.jsonl`);
  fs.writeFileSync(outFile, text, 'utf-8');
  
  const results = text.trim().split('\n').map(line => {
    try {
      const obj = JSON.parse(line);
      const content = obj.response?.body?.choices?.[0]?.message?.content;
      let parsed = null;
      try { parsed = JSON.parse(content); } catch {}
      return { custom_id: obj.custom_id, parsed };
    } catch { return null; }
  }).filter(r => r && r.parsed);
  
  console.log(`  Salvaged: ${results.length} valid results`);
  return results;
}

(async () => {
  console.log('=== Salvage Partial Batch Results ===');
  
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
  const caseMap = new Map(cases.map(c => [String(c._id), c]));

  let totalFatal = 0, totalMinor = 0, totalNone = 0, totalSalvaged = 0;

  // Try to salvage from chunks with partial results
  const salvageTargets = ['hack1_chunk1', 'hack1_chunk4'];
  
  for (const target of salvageTargets) {
    const batchId = manifest.batches[target];
    if (!batchId) continue;
    
    const results = await downloadResults(batchId, target);
    
    for (const r of results) {
      if (!r.parsed) continue;
      const caseId = r.custom_id.replace('fase2_', '');
      const c = caseMap.get(caseId);
      if (!c) continue;
      
      const severity = (r.parsed.severity || '').toUpperCase();
      if (!c.meta) c.meta = {};
      c.meta.fase2_verdict = severity;
      c.meta.fase2_reasoning = r.parsed.reasoning || '';
      
      if (severity === 'FATAL') {
        totalFatal++;
        c.meta.fase2_quarantine = true;
        if (r.parsed.correct_answer) c.meta.fase2_suggested_answer = r.parsed.correct_answer;
      } else if (severity === 'MINOR') {
        totalMinor++;
      } else {
        totalNone++;
      }
      totalSalvaged++;
    }
  }
  
  if (totalSalvaged > 0) {
    fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
    fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
  }
  
  // Summary
  const allAudited = cases.filter(c => c.meta?.fase2_verdict);
  const allFatal = cases.filter(c => c.meta?.fase2_verdict === 'FATAL');
  
  console.log('\n=== TOTAL FASE 2 AUDIT STATUS ===');
  console.log(`Salvaged this run: ${totalSalvaged} (FATAL=${totalFatal}, MINOR=${totalMinor}, NONE=${totalNone})`);
  console.log(`Total audited: ${allAudited.length} / 33,698 MedMCQA`);
  console.log(`Total FATAL: ${allFatal.length} (${(allFatal.length/allAudited.length*100).toFixed(1)}%)`);
  console.log(`Remaining unaudited: ${33698 - allAudited.length}`);
  console.log('Done!');
})();
