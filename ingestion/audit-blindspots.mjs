/**
 * DEEP BLINDSPOT & PSYCHOMETRIC AUDIT
 * Analyzes the entire dataset for test-taking vulnerabilities,
 * cognitive biases, and structural blindspots across 64K+ cases.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const COMPILED_PATH = join(import.meta.dirname, 'output', 'compiled_cases.json');
const cases = JSON.parse(readFileSync(COMPILED_PATH, 'utf-8'));
const mcqs = cases.filter(c => c.q_type === 'MCQ');

console.log('══════════════════════════════════════════════════');
console.log(` 👁️ DEEP BLINDSPOT AUDIT — ${mcqs.length.toLocaleString()} MCQs`);
console.log('══════════════════════════════════════════════════\n');

const metrics = {
  // Option Length Bias (Convergence Cue)
  longer_correct_option: 0,
  shorter_correct_option: 0,
  avg_len_correct: 0,
  avg_len_incorrect: 0,
  
  // Negative Phrasing
  negative_prompts: 0,       // "kecuali", "tidak", "bukan"
  
  // Lazy Distractors
  all_of_the_above: 0,       // "semua di atas benar"
  none_of_the_above: 0,      // "bukan salah satu di atas"
  
  // Absolute Terms (Usually false in medicine)
  absolute_terms_in_options: 0, // "selalu", "tidak pernah", "hanya"
  absolute_is_correct: 0,
  absolute_is_incorrect: 0,
  
  // Answer Distribution (Index 0-4)
  correct_index_distribution: { 0:0, 1:0, 2:0, 3:0, 4:0, 'other':0 },
  
  // Word Matching Bias (Test-taking cue)
  correct_shares_more_word_with_stem: 0,
  
  // Evasive Rationale
  circular_rationale: 0,     // "karena itu adalah jawaban yang tepat"
};

const RE_NEGATIVE = /\b(kecuali|tidak|bukan|salah|kurang tepat|tidak benar)\b/i;
const RE_ALL_ABOVE = /\b(semua\s+(pilihan|jawaban|di\s*atas)\s*(benar|salah|tepat))\b/i;
const RE_NONE_ABOVE = /\b(tidak\s+ada\s+(pilihan|jawaban|di\s*atas)|bukan\s+salah\s+satu)\b/i;
const RE_ABSOLUTE = /\b(selalu|tidak pernah|hanya|pasti|mutlak|semua)\b/i;
const RE_CIRCULAR = /\b(adalah\s+jawaban\s+yang\s+(benar|tepat)|sudah\s+jelas|pilihan\s+terbaik)\b/i;

function getWords(text) {
  return new Set((text||'').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 3));
}

let mcqProcessed = 0;

for (const c of mcqs) {
  const narrative = c.vignette?.narrative || '';
  const prompt = c.prompt || '';
  const rationale = c.rationale?.correct || '';
  const options = c.options || [];
  
  const correctOpt = options.find(o => o.is_correct);
  const incorrectOpts = options.filter(o => !o.is_correct);
  
  if (!correctOpt || incorrectOpts.length === 0) continue;
  mcqProcessed++;
  
  // 1. Length Bias
  const cLen = (correctOpt.text || '').length;
  const iLens = incorrectOpts.map(o => (o.text || '').length);
  const avgILen = iLens.reduce((a,b)=>a+b,0) / iLens.length;
  
  metrics.avg_len_correct += cLen;
  metrics.avg_len_incorrect += avgILen;
  
  if (cLen > avgILen * 1.5) metrics.longer_correct_option++;
  if (cLen < avgILen * 0.6) metrics.shorter_correct_option++;
  
  // 2. Negative Prompts
  if (RE_NEGATIVE.test(prompt)) metrics.negative_prompts++;
  
  // 3. Lazy Distractors & Absolutes
  let hasAbsolute = false;
  for (const o of options) {
    const txt = o.text || '';
    if (RE_ALL_ABOVE.test(txt)) metrics.all_of_the_above++;
    if (RE_NONE_ABOVE.test(txt)) metrics.none_of_the_above++;
    
    if (RE_ABSOLUTE.test(txt)) {
      hasAbsolute = true;
      if (o.is_correct) metrics.absolute_is_correct++;
      else metrics.absolute_is_incorrect++;
    }
  }
  if (hasAbsolute) metrics.absolute_terms_in_options++;
  
  // 4. Index Distribution
  const idx = options.indexOf(correctOpt);
  if (idx >= 0 && idx <= 4) {
    metrics.correct_index_distribution[idx]++;
  } else {
    metrics.correct_index_distribution['other']++;
  }
  
  // 5. Word Matching Bias
  const stemWords = getWords(narrative + ' ' + prompt);
  const correctWords = getWords(correctOpt.text);
  let correctOverlap = 0;
  for (const w of correctWords) if (stemWords.has(w)) correctOverlap++;
  
  let maxIncorrectOverlap = 0;
  for (const o of incorrectOpts) {
    let overlap = 0;
    const wds = getWords(o.text);
    for (const w of wds) if (stemWords.has(w)) overlap++;
    if (overlap > maxIncorrectOverlap) maxIncorrectOverlap = overlap;
  }
  
  // If correct answer repeats more words from the vignette than the best distractor
  if (correctOverlap > maxIncorrectOverlap && correctOverlap > 0) {
    metrics.correct_shares_more_word_with_stem++;
  }
  
  // 6. Circular Rationale
  if (RE_CIRCULAR.test(rationale) && rationale.length < 150) {
    metrics.circular_rationale++;
  }
}

// Finalize averages
metrics.avg_len_correct = Math.round(metrics.avg_len_correct / mcqProcessed);
metrics.avg_len_incorrect = Math.round(metrics.avg_len_incorrect / mcqProcessed);

console.log(`━━━ 1. PSYCHOMETRIC BLINDSPOTS (VULNERABILITIES) ━━━`);
console.log(`Length Bias:`);
console.log(`  - Avg Correct Option Length:   ${metrics.avg_len_correct} chars`);
console.log(`  - Avg Incorrect Option Length: ${metrics.avg_len_incorrect} chars`);
console.log(`  - Correct is >50% longer:      ${metrics.longer_correct_option.toLocaleString()} cases (${((metrics.longer_correct_option/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`  - Correct is >40% shorter:     ${metrics.shorter_correct_option.toLocaleString()} cases (${((metrics.shorter_correct_option/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`Word-Matching Cue (Correct shares more words with stem than distractors):`);
console.log(`  - Vulnerable cases:            ${metrics.correct_shares_more_word_with_stem.toLocaleString()} (${((metrics.correct_shares_more_word_with_stem/mcqProcessed)*100).toFixed(1)}%)`);

console.log(`\n━━━ 2. STRUCTURAL ANTI-PATTERNS (LAZY AUTHORING) ━━━`);
console.log(`Negative Prompts ("Kecuali"):  ${metrics.negative_prompts.toLocaleString()} (${((metrics.negative_prompts/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`"All of the above" used:       ${metrics.all_of_the_above.toLocaleString()}`);
console.log(`"None of the above" used:      ${metrics.none_of_the_above.toLocaleString()}`);
console.log(`Circular/Lazy Rationale:       ${metrics.circular_rationale.toLocaleString()}`);

console.log(`\n━━━ 3. ABDOLUTE TERMS BIAS ("Selalu", "Hanya") ━━━`);
console.log(`Total cases with absolutes:    ${metrics.absolute_terms_in_options.toLocaleString()}`);
console.log(`  - When used, it is CORRECT:    ${metrics.absolute_is_correct.toLocaleString()}`);
console.log(`  - When used, it is INCORRECT:  ${metrics.absolute_is_incorrect.toLocaleString()}`);
if (metrics.absolute_is_incorrect > metrics.absolute_is_correct) {
  console.log(`  💡 Test-taking meta: Absolute terms are false distractors ${(metrics.absolute_is_incorrect/(metrics.absolute_is_incorrect+metrics.absolute_is_correct)*100).toFixed(1)}% of the time.`);
}

console.log(`\n━━━ 4. OPTION POSITION BIAS ("C" IS ALWAYS RIGHT) ━━━`);
const dist = metrics.correct_index_distribution;
console.log(`  Option 1 (A): ${dist[0].toLocaleString()} (${((dist[0]/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`  Option 2 (B): ${dist[1].toLocaleString()} (${((dist[1]/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`  Option 3 (C): ${dist[2].toLocaleString()} (${((dist[2]/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`  Option 4 (D): ${dist[3].toLocaleString()} (${((dist[3]/mcqProcessed)*100).toFixed(1)}%)`);
console.log(`  Option 5 (E): ${dist[4].toLocaleString()} (${((dist[4]/mcqProcessed)*100).toFixed(1)}%)`);

console.log(`\n══════════════════════════════════════════════════`);
console.log(` SUMMARY OF PERSPECTIVES`);
console.log(`══════════════════════════════════════════════════`);
const totalVulnerabilities = metrics.longer_correct_option + metrics.correct_shares_more_word_with_stem;
console.log(`Highly Vulnerable MCQs (Test-wiseness): ~${totalVulnerabilities.toLocaleString()} cases`);
