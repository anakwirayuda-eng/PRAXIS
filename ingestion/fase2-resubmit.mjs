/**
 * FASE 2 Resubmit — Split 33K into smaller batches to avoid token limit
 * OpenAI limit: 5M enqueued tokens per model
 * ~150 tokens per request × 10,000 = ~1.5M tokens per batch (safe)
 * 
 * Usage: node ingestion/fase2-resubmit.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

console.log('══════════════════════════════════════════════════');
console.log(' FASE 2 RESUBMIT — Split into chunks');
console.log('══════════════════════════════════════════════════\n');

// Read the original batch file
const allLines = readFileSync(join(OUTPUT_DIR, 'fase2_medmcqa_audit.jsonl'), 'utf-8')
  .split('\n').filter(l => l.trim());

console.log(`📋 Total prompts: ${allLines.length.toLocaleString()}`);

const CHUNK_SIZE = 8000; // ~1.2M tokens per chunk (safe under 5M limit)
const chunks = [];
for (let i = 0; i < allLines.length; i += CHUNK_SIZE) {
  chunks.push(allLines.slice(i, i + CHUNK_SIZE));
}

console.log(`📦 Splitting into ${chunks.length} batches of ~${CHUNK_SIZE}\n`);

const batchIds = [];

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  const chunkFile = join(OUTPUT_DIR, `fase2_chunk_${i}.jsonl`);
  writeFileSync(chunkFile, chunk.join('\n'), 'utf-8');

  console.log(`  📤 Uploading chunk ${i + 1}/${chunks.length} (${chunk.length} prompts)...`);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(chunkFile)]), `fase2_chunk_${i}.jsonl`);
  form.append('purpose', 'batch');
  const upload = await (await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: form,
  })).json();

  if (upload.error) {
    console.error(`  ❌ Upload failed: ${upload.error.message}`);
    continue;
  }

  const batch = await (await fetch(`${BASE}/batches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: upload.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  })).json();

  if (batch.error) {
    console.error(`  ❌ Batch failed: ${batch.error.message}`);
    continue;
  }

  batchIds.push({ chunk: i, id: batch.id, count: chunk.length, status: batch.status });
  console.log(`  ✅ Batch ${i + 1}: ${batch.id} (${batch.status})\n`);

  // Wait 2s between submissions to avoid rate limits
  if (i < chunks.length - 1) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

// Save batch info
writeFileSync(join(OUTPUT_DIR, 'fase2_batch_chunks.json'), JSON.stringify(batchIds, null, 2), 'utf-8');

console.log('══════════════════════════════════════════════════');
console.log(' FASE 2 RESUBMITTED');
console.log('══════════════════════════════════════════════════');
for (const b of batchIds) {
  console.log(`  Chunk ${b.chunk}: ${b.id} (${b.count} prompts, ${b.status})`);
}
console.log(`  Total: ${batchIds.reduce((s, b) => s + b.count, 0).toLocaleString()} prompts`);
console.log(`  Saved: fase2_batch_chunks.json`);
console.log('══════════════════════════════════════════════════\n');
