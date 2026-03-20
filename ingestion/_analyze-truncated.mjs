import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB, 'utf8'));

const truncated = db.filter(c => c.meta?.quarantine_reason === 'truncated');

// Analyze text lengths
const lengths = truncated.map(c => (c.question || '').length);
lengths.sort((a,b) => a - b);

console.log(`Truncated cases: ${truncated.length}`);
console.log(`Text length distribution:`);
console.log(`  Min:    ${lengths[0]}`);
console.log(`  10th%:  ${lengths[Math.floor(lengths.length * 0.1)]}`);
console.log(`  25th%:  ${lengths[Math.floor(lengths.length * 0.25)]}`);
console.log(`  50th%:  ${lengths[Math.floor(lengths.length * 0.5)]}`);
console.log(`  75th%:  ${lengths[Math.floor(lengths.length * 0.75)]}`);
console.log(`  90th%:  ${lengths[Math.floor(lengths.length * 0.9)]}`);
console.log(`  Max:    ${lengths[lengths.length - 1]}`);

// Buckets
const buckets = { '<20': 0, '20-30': 0, '30-40': 0, '40-49': 0 };
truncated.forEach(c => {
  const len = (c.question || '').length;
  if (len < 20) buckets['<20']++;
  else if (len < 30) buckets['20-30']++;
  else if (len < 40) buckets['30-40']++;
  else buckets['40-49']++;
});
console.log('\nLength buckets:');
for (const [b, n] of Object.entries(buckets)) console.log(`  ${b}: ${n}`);

// How many have options?
const withOpts = truncated.filter(c => (c.options || []).length >= 2);
const withCorrect = truncated.filter(c => (c.options || []).some(o => o.is_correct));
console.log(`\nHave ≥2 options: ${withOpts.length}`);
console.log(`Have correct answer marked: ${withCorrect.length}`);

// Show 10 random samples
console.log('\n═══ RANDOM SAMPLES ═══');
const shuffled = [...truncated].sort(() => Math.random() - 0.5);
for (const c of shuffled.slice(0, 15)) {
  const q = (c.question || '').replace(/\n/g, ' ');
  const opts = (c.options || []).map(o => `${o.id}:${(o.text||'').slice(0,30)}${o.is_correct?'✓':''}`).join(' | ');
  console.log(`\n  [${c._id}] ${c.meta?.source} | ${c.category}`);
  console.log(`  Q: "${q}"`);
  console.log(`  Opts: ${opts || 'NONE'}`);
}
