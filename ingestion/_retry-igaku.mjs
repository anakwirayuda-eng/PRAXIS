/**
 * Retry 9 skipped IgakuQA translations
 * Fixed JSON parser to handle markdown-wrapped responses
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'output', 'igakuqa_raw.json');
const TRANSLATED = join(__dirname, 'output', 'igakuqa_translated.json');
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

function chat(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 600 });
    const req = request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${d.slice(0,200)}`));
        try { resolve(JSON.parse(d).choices[0].message.content); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const existing = JSON.parse(readFileSync(TRANSLATED, 'utf8'));
const existingIds = new Set(existing.map(c => c.meta.original_id));
const skipped = src.filter(q => !existingIds.has(q.sample_id));

console.log(`🔄 Retrying ${skipped.length} skipped IgakuQA translations`);

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const maxId = Math.max(...db.map(c => c._id || 0));
let added = 0;

for (const q of skipped) {
  const opts = q.options.map((o, i) => `${String.fromCharCode(65+i)}. ${o}`).join('\n');
  const correctLetter = String.fromCharCode(65 + q.answer_idx);
  
  const prompt = `Translate this Japanese medical MCQ to English and explain why ${correctLetter} is correct. Return ONLY raw JSON (no markdown, no code blocks).

Question: ${q.question}
Options:
${opts}
Correct: ${correctLetter}. ${q.correct_answer}

{"question_en":"...","options_en":["A","B","C","D","E"],"rationale":"..."}`;

  try {
    const raw = await chat([{ role: 'user', content: prompt }]);
    // Handle markdown-wrapped JSON
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    
    const newCase = {
      _id: maxId + 1 + added,
      case_code: `IGK-GEN-MCQ-${String(existing.length + added + 1).padStart(5,'0')}`,
      question: parsed.question_en,
      options: parsed.options_en.map((text, i) => ({
        id: String.fromCharCode(65+i),
        text,
        is_correct: i === q.answer_idx,
      })),
      rationale: { correct: parsed.rationale },
      category: 'Ilmu Penyakit Dalam',
      q_type: 'MCQ',
      meta: { source: 'igakuqa', original_year: q.year, original_id: q.sample_id, tags: ['japanese-medical-exam', 'translated'] },
    };
    
    db.push(newCase);
    existing.push(newCase);
    added++;
    console.log(`  ✅ ${q.sample_id}: ${parsed.question_en.slice(0, 60)}...`);
  } catch (err) {
    console.error(`  ❌ ${q.sample_id}: ${err.message}`);
  }
  await new Promise(r => setTimeout(r, 300));
}

writeFileSync(TRANSLATED, JSON.stringify(existing, null, 2), 'utf8');
writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`\n✅ Added ${added}/${skipped.length}. Total DB: ${db.length}`);
