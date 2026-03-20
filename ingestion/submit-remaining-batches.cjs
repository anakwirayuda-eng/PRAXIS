/**
 * Submit remaining Hack 1 chunks (25K MedMCQA) + Hack 5 retry with gpt-4o-mini
 * 
 * Usage: node ingestion/submit-remaining-batches.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');

async function uploadAndSubmit(filePath, label) {
  console.log(`\n=== ${label} ===`);
  const fileData = fs.readFileSync(filePath);
  
  const formData = new FormData();
  formData.append('file', new Blob([fileData]), path.basename(filePath));
  formData.append('purpose', 'batch');
  
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  if (!uploadRes.ok) { console.log(`  Upload fail: ${(await uploadRes.text()).substring(0,150)}`); return null; }
  const upload = await uploadRes.json();
  console.log(`  File: ${upload.id}`);
  
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  });
  if (!batchRes.ok) { console.log(`  Batch fail: ${(await batchRes.text()).substring(0,150)}`); return null; }
  const batch = await batchRes.json();
  console.log(`  Batch: ${batch.id} (${batch.status})`);
  return batch.id;
}

(async () => {
  console.log('=== Submit Remaining Batches ===\n');
  
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  const newBatches = {};
  
  // Submit Hack 1 chunks 1-4
  for (let i = 1; i <= 4; i++) {
    const file = path.join(OUTPUT_DIR, `hack1_fase2_chunk${i}.jsonl`);
    if (fs.existsSync(file)) {
      const lineCount = fs.readFileSync(file, 'utf-8').trim().split('\n').length;
      newBatches[`hack1_chunk${i}`] = await uploadAndSubmit(file, `FASE 2 Chunk ${i} (${lineCount} prompts)`);
    }
  }
  
  // Resubmit Hack 5 with gpt-4o-mini (gpt-5-nano hit token limit)
  const hack5File = path.join(OUTPUT_DIR, 'hack5_nanonuke.jsonl');
  if (fs.existsSync(hack5File)) {
    // Rewrite to use gpt-4o-mini instead of gpt-5-nano
    const lines = fs.readFileSync(hack5File, 'utf-8').trim().split('\n');
    const rewritten = lines.map(line => {
      const obj = JSON.parse(line);
      obj.body.model = 'gpt-4o-mini';
      return JSON.stringify(obj);
    });
    const rewrittenFile = path.join(OUTPUT_DIR, 'hack5_nanonuke_4omini.jsonl');
    fs.writeFileSync(rewrittenFile, rewritten.join('\n'), 'utf-8');
    newBatches.hack5_retry = await uploadAndSubmit(rewrittenFile, `Nano-Nuke Retry (${lines.length} → gpt-4o-mini)`);
  }
  
  // Update manifest
  manifest.batches = { ...manifest.batches, ...newBatches };
  manifest.timestamp_remaining = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));
  
  console.log('\n=== Updated Manifest ===');
  console.log(JSON.stringify(manifest.batches, null, 2));
  console.log('\nDone!');
})();
