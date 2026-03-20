/**
 * Translate IgakuQA (146 Japanese medical MCQs) → English
 * Sequential gpt-4o-mini calls. Cost: ~$0.44
 * Also generates rationale since IgakuQA has no explanations.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'output', 'igakuqa_raw.json');
const OUT = join(__dirname, 'output', 'igakuqa_translated.json');
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
console.log(`📚 IgakuQA: ${src.length} questions to translate`);

const results = [];
let done = 0;

for (const q of src) {
  const opts = q.options.map((o, i) => `${String.fromCharCode(65+i)}. ${o}`).join('\n');
  const correctLetter = String.fromCharCode(65 + q.answer_idx);
  
  const prompt = `Translate this Japanese medical MCQ to English, then provide a brief rationale for why ${correctLetter} is correct.

Question: ${q.question}

Options:
${opts}

Correct answer: ${correctLetter}. ${q.correct_answer}

Respond in this EXACT JSON format:
{
  "question_en": "translated question",
  "options_en": ["A text", "B text", "C text", "D text", "E text"],
  "rationale": "brief explanation why ${correctLetter} is correct"
}`;

  try {
    const raw = await chat([{ role: 'user', content: prompt }]);
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    
    results.push({
      _id: 70000 + done,
      case_code: `IGK-GEN-MCQ-${String(done+1).padStart(5,'0')}`,
      question: parsed.question_en,
      options: parsed.options_en.map((text, i) => ({
        id: String.fromCharCode(65+i),
        text,
        is_correct: i === q.answer_idx,
      })),
      rationale: { correct: parsed.rationale },
      category: 'Ilmu Penyakit Dalam', // default, will re-categorize
      q_type: 'MCQ',
      meta: {
        source: 'igakuqa',
        original_year: q.year,
        original_id: q.sample_id,
        difficulty_score: q.difficulty_score,
        tags: ['japanese-medical-exam', 'translated'],
      },
    });
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${src.length} translated...`);
  } catch (err) {
    console.error(`  ❌ Skip ${q.sample_id}: ${err.message}`);
  }
  
  // Small delay to avoid rate limit
  await new Promise(r => setTimeout(r, 200));
}

writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ Done! ${done}/${src.length} translated → ${OUT}`);
