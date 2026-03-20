/**
 * FASE 1: The $2 Rescue — Gemini Blueprint Execution
 * 
 * Step 1: Zero-cost local heuristics (flashcard tagging + distractor bias)
 * Step 2: SCT re-gen with gpt-5.4 + Structured Outputs ($0.50)
 * Step 3: MedMCQA re-validate 200 samples with o4-mini CoT ($1.50)
 * 
 * Usage: node ingestion/fase1-rescue.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUARANTINE_FILE = join(import.meta.dirname, '..', 'public', 'data', 'quarantine_manifest.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

console.log('══════════════════════════════════════════════════════');
console.log(' FASE 1: THE $2 RESCUE');
console.log(' Gemini Master Blueprint Execution');
console.log('══════════════════════════════════════════════════════\n');

let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
console.log(`📂 Loaded ${cases.length.toLocaleString()} cases\n`);

// ═══════════════════════════════════════════════════
// STEP 1: ZERO-COST LOCAL HEURISTICS ($0)
// ═══════════════════════════════════════════════════
console.log('━━━ STEP 1: Zero-Cost Local Heuristics ($0) ━━━\n');

let taggedFlashcard = 0;
let distractorBias = 0;
let phantomImage = 0;

const PHANTOM_REGEX = /\b(refer to image|as shown in figure|x-ray reveals|gambar|radiologi|ekg|ecg|ct scan|mri|x-ray|berikut ini|di bawah ini|menunjukkan gambaran|figure \d|as shown|radiograph|chest x|foto thorax|USG|histopatolog|mikroskop|preparat|dermoskop)\b/i;

for (const c of cases) {
  if (c.q_type === 'SCT') continue; // handle separately

  const narrative = c.vignette?.narrative || '';
  const prompt = c.prompt || '';
  const fullText = `${narrative} ${prompt}`.trim();

  // Hack 7: Tag short questions as rapid_recall
  if (fullText.length < 80 && c.q_type === 'MCQ') {
    c.meta = c.meta || {};
    c.meta.questionMode = 'rapid_recall';
    taggedFlashcard++;
  }

  // Hack 8: Distractor length bias
  if (Array.isArray(c.options) && c.options.length >= 4) {
    const lengths = c.options.map(o => (o.text || '').length);
    const maxLen = Math.max(...lengths);
    const avgOthers = (lengths.reduce((s, l) => s + l, 0) - maxLen) / (lengths.length - 1);
    if (maxLen > avgOthers * 3.5 && avgOthers > 5) {
      const longestOpt = c.options[lengths.indexOf(maxLen)];
      if (longestOpt.is_correct) {
        c.meta = c.meta || {};
        c.meta.distractor_bias = true;
        distractorBias++;
      }
    }
  }

  // Phantom image (re-check — some may have been missed by validate-v3)
  if (PHANTOM_REGEX.test(fullText) && (!c.images || c.images.length === 0)) {
    if (!c.meta?.phantom_image) {
      c.meta = c.meta || {};
      c.meta.phantom_image = true;
      phantomImage++;
    }
  }
}

console.log(`  📋 Tagged as rapid_recall (flashcard): ${taggedFlashcard.toLocaleString()}`);
console.log(`  ⚠️ Distractor length bias detected: ${distractorBias}`);
console.log(`  👻 Phantom images (new): ${phantomImage}\n`);

// ═══════════════════════════════════════════════════
// STEP 2: SCT RE-GEN WITH gpt-5.4 + STRUCTURED OUTPUTS ($0.50)
// ═══════════════════════════════════════════════════
console.log('━━━ STEP 2: SCT Re-gen with gpt-5.4 JSON Schema ($0.50) ━━━\n');

const SCT_BATCH_FILE = join(OUTPUT_DIR, 'sct_v3_batch.jsonl');
const sctSource = readFileSync(join(OUTPUT_DIR, 'sct_batch_result.jsonl'), 'utf-8')
  .split('\n').filter(l => l.trim());

// Build batch with gpt-5.4 + structured outputs
const sctPrompts = [];
const caseMap = new Map();
for (const c of cases) caseMap.set(c._id, c);

for (const line of sctSource) {
  try {
    const r = JSON.parse(line);
    const sourceId = parseInt(r.custom_id.replace('sct_', ''), 10);
    const src = caseMap.get(sourceId);
    if (!src) continue;

    const narrative = src.vignette?.narrative || '';
    const correctOpt = src.options?.find(o => o.is_correct);
    if (!correctOpt || narrative.length < 30) continue;

    sctPrompts.push({
      custom_id: `sctv3_${sourceId}`,
      method: 'POST', url: '/v1/chat/completions',
      body: {
        model: 'gpt-5.4',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'sct_case',
            strict: true,
            schema: {
              type: 'object',
              required: ['clinical_scenario', 'hypothesis', 'new_finding', 'question_stem', 'likert_answer', 'rationale', 'panel_votes'],
              properties: {
                clinical_scenario: { type: 'string', description: 'Pure clinical vignette WITHOUT any question stem. Patient presentation only.' },
                hypothesis: { type: 'string', description: 'A specific clinical hypothesis based on the scenario' },
                new_finding: { type: 'string', description: 'A new clinical finding or lab result that affects the hypothesis' },
                question_stem: { type: 'string', description: 'The SCT question in Indonesian: "Jika ditemukan [finding], apakah hipotesis menjadi..."' },
                likert_answer: { type: 'integer', description: 'Expert consensus: -2 to +2' },
                rationale: { type: 'string', description: 'Why the finding supports/weakens the hypothesis' },
                panel_votes: {
                  type: 'object',
                  required: ['minus2', 'minus1', 'zero', 'plus1', 'plus2'],
                  properties: {
                    minus2: { type: 'integer' }, minus1: { type: 'integer' },
                    zero: { type: 'integer' }, plus1: { type: 'integer' }, plus2: { type: 'integer' },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
        },
        messages: [
          { role: 'system', content: 'You are an expert Medical Examiner creating Script Concordance Tests (SCT). Create a high-quality SCT from this MCQ. The clinical_scenario MUST be a pure patient presentation - NO question stems ("Which of the following..."). The hypothesis must be specific and testable. Panel votes must sum to 10.' },
          { role: 'user', content: `Original MCQ:\nVignette: ${narrative.substring(0, 800)}\nCorrect Answer: ${correctOpt.text}` },
        ],
      },
    });
  } catch {}
}

writeFileSync(SCT_BATCH_FILE, sctPrompts.map(p => JSON.stringify(p)).join('\n'), 'utf-8');
console.log(`  📝 Generated ${sctPrompts.length} SCT v3 prompts (gpt-5.4 + JSON Schema)`);

// Upload and create batch
console.log('  📤 Uploading...');
const sctForm = new FormData();
sctForm.append('file', new Blob([readFileSync(SCT_BATCH_FILE)]), 'sct_v3_batch.jsonl');
sctForm.append('purpose', 'batch');
const sctUpload = await (await fetch(`${BASE}/files`, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}` }, body: sctForm })).json();
console.log(`  📁 File: ${sctUpload.id}`);

const sctBatch = await (await fetch(`${BASE}/batches`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ input_file_id: sctUpload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
})).json();
console.log(`  🚀 SCT Batch: ${sctBatch.id} (${sctBatch.status})\n`);

// ═══════════════════════════════════════════════════
// STEP 3: MedMCQA RE-VALIDATE 200 SAMPLES WITH o4-mini CoT ($1.50)
// ═══════════════════════════════════════════════════
console.log('━━━ STEP 3: MedMCQA Re-validate with o4-mini CoT ($1.50) ━━━\n');

// Take 200 from the 340 flagged
const flagged = JSON.parse(readFileSync(join(OUTPUT_DIR, 'spotcheck_incorrect.json'), 'utf-8'));
const sample200 = flagged.slice(0, 200);

console.log(`  📋 Re-checking ${sample200.length} of ${flagged.length} flagged cases...`);

const revalResults = [];
let revalDone = 0;

for (let i = 0; i < sample200.length; i += 5) {
  const chunk = sample200.slice(i, i + 5);
  const promises = chunk.map(async (item) => {
    const c = caseMap.get(item.id);
    if (!c) return null;
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();

    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'o4-mini',
          reasoning_effort: 'high',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'user', content: `You are a Board-Certified physician reviewing this medical exam question. Use clinical reasoning step-by-step.

Question: ${text.substring(0, 700)}

Options:
${c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' [DATASET ANSWER]' : ''}`).join('\n')}

Think carefully. Is the dataset's marked answer correct? Reply JSON:
{"thinking": "step by step clinical reasoning", "dataset_answer_correct": true/false, "confidence": 1-5, "correct_option": "letter", "explanation": "brief"}` },
          ],
        }),
      });
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return { id: item.id, ...parsed };
      }
    } catch (e) {
      return { id: item.id, error: e.message };
    }
    return null;
  });

  const results = (await Promise.all(promises)).filter(Boolean);
  revalResults.push(...results);
  revalDone += chunk.length;
  if (revalDone % 20 === 0) console.log(`  Progress: ${revalDone}/${sample200.length}`);
}

// Analyze
const confirmed = revalResults.filter(r => r.dataset_answer_correct === true).length;
const disputed = revalResults.filter(r => r.dataset_answer_correct === false).length;
const errors = revalResults.filter(r => r.error).length;
const realErrorRate = revalResults.length > 0 ? ((disputed / revalResults.length) * 100).toFixed(1) : '?';

writeFileSync(join(OUTPUT_DIR, 'revalidation_o4mini.json'), JSON.stringify(revalResults, null, 2), 'utf-8');

console.log(`\n  ✅ Dataset correct (confirmed by o4-mini): ${confirmed}`);
console.log(`  ❌ Actually incorrect: ${disputed}`);
console.log(`  ⚠️ Errors: ${errors}`);
console.log(`\n  📊 REAL ERROR RATE: ${realErrorRate}% (was 68% from gpt-4o-mini)`);
console.log(`  💡 Gemini predicted 3-5%. Actual: ${realErrorRate}%\n`);

// Save compiled with heuristic tags
writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
copyFileSync(COMPILED, PUBLIC_COMPILED);

console.log('══════════════════════════════════════════════════════');
console.log(' FASE 1 COMPLETE');
console.log('══════════════════════════════════════════════════════');
console.log(`  Flashcard tagged:      ${taggedFlashcard.toLocaleString()}`);
console.log(`  Distractor bias:       ${distractorBias}`);
console.log(`  SCT v3 batch:          ${sctBatch.id} (${sctPrompts.length} prompts)`);
console.log(`  MedMCQA real error:    ${realErrorRate}%`);
console.log(`  Re-validation saved:   revalidation_o4mini.json`);
console.log('══════════════════════════════════════════════════════\n');
