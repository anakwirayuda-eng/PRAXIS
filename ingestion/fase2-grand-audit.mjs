/**
 * FASE 2: THE 33K GRAND AUDIT
 * 
 * Submit ALL 33,698 MedMCQA cases to gpt-5-mini Batch API
 * Using Harm Reduction prompt (FATAL/MINOR/NONE) + JSON Schema
 * 
 * Estimated cost: ~$6 (with 50% batch discount)
 * Expected time: overnight (8-12 hours)
 * 
 * Usage: node ingestion/fase2-grand-audit.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';

console.log('══════════════════════════════════════════════════');
console.log(' FASE 2: THE 33K GRAND AUDIT');
console.log(' gpt-5-mini × Batch API × JSON Schema');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const medmcqa = cases.filter(c => c.meta?.source === 'medmcqa' && c.q_type === 'MCQ');
console.log(`📂 MedMCQA cases: ${medmcqa.length.toLocaleString()}\n`);

// Generate batch JSONL
const batchFile = join(OUTPUT_DIR, 'fase2_medmcqa_audit.jsonl');
const lines = [];

for (const c of medmcqa) {
  const narrative = c.vignette?.narrative || '';
  const prompt = c.prompt || '';
  const question = `${narrative} ${prompt}`.trim();
  const correctOpt = c.options?.find(o => o.is_correct);
  if (!correctOpt || question.length < 10) continue;

  const optionsText = c.options.map(o =>
    `${o.id || o.text?.charAt(0) || '?'}. ${o.text}${o.is_correct ? ' [ANSWER KEY]' : ''}`
  ).join('\n');

  lines.push(JSON.stringify({
    custom_id: `audit_${c._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-5-mini',
      temperature: 0.0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'medical_safety_audit',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              reasoning: {
                type: 'string',
                description: '1-2 sentence clinical reasoning.',
              },
              severity: {
                type: 'string',
                enum: ['FATAL', 'MINOR', 'NONE'],
                description: 'FATAL (kills patient/totally wrong), MINOR (suboptimal/outdated but safe), NONE (100% safe).',
              },
              quarantine_flag: {
                type: 'boolean',
                description: 'true ONLY if severity is FATAL.',
              },
            },
            required: ['reasoning', 'severity', 'quarantine_flag'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You are a pragmatic ER Doctor and Board Examiner. Evaluate if the Answer Key causes a FATAL MEDICAL ERROR (kills patient, totally wrong disease category, dangerous drug at lethal dose). If it\'s just outdated, second-line therapy, or suboptimal but clinically safe, mark as MINOR or NONE. Regional guideline differences are NOT errors.',
        },
        {
          role: 'user',
          content: `QUESTION: ${question.substring(0, 800)}\n\nOPTIONS:\n${optionsText}\n\nEXPLANATION: ${(c.rationale?.correct || 'None').substring(0, 300)}`,
        },
      ],
    },
  }));
}

writeFileSync(batchFile, lines.join('\n'), 'utf-8');
console.log(`📝 Generated ${lines.length.toLocaleString()} audit prompts`);
console.log(`📁 File: ${batchFile}\n`);

// Upload
console.log('📤 Uploading to OpenAI...');
const form = new FormData();
form.append('file', new Blob([readFileSync(batchFile)]), 'fase2_medmcqa_audit.jsonl');
form.append('purpose', 'batch');
const upload = await (await fetch(`${BASE}/files`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: form,
})).json();

if (upload.error) {
  console.error('❌ Upload failed:', upload.error.message);
  process.exit(1);
}
console.log(`  📁 File ID: ${upload.id}\n`);

// Create batch
console.log('🚀 Creating batch...');
const batch = await (await fetch(`${BASE}/batches`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input_file_id: upload.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
  }),
})).json();

if (batch.error) {
  console.error('❌ Batch creation failed:', batch.error.message);
  process.exit(1);
}

console.log(`  🚀 Batch ID: ${batch.id}`);
console.log(`  📊 Status: ${batch.status}`);
console.log(`  📋 Prompts: ${lines.length.toLocaleString()}`);

// Save batch info for tomorrow's download
writeFileSync(join(OUTPUT_DIR, 'fase2_batch_info.json'), JSON.stringify({
  batch_id: batch.id,
  file_id: upload.id,
  total_prompts: lines.length,
  model: 'gpt-5-mini',
  created_at: new Date().toISOString(),
  estimated_cost: `$${(lines.length * 0.0002).toFixed(2)} (batch 50% off)`,
}, null, 2), 'utf-8');

console.log(`\n══════════════════════════════════════════════════`);
console.log(` ✅ FASE 2 BATCH SUBMITTED!`);
console.log(`══════════════════════════════════════════════════`);
console.log(`  Total: ${lines.length.toLocaleString()} MedMCQA cases`);
console.log(`  Model: gpt-5-mini (Batch API, 50% off)`);
console.log(`  Cost: ~$${(lines.length * 0.0002).toFixed(2)}`);
console.log(`  ETA: 8-12 hours (batang pagi Senin)`);
console.log(`  Batch ID: ${batch.id}`);
console.log(`\n  🌙 Selamat tidur! Besok pagi download hasilnya.`);
console.log(`  Run: node ingestion/fase2-download.mjs`);
console.log(`══════════════════════════════════════════════════\n`);
