/**
 * Resubmit ONLY the failed batches (chunks 1-3 + hack5)
 * Regenerates JSONL for failed cases only (skip already-audited ones)
 * 
 * Usage: node ingestion/resubmit-failed.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');

console.log('=== Resubmit Failed Batches ===\n');

const cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));

// Find MedMCQA cases that haven't been FASE 2 audited yet
const unaudited = cases.filter(c =>
  c.meta?.source === 'medmcqa' &&
  !c.meta?.fase2_verdict &&
  c.options?.length >= 2 &&
  c.options.some(o => o.is_correct)
);
console.log(`Unaudited MedMCQA: ${unaudited.length}`);

// Generate FASE 2 JSONL (chunks of 8000)
const CHUNK_SIZE = 8000;
const chunks = [];
for (let i = 0; i < unaudited.length; i += CHUNK_SIZE) {
  chunks.push(unaudited.slice(i, i + CHUNK_SIZE));
}
console.log(`Chunks needed: ${chunks.length}\n`);

const chunkFiles = chunks.map((chunk, idx) => {
  const lines = chunk.map(c => {
    const optStr = c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' ✓' : ''}`).join('\n');
    return JSON.stringify({
      custom_id: `fase2_${c._id}`,
      method: 'POST', url: '/v1/chat/completions',
      body: {
        model: 'o4-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a medical exam auditor. Check if the marked answer (✓) is medically correct. Output JSON: {"severity":"FATAL|MINOR|NONE","reasoning":"brief","correct_answer":"A-E if different"}' },
          { role: 'user', content: `Q: ${c.vignette?.narrative || c.title}\n\n${optStr}` },
        ]
      }
    });
  });
  const file = path.join(OUTPUT_DIR, `resubmit_chunk${idx}.jsonl`);
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  return { file, count: lines.length, idx };
});

// Hack 5: contradiction sweep on GPT-generated explanations (skip already-checked)
const hack5Cases = cases.filter(c =>
  c.rationale?.correct &&
  c.rationale.correct.length > 50 &&
  !c.meta?.hack5_checked &&
  c.options?.some(o => o.is_correct)
);
console.log(`Hack 5 candidates: ${hack5Cases.length}`);
const hack5Lines = hack5Cases.slice(0, 9065).map(c => {
  const correctOpt = c.options.find(o => o.is_correct);
  return JSON.stringify({
    custom_id: `h5_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Check if the explanation contradicts the marked correct answer. Output JSON: {"contradiction":true|false,"detail":"brief"}' },
        { role: 'user', content: `Answer: ${correctOpt?.id}. ${correctOpt?.text}\n\nExplanation: ${c.rationale.correct.substring(0, 500)}` },
      ]
    }
  });
});
const hack5File = path.join(OUTPUT_DIR, 'resubmit_hack5.jsonl');
fs.writeFileSync(hack5File, hack5Lines.join('\n'), 'utf-8');

// Submit all
async function uploadAndSubmit(filePath, label) {
  console.log(`\nSubmitting ${label}...`);
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  formData.append('purpose', 'batch');
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}` }, body: formData,
  });
  if (!uploadRes.ok) { console.log(`  Upload fail: ${(await uploadRes.text()).substring(0,150)}`); return null; }
  const upload = await uploadRes.json();
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  });
  if (!batchRes.ok) { console.log(`  Batch fail: ${(await batchRes.text()).substring(0,200)}`); return null; }
  const batch = await batchRes.json();
  console.log(`  ✅ ${batch.id} (${batch.status})`);
  return batch.id;
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));

  for (const c of chunkFiles) {
    manifest.batches[`resubmit_chunk${c.idx}`] = await uploadAndSubmit(c.file, `FASE 2 Chunk ${c.idx} (${c.count})`);
  }
  manifest.batches.resubmit_hack5 = await uploadAndSubmit(hack5File, `Hack 5 (${hack5Lines.length})`);
  manifest.timestamp_resubmit = new Date().toISOString();

  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));
  console.log('\n=== Manifest Updated ===');
  const newBatches = Object.entries(manifest.batches).filter(([k]) => k.startsWith('resubmit'));
  for (const [k, v] of newBatches) console.log(`  ${k}: ${v}`);
  console.log('Done!');
})();
