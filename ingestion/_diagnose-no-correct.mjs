/**
 * Diagnose 1,053 cases with no is_correct=true
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'compiled_cases.json'), 'utf8'));

const noCorrect = db.filter(c => {
  if (!Array.isArray(c.options) || c.options.length < 2) return false;
  return !c.options.some(o => o.is_correct);
});

console.log(`Total no-correct: ${noCorrect.length}\n`);

// By source
const bySrc = {};
noCorrect.forEach(c => { const s = c.meta?.source || '?'; bySrc[s] = (bySrc[s] || 0) + 1; });
console.log('═══ BY SOURCE ═══');
Object.entries(bySrc).sort((a,b) => b[1]-a[1]).forEach(([s,n]) => console.log(`  ${n.toString().padStart(5)}  ${s}`));

// Check if they have rationale that mentions correct answer
let hasRationale = 0, hasCorrectMention = 0, hasOriginalAnswer = 0;
const answerLetterRx = /\b(?:correct answer|answer is|jawaban|the answer)\s*(?:is\s*)?[:\s]*\(?([A-E])\)?/i;

for (const c of noCorrect) {
  const rat = c.rationale?.correct || '';
  if (rat.length > 30) hasRationale++;
  if (answerLetterRx.test(rat)) hasCorrectMention++;
  
  // Check if original data had answer field
  if (c.meta?.correct_answer || c.meta?.answer_idx != null || c.correct_answer) hasOriginalAnswer++;
}

console.log(`\n═══ RECOVERY VECTORS ═══`);
console.log(`  Has rationale (>30 chars): ${hasRationale}`);
console.log(`  Rationale mentions answer letter: ${hasCorrectMention}`);
console.log(`  Has meta.correct_answer / answer_idx: ${hasOriginalAnswer}`);

// Sample 5
console.log('\n═══ SAMPLES ═══');
noCorrect.slice(0, 5).forEach((c, i) => {
  console.log(`\n--- Case ${i+1}: ${c._id} (${c.meta?.source}) ---`);
  console.log(`  Q: ${(c.question || '').slice(0, 80)}`);
  console.log(`  Options: ${c.options.map(o => `${o.id}:${o.is_correct}`).join(', ')}`);
  console.log(`  Rationale: ${(c.rationale?.correct || '').slice(0, 100)}`);
  console.log(`  meta.correct_answer: ${c.meta?.correct_answer || c.correct_answer || 'NONE'}`);
});

// Check how many just have all is_correct=false vs some other pattern
let allFalse = 0, noIsCorrectField = 0;
for (const c of noCorrect) {
  if (c.options.every(o => o.is_correct === false)) allFalse++;
  if (c.options.some(o => o.is_correct === undefined)) noIsCorrectField++;
}
console.log(`\n═══ PATTERN ═══`);
console.log(`  All options is_correct=false: ${allFalse}`);
console.log(`  Some options missing is_correct field: ${noIsCorrectField}`);
