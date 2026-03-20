/**
 * FASE 1 Step 4+5:
 *   4: Contradiction Detection — 9,557 GPT explanations → gpt-5-nano batch
 *   5: FATAL ERROR Recheck — 100 MedMCQA → gpt-5.4 (Gemini's "is_safe" prompt)
 * 
 * Tests Gemini's hypothesis: "is this correct?" vs "FATAL error?" = different thresholds
 * 
 * Usage: node ingestion/fase1-step45.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

console.log('══════════════════════════════════════════════════');
console.log(' FASE 1: Step 4 + Step 5');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const caseMap = new Map();
for (const c of cases) caseMap.set(c._id, c);

// ═══════════════════════════════════════════════════
// STEP 4: CONTRADICTION DETECTION (gpt-5-nano batch)
// ═══════════════════════════════════════════════════
console.log('━━━ STEP 4: Contradiction Detection (gpt-5-nano batch) ━━━\n');

// Find all GPT-generated explanations (HeadQA + MMLU from quality-inject)
const gptExplained = cases.filter(c => {
  const src = c.meta?.source;
  return (src === 'headqa' || src === 'mmlu') && c.rationale?.correct?.length > 20;
});

console.log(`  📋 Cases with GPT-generated explanations: ${gptExplained.length}`);

const contradictionBatchFile = join(OUTPUT_DIR, 'contradiction_batch.jsonl');
const batchLines = [];

for (const c of gptExplained) {
  const correctOpt = c.options?.find(o => o.is_correct);
  if (!correctOpt) continue;

  batchLines.push(JSON.stringify({
    custom_id: `contra_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-5-nano',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'user', content: `Kunci jawaban soal ujian kedokteran ini: "${correctOpt.text}"

Penjelasan yang diberikan:
"${(c.rationale.correct || '').substring(0, 500)}"

Apakah penjelasan ini MENDUKUNG kunci jawaban "${correctOpt.text}", atau malah KONTRADIKSI / mengarah ke jawaban lain?

Jawab JSON: {"verdict": "SUPPORT" atau "CONTRADICT", "reason": "singkat"}` },
      ],
    },
  }));
}

writeFileSync(contradictionBatchFile, batchLines.join('\n'), 'utf-8');
console.log(`  📝 Generated ${batchLines.length} contradiction check prompts`);

// Upload and create batch
console.log('  📤 Uploading contradiction batch...');
const contraForm = new FormData();
contraForm.append('file', new Blob([readFileSync(contradictionBatchFile)]), 'contradiction_batch.jsonl');
contraForm.append('purpose', 'batch');
const contraUpload = await (await fetch(`${BASE}/files`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: contraForm,
})).json();
console.log(`  📁 File: ${contraUpload.id}`);

const contraBatch = await (await fetch(`${BASE}/batches`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ input_file_id: contraUpload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
})).json();
console.log(`  🚀 Contradiction Batch: ${contraBatch.id} (${contraBatch.status})\n`);

// ═══════════════════════════════════════════════════
// STEP 5: FATAL ERROR RECHECK (gpt-5.4 direct)
//   Gemini's prompt: "Is there a FATAL MEDICAL ERROR?"
//   vs our previous: "Is this answer correct?"
// ═══════════════════════════════════════════════════
console.log('━━━ STEP 5: FATAL ERROR Recheck — gpt-5.4 (Gemini prompt) ━━━\n');

// Use the SAME 100 cases from our control group (which gpt-5.4 said 64.5% "incorrect")
const controlResults = JSON.parse(readFileSync(join(OUTPUT_DIR, 'control_group_gpt54.json'), 'utf-8'));
const sample100 = controlResults.slice(0, 100);

console.log(`  📋 Re-checking ${sample100.length} with FATAL ERROR prompt...`);
console.log(`  💡 These same cases were 64.5% "incorrect" with "is correct?" prompt\n`);

const fatalResults = [];
let done = 0;

for (let i = 0; i < sample100.length; i += 5) {
  const chunk = sample100.slice(i, i + 5);
  const promises = chunk.map(async (prev) => {
    const c = caseMap.get(prev.id);
    if (!c) return null;
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
    const correctOpt = c.options?.find(o => o.is_correct);
    if (!correctOpt) return null;

    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.4',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are a senior Board-Certified physician and Medical Examiner. You are reviewing an exam question\'s answer key. Be CONSERVATIVE — only flag as unsafe if the marked answer would cause clear patient harm or violates a universally accepted medical standard. Regional/guideline differences are NOT errors.' },
            { role: 'user', content: `Soal ujian kedokteran:
${text.substring(0, 700)}

Opsi:
${c.options.map(o => `${o.id}. ${o.text}`).join('\n')}

Kunci jawaban yang ditandai: ${correctOpt.text}

Gunakan penalaran klinis singkat. Apakah ada FATAL MEDICAL ERROR (membahayakan/membunuh pasien, atau melanggar pakem medis mutlak yang berlaku universal) jika dokter memilih "${correctOpt.text}" sebagai jawabannya?

Jawab JSON:
{"thinking": "penalaran klinis singkat", "is_safe": true/false, "danger_level": "none/minor/moderate/fatal", "reason": "singkat"}` },
          ],
        }),
      });
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          id: prev.id,
          prev_verdict: prev.dataset_answer_correct,
          fatal_check: parsed,
        };
      }
    } catch (e) {
      return { id: prev.id, error: e.message };
    }
    return null;
  });

  const results = (await Promise.all(promises)).filter(Boolean);
  fatalResults.push(...results);
  done += chunk.length;
  if (done % 20 === 0) console.log(`  Progress: ${done}/${sample100.length}`);
}

writeFileSync(join(OUTPUT_DIR, 'fatal_error_recheck.json'), JSON.stringify(fatalResults, null, 2), 'utf-8');

// Analyze
const safe = fatalResults.filter(r => r.fatal_check?.is_safe === true).length;
const unsafe = fatalResults.filter(r => r.fatal_check?.is_safe === false).length;
const fatal = fatalResults.filter(r => r.fatal_check?.danger_level === 'fatal').length;
const moderate = fatalResults.filter(r => r.fatal_check?.danger_level === 'moderate').length;
const minor = fatalResults.filter(r => r.fatal_check?.danger_level === 'minor').length;
const none = fatalResults.filter(r => r.fatal_check?.danger_level === 'none').length;

// Cross-reference with previous "is correct?" answers
const prevIncorrectNowSafe = fatalResults.filter(r =>
  r.prev_verdict === false && r.fatal_check?.is_safe === true
).length;
const prevIncorrectStillUnsafe = fatalResults.filter(r =>
  r.prev_verdict === false && r.fatal_check?.is_safe === false
).length;

const total = fatalResults.length;
const fatalRate = total > 0 ? ((unsafe / total) * 100).toFixed(1) : '?';

console.log(`\n══════════════════════════════════════════════════`);
console.log(` FATAL ERROR RECHECK RESULTS`);
console.log(`══════════════════════════════════════════════════`);
console.log(`  Sample: ${total}`);
console.log(`  ✅ SAFE (no fatal error):  ${safe} (${total > 0 ? ((safe/total)*100).toFixed(1) : '?'}%)`);
console.log(`  ❌ UNSAFE:                 ${unsafe} (${fatalRate}%)`);
console.log();
console.log(`  Danger breakdown:`);
console.log(`    None:     ${none}`);
console.log(`    Minor:    ${minor}`);
console.log(`    Moderate: ${moderate}`);
console.log(`    Fatal:    ${fatal}`);
console.log();
console.log(`  PROMPT COMPARISON (same 100 cases):`);
console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  "Is answer correct?"    → ${fatalResults.filter(r => r.prev_verdict === false).length}% flagged`);
console.log(`  "FATAL medical error?"  → ${fatalRate}% flagged`);
console.log(`  Previously "wrong" but now SAFE: ${prevIncorrectNowSafe}`);
console.log(`  Previously "wrong" and still UNSAFE: ${prevIncorrectStillUnsafe}`);
console.log(`══════════════════════════════════════════════════\n`);
