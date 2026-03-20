/**
 * MedMCQA Control Group — 200 NOT-flagged samples → gpt-5.4 CoT
 * 
 * Purpose: The previous 81.9% error rate was from ALREADY-FLAGGED samples.
 * This tests the "clean" population to get TRUE base rate.
 * 
 * Usage: node ingestion/medmcqa-control.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

console.log('══════════════════════════════════════════════════');
console.log(' MedMCQA Control Group — gpt-5.4 CoT Validation');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));

// Get the IDs that were flagged by gpt-4o-mini
const flagged = JSON.parse(readFileSync(join(OUTPUT_DIR, 'spotcheck_incorrect.json'), 'utf-8'));
const flaggedIds = new Set(flagged.map(f => f.id));

// Also exclude the 500 that were already sampled in spotcheck
const spotcheckRaw = readFileSync(join(OUTPUT_DIR, 'spotcheck.jsonl'), 'utf-8');
const spotcheckedIds = new Set();
for (const line of spotcheckRaw.split('\n').filter(l => l.trim())) {
  try {
    const req = JSON.parse(line);
    const id = parseInt(req.custom_id.replace('verify_', ''), 10);
    spotcheckedIds.add(id);
  } catch {}
}

// Get MedMCQA cases that were NOT in spotcheck at all
const cleanPool = cases.filter(c =>
  c.meta?.source === 'medmcqa' &&
  c.q_type === 'MCQ' &&
  !spotcheckedIds.has(c._id) &&
  c.options?.some(o => o.is_correct)
);

console.log(`📊 MedMCQA total: ${cases.filter(c => c.meta?.source === 'medmcqa').length}`);
console.log(`📊 Already spot-checked: ${spotcheckedIds.size}`);
console.log(`📊 Available clean pool: ${cleanPool.length}`);

// Random sample 200
const shuffled = cleanPool.sort(() => Math.random() - 0.5);
const sample = shuffled.slice(0, 200);
console.log(`📋 Sampling ${sample.length} from clean (never-tested) pool\n`);

const results = [];
let done = 0;

for (let i = 0; i < sample.length; i += 5) {
  const chunk = sample.slice(i, i + 5);
  const promises = chunk.map(async (c) => {
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
    const correctOpt = c.options.find(o => o.is_correct);
    
    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-5.4',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are a Board-Certified physician reviewing medical exam questions. Use step-by-step clinical reasoning. Be thorough but concise.' },
            { role: 'user', content: `Review this medical exam question. Is the marked answer clinically correct?

Question: ${text.substring(0, 700)}

Options:
${c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' [MARKED CORRECT]' : ''}`).join('\n')}

Reply JSON:
{"thinking": "clinical reasoning", "dataset_answer_correct": true/false, "confidence": 1-5, "correct_option_if_wrong": "letter or null", "brief_explanation": "..."}` },
          ],
        }),
      });
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return { id: c._id, category: c.category, ...parsed };
      }
    } catch (e) {
      return { id: c._id, error: e.message };
    }
    return null;
  });

  const batch = (await Promise.all(promises)).filter(Boolean);
  results.push(...batch);
  done += chunk.length;
  if (done % 20 === 0) console.log(`  Progress: ${done}/${sample.length}`);
}

// Analyze
const correct = results.filter(r => r.dataset_answer_correct === true).length;
const incorrect = results.filter(r => r.dataset_answer_correct === false).length;
const highConfIncorrect = results.filter(r => r.dataset_answer_correct === false && r.confidence >= 4).length;
const errors = results.filter(r => r.error).length;
const total = results.length - errors;
const errorRate = total > 0 ? ((incorrect / total) * 100).toFixed(1) : '?';
const highConfRate = total > 0 ? ((highConfIncorrect / total) * 100).toFixed(1) : '?';

writeFileSync(join(OUTPUT_DIR, 'control_group_gpt54.json'), JSON.stringify(results, null, 2), 'utf-8');

console.log('\n══════════════════════════════════════════════════');
console.log(' CONTROL GROUP RESULTS (NOT-FLAGGED MedMCQA)');
console.log('══════════════════════════════════════════════════');
console.log(`  Model: gpt-5.4 (Chain-of-Thought)`);
console.log(`  Sample: ${sample.length} random from never-tested pool`);
console.log(`  ✅ Dataset correct:     ${correct} (${total > 0 ? ((correct/total)*100).toFixed(1) : '?'}%)`);
console.log(`  ❌ Flagged incorrect:   ${incorrect} (${errorRate}%)`);
console.log(`  🔴 High-confidence wrong: ${highConfIncorrect} (${highConfRate}%)`);
console.log(`  ⚠️ Parse errors:       ${errors}`);
console.log();
console.log('  COMPARISON:');
console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  gpt-4o-mini (flagged pool): 68.0% error');
console.log('  o4-mini CoT (flagged pool): 81.9% error');
console.log(`  gpt-5.4 CoT (CLEAN pool):  ${errorRate}% error  ← THIS IS THE TRUE BASE RATE`);
console.log(`  gpt-5.4 CoT (high-conf):   ${highConfRate}% definite errors`);
console.log('══════════════════════════════════════════════════\n');
