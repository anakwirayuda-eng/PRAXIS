/**
 * Quality Audit Mega-Batch — 4 Sprints Simultaneously
 * 
 * Sprint 1: 8 cross-source conflicts → resolve correct answer
 * Sprint 2: 500 MedMCQA random → verify answer correctness
 * Sprint 3: 6,691 HeadQA → generate explanations
 * Sprint 4: 2,866 MMLU → generate explanations
 * 
 * Usage: node ingestion/quality-batch.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY || API_KEY.includes('paste')) { console.error('❌ Set OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

async function apiCall(path, opts = {}) {
  const resp = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
  return resp.json();
}

async function uploadFile(name, content) {
  const form = new FormData();
  form.append('file', new Blob([content]), name);
  form.append('purpose', 'batch');
  const resp = await fetch(`${BASE}/files`, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}` }, body: form });
  if (!resp.ok) throw new Error(`Upload failed: ${(await resp.text()).substring(0, 200)}`);
  return (await resp.json()).id;
}

console.log('══════════════════════════════════════════════════');
console.log(' Quality Audit Mega-Batch — 4 Sprints');
console.log('══════════════════════════════════════════════════\n');

// Load cases
const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
console.log(`📂 Loaded ${cases.length.toLocaleString()} cases\n`);

// ═══════════════════════════════════════
// GENERATE ALL 4 JSONL FILES
// ═══════════════════════════════════════

const sprints = [];

// SPRINT 1: Conflict resolution (8 existing)
const conflictFile = join(OUTPUT_DIR, 'llm_batch_queue.jsonl');
if (existsSync(conflictFile)) {
  const content = readFileSync(conflictFile, 'utf-8').trim();
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    sprints.push({ name: 'Sprint 1: Conflict Resolution', file: 'conflicts.jsonl', content, count: lines.length });
  }
}

// SPRINT 2: MedMCQA spot-check (500 random)
const medmcqa = cases.filter(c => c.meta?.source === 'medmcqa' && c.q_type === 'MCQ');
const shuffled = medmcqa.sort(() => Math.random() - 0.5).slice(0, 500);
const sprint2Lines = shuffled.map((c, i) => {
  const correctOpt = c.options?.find(o => o.is_correct);
  const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
  return JSON.stringify({
    custom_id: `verify_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a medical exam validator. Check if the marked correct answer is actually correct. Reply JSON: {"is_correct": boolean, "confidence": 1-5, "correct_answer_should_be": "option letter or same", "reasoning": "brief explanation"}' },
        { role: 'user', content: `Q: ${text.substring(0, 600)}\nOptions:\n${c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' [MARKED CORRECT]' : ''}`).join('\n')}` },
      ],
    },
  });
});
sprints.push({ name: 'Sprint 2: MedMCQA Spot-Check', file: 'spotcheck.jsonl', content: sprint2Lines.join('\n'), count: sprint2Lines.length });

// SPRINT 3: HeadQA explanations
const headqa = cases.filter(c => c.meta?.source === 'headqa' && (!c.rationale?.correct || c.rationale.correct.length < 20));
const sprint3Lines = headqa.map(c => {
  const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
  const correctOpt = c.options?.find(o => o.is_correct);
  return JSON.stringify({
    custom_id: `explain_headqa_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a medical professor. Explain why the correct answer is right and why each distractor is wrong. Be concise but educational (max 200 words). Format: "CORRECT: [explanation]\\n\\nWhy not [A/B/C/D]: [brief reason]"' },
        { role: 'user', content: `Q: ${text.substring(0, 500)}\nOptions:\n${c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' ✓' : ''}`).join('\n')}\nCorrect: ${correctOpt?.text || 'unknown'}` },
      ],
    },
  });
});
sprints.push({ name: 'Sprint 3: HeadQA Explanations', file: 'explain_headqa.jsonl', content: sprint3Lines.join('\n'), count: sprint3Lines.length });

// SPRINT 4: MMLU explanations
const mmlu = cases.filter(c => c.meta?.source?.startsWith('mmlu') && (!c.rationale?.correct || c.rationale.correct.length < 20));
const sprint4Lines = mmlu.map(c => {
  const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
  const correctOpt = c.options?.find(o => o.is_correct);
  return JSON.stringify({
    custom_id: `explain_mmlu_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a medical professor. Explain why the correct answer is right and why each distractor is wrong. Be concise but educational (max 200 words). Format: "CORRECT: [explanation]\\n\\nWhy not [A/B/C/D]: [brief reason]"' },
        { role: 'user', content: `Q: ${text.substring(0, 500)}\nOptions:\n${c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' ✓' : ''}`).join('\n')}\nCorrect: ${correctOpt?.text || 'unknown'}` },
      ],
    },
  });
});
sprints.push({ name: 'Sprint 4: MMLU Explanations', file: 'explain_mmlu.jsonl', content: sprint4Lines.join('\n'), count: sprint4Lines.length });

// ═══════════════════════════════════════
// UPLOAD & CREATE ALL BATCHES
// ═══════════════════════════════════════
console.log('📤 Uploading & creating batches...\n');
const batches = [];

for (const sprint of sprints) {
  console.log(`  ${sprint.name} (${sprint.count} prompts)`);
  
  // Save locally
  writeFileSync(join(OUTPUT_DIR, sprint.file), sprint.content, 'utf-8');
  
  // Upload
  const fileId = await uploadFile(sprint.file, sprint.content);
  console.log(`    📁 File: ${fileId}`);
  
  // Create batch
  const batch = await apiCall('/batches', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: fileId,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: sprint.name },
    }),
  });
  console.log(`    🚀 Batch: ${batch.id} (${batch.status})\n`);
  batches.push({ ...sprint, batchId: batch.id, status: batch.status });
}

console.log('══════════════════════════════════════════════════');
console.log(` ✅ ${batches.length} batches submitted!`);
console.log(` Total prompts: ${batches.reduce((sum, b) => sum + b.count, 0)}`);
console.log('══════════════════════════════════════════════════\n');

// ═══════════════════════════════════════
// POLL ALL BATCHES
// ═══════════════════════════════════════
console.log('⏳ Polling all batches...\n');

let allDone = false;
let pollCount = 0;

while (!allDone) {
  allDone = true;
  const waitMin = pollCount < 5 ? 1 : 5;
  
  for (const b of batches) {
    if (b.status === 'completed' || b.status === 'failed') continue;
    
    const check = await apiCall(`/batches/${b.batchId}`);
    b.status = check.status;
    b.outputFileId = check.output_file_id;
    const progress = check.request_counts || {};
    
    console.log(`  [${new Date().toLocaleTimeString()}] ${b.name}: ${b.status} (${progress.completed || 0}/${progress.total || b.count})`);
    
    if (b.status !== 'completed' && b.status !== 'failed') allDone = false;
  }
  
  if (!allDone) {
    console.log(`  ... next check in ${waitMin}m\n`);
    await new Promise(r => setTimeout(r, waitMin * 60 * 1000));
  }
  
  pollCount++;
  if (pollCount > 100) { console.log('⚠️ Max polls. Run again to check.'); break; }
}

// ═══════════════════════════════════════
// DOWNLOAD ALL RESULTS
// ═══════════════════════════════════════
console.log('\n📥 Downloading results...\n');

for (const b of batches) {
  if (b.status !== 'completed' || !b.outputFileId) {
    console.log(`  ❌ ${b.name}: ${b.status}`);
    continue;
  }
  
  const resp = await fetch(`${BASE}/files/${b.outputFileId}/content`, { headers });
  const text = await resp.text();
  const resultFile = join(OUTPUT_DIR, `result_${b.file}`);
  writeFileSync(resultFile, text, 'utf-8');
  
  const lines = text.split('\n').filter(l => l.trim());
  console.log(`  ✅ ${b.name}: ${lines.length} results → ${resultFile}`);
}

console.log('\n══════════════════════════════════════════════════');
console.log(' ALL BATCHES COMPLETE!');
console.log(' Run: node ingestion/quality-inject.mjs');
console.log('══════════════════════════════════════════════════\n');
