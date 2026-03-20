import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(join(__dirname, 'output', 'igakuqa_raw.json'), 'utf8'));
console.log('Total:', d.length);
console.log('All keys:', Object.keys(d[0]).join(', '));
console.log();

// Full dump of first 3 entries
for (let i = 0; i < 3; i++) {
  console.log(`═══ Case ${i} ═══`);
  const c = d[i];
  for (const [k, v] of Object.entries(c)) {
    const val = typeof v === 'string' ? v.slice(0, 150) : JSON.stringify(v).slice(0, 150);
    console.log(`  ${k}: ${val}`);
  }
  console.log();
}

// Check how many have explanations
const hasExp = d.filter(c => c.explanation || c.exp || c.rationale || c.reason);
console.log('Has explanation field:', hasExp.length, '/', d.length);
const hasAnswer = d.filter(c => c.answer_idx !== undefined || c.correct_answer);
console.log('Has answer_idx:', hasAnswer.length);
