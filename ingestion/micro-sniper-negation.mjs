/**
 * PRAXIS — Micro-Sniper: Negation Blindspot Regen
 * Re-generates rationales for 211 EXCEPT/KECUALI cases with negation-aware prompt
 * Usage: node ingestion/micro-sniper-negation.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const IDS_PATH = 'ingestion/output/negation_blindspot_ids.json';

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const targetIds = new Set(JSON.parse(fs.readFileSync(IDS_PATH, 'utf-8')));

console.log(`🎯 MICRO-SNIPER: ${targetIds.size} negation blindspot targets\n`);

const OPENAI_KEY = process.env.OPENAI_API_KEY || fs.readFileSync('.env', 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!OPENAI_KEY) { console.error('No API key'); process.exit(1); }

const SYSTEM_PROMPT = `CRITICAL CONSTRAINT: This is a NEGATIVE/EXCEPTION medical question (containing "KECUALI", "EXCEPT", "NOT TRUE", "LEAST LIKELY", "BUKAN", or similar).

The correct answer is the FALSE, WRONG, or CONTRAINDICATED statement — it is the EXCEPTION.

You MUST:
1. State clearly that this is a NEGATIVE question asking for the EXCEPTION/FALSE option
2. Explain precisely WHY the correct answer is WRONG/FALSE/THE EXCEPTION (why it doesn't belong)
3. Briefly explain why each distractor IS ACTUALLY TRUE/CORRECT for this condition (that's why they are NOT the answer)

Write in Bahasa Indonesia. Be concise but clinically precise. Max 200 words.`;

let done = 0, errors = 0;
const targets = db.filter(c => targetIds.has(c._id));

for (const c of targets) {
  const correctOpt = c.options?.find(o => o.is_correct);
  const wrongOpts = c.options?.filter(o => !o.is_correct) || [];
  if (!correctOpt) continue;

  const userPrompt = `Soal: "${(c.vignette?.narrative || c.prompt || '').slice(0, 500)}"

Opsi benar (PENGECUALIAN): ${correctOpt.id}. ${correctOpt.text}
Distractor (pernyataan yang BENAR): ${wrongOpts.map(o => `${o.id}. ${o.text}`).join(' | ')}

Jelaskan mengapa ${correctOpt.id} adalah pengecualian/salah, dan mengapa distractor lainnya benar.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      c.rationale.correct = content;
      c.meta.negation_blindspot = false;
      c.meta.negation_fixed = true;
      done++;
    } else { errors++; }
  } catch { errors++; }

  if (done % 50 === 0 && done > 0) console.log(`  ✅ ${done}/${targets.length}`);
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf-8');
console.log(`\n✅ MICRO-SNIPER COMPLETE: ${done} fixed, ${errors} errors`);
