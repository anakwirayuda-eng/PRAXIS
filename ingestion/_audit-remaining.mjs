/**
 * Audit remaining 874 no-correct-answer cases — detail breakdown
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

console.log(`Remaining no-correct: ${noCorrect.length}\n`);

// By source
const bySrc = {};
noCorrect.forEach(c => { const s = c.meta?.source || '?'; bySrc[s] = (bySrc[s] || 0) + 1; });
console.log('BY SOURCE:');
Object.entries(bySrc).sort((a,b) => b[1]-a[1]).forEach(([s,n]) => console.log(`  ${n.toString().padStart(5)}  ${s}`));

// Has question text?
const hasQ = noCorrect.filter(c => (c.question || '').length > 10).length;
const emptyQ = noCorrect.length - hasQ;
console.log(`\nHas question: ${hasQ}, Empty question: ${emptyQ}`);

// Has Holy Trinity enrichment?
const hasHT = noCorrect.filter(c => c.meta?.is_holy_trinity).length;
console.log(`Has Holy Trinity: ${hasHT}`);

// Rationale quality
const goodRat = noCorrect.filter(c => (c.rationale?.correct || '').length > 50).length;
const mismatchRat = noCorrect.filter(c => {
  const q = (c.question || '').toLowerCase();
  const r = (c.rationale?.correct || '').toLowerCase();
  if (q.length < 10 || r.length < 30) return false;
  // Check if rationale shares ANY keyword with question
  const qWords = new Set(q.split(/\s+/).filter(w => w.length > 4));
  const rWords = r.split(/\s+/).filter(w => w.length > 4);
  const overlap = rWords.filter(w => qWords.has(w)).length;
  return overlap < 2; // less than 2 shared words = mismatch
}).length;
console.log(`Good rationale (>50 chars): ${goodRat}`);
console.log(`Likely mismatched rationale: ${mismatchRat}`);

// Options count
const optCounts = {};
noCorrect.forEach(c => { optCounts[c.options.length] = (optCounts[c.options.length] || 0) + 1; });
console.log('\nOption counts:', optCounts);

// Verdict
console.log('\n═══ VERDICT ═══');
console.log(`  Recoverable via source: 0 (already tried)`);
console.log(`  Total to quarantine or send to API: ${noCorrect.length}`);
const cost = noCorrect.length * 0.0003;
console.log(`  API cost estimate (gpt-4.1-mini): ~$${cost.toFixed(2)}`);
