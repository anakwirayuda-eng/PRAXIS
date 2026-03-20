/**
 * Download Sprint 3+4 results + Run Sprint 1+2 as direct API calls
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

// ═══════════════════════════════════════
// DOWNLOAD SPRINT 3+4 RESULTS FROM COMPLETED BATCHES
// ═══════════════════════════════════════
const BATCH_IDS = {
  sprint3: 'batch_69b691f41bb08190a2d36713e9220347',
  sprint4: 'batch_69b691f7c7ac819094fb0f68e8d0eaea',
};

console.log('══════════════════════════════════════');
console.log(' Downloading Sprint 3+4 + Direct Sprint 1+2');
console.log('══════════════════════════════════════\n');

for (const [name, batchId] of Object.entries(BATCH_IDS)) {
  console.log(`📥 Downloading ${name}...`);
  const batchResp = await fetch(`${BASE}/batches/${batchId}`, { headers });
  const batch = await batchResp.json();
  
  if (batch.status !== 'completed') {
    console.log(`  ⏳ ${name}: ${batch.status} — skipping`);
    continue;
  }
  
  const fileResp = await fetch(`${BASE}/files/${batch.output_file_id}/content`, { headers });
  const text = await fileResp.text();
  const outFile = name === 'sprint3' ? 'result_explain_headqa.jsonl' : 'result_explain_mmlu.jsonl';
  writeFileSync(join(OUTPUT_DIR, outFile), text, 'utf-8');
  const lines = text.split('\n').filter(l => l.trim());
  console.log(`  ✅ ${lines.length} results → ${outFile}\n`);
}

// ═══════════════════════════════════════
// SPRINT 1: 8 CONFLICTS — Direct API calls
// ═══════════════════════════════════════
console.log('🔴 Sprint 1: Running 8 conflict resolutions (direct)...');
const conflictFile = join(OUTPUT_DIR, 'conflicts.jsonl');
if (existsSync(conflictFile)) {
  const conflictLines = readFileSync(conflictFile, 'utf-8').split('\n').filter(l => l.trim());
  const results1 = [];
  for (const line of conflictLines) {
    const req = JSON.parse(line);
    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await resp.json();
      results1.push(JSON.stringify({ custom_id: req.custom_id, response: { body: data } }));
      process.stdout.write('✓');
    } catch (e) {
      results1.push(JSON.stringify({ custom_id: req.custom_id, response: { body: { error: e.message } } }));
      process.stdout.write('✗');
    }
  }
  writeFileSync(join(OUTPUT_DIR, 'result_conflicts.jsonl'), results1.join('\n'), 'utf-8');
  console.log(`\n  ✅ ${results1.length} conflicts resolved\n`);
} else {
  console.log('  ⏭️ No conflicts file found\n');
}

// ═══════════════════════════════════════
// SPRINT 2: 500 SPOTCHECK — Direct API calls (with rate limiting)
// ═══════════════════════════════════════
console.log('🔍 Sprint 2: Running 500 MedMCQA spot-checks (direct, ~3 min)...');
const spotcheckFile = join(OUTPUT_DIR, 'spotcheck.jsonl');
if (existsSync(spotcheckFile)) {
  const spotLines = readFileSync(spotcheckFile, 'utf-8').split('\n').filter(l => l.trim());
  const results2 = [];
  let done = 0;
  
  // Process in batches of 10 concurrent
  for (let i = 0; i < spotLines.length; i += 10) {
    const chunk = spotLines.slice(i, i + 10);
    const promises = chunk.map(async (line) => {
      const req = JSON.parse(line);
      try {
        const resp = await fetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        });
        const data = await resp.json();
        return JSON.stringify({ custom_id: req.custom_id, response: { body: data } });
      } catch (e) {
        return JSON.stringify({ custom_id: req.custom_id, response: { body: { error: e.message } } });
      }
    });
    
    const results = await Promise.all(promises);
    results2.push(...results);
    done += chunk.length;
    if (done % 50 === 0) console.log(`  Progress: ${done}/${spotLines.length}`);
  }
  
  writeFileSync(join(OUTPUT_DIR, 'result_spotcheck.jsonl'), results2.join('\n'), 'utf-8');
  console.log(`  ✅ ${results2.length} spot-checks complete\n`);
} else {
  console.log('  ⏭️ No spotcheck file found\n');
}

console.log('══════════════════════════════════════');
console.log(' ALL 4 SPRINTS DOWNLOADED!');
console.log(' Run: node ingestion/quality-inject.mjs');
console.log('══════════════════════════════════════\n');
