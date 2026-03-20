import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB, 'utf8'));
const q = db.filter(c => c.meta?.quarantined);

// By category
const cats = {};
q.forEach(c => { cats[c.category] = (cats[c.category] || 0) + 1; });
console.log(`Quarantined: ${q.length.toLocaleString()}\n`);
console.log('By Category:');
Object.entries(cats).sort((a,b) => b[1]-a[1]).forEach(([c,n]) => {
  console.log(`  ${n.toString().padStart(6)}  ${c}`);
});

// By reason × category (top combos)
console.log('\nBy Reason:');
const reasons = {};
q.forEach(c => { 
  const r = c.meta?.quarantine_reason || '?';
  reasons[r] = reasons[r] || {};
  reasons[r][c.category] = (reasons[r][c.category] || 0) + 1;
});
for (const [reason, catMap] of Object.entries(reasons)) {
  const total = Object.values(catMap).reduce((a,b) => a+b, 0);
  console.log(`\n  ${reason} (${total.toLocaleString()}):`);
  Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,5).forEach(([c,n]) => {
    console.log(`    ${n.toString().padStart(5)}  ${c}`);
  });
}

// Fixability analysis
console.log('\n\n🔧 FIXABILITY ANALYSIS:');
let fixableByBatch = 0;  // has question text but missing answer
let fixableByCleanup = 0; // garbled but has some readable content
let unfixable = 0;

for (const c of q) {
  const r = c.meta?.quarantine_reason;
  const text = c.question || '';
  if (r === 'no_correct_answer' && text.length > 50) fixableByBatch++;
  else if (r === 'truncated' && text.length > 30) fixableByCleanup++;
  else if (r === 'garbled_caps' && text.length > 80) fixableByCleanup++;
  else unfixable++;
}
console.log(`  Fixable by Holy Trinity batch (has text, needs answer): ${fixableByBatch.toLocaleString()}`);
console.log(`  Potentially salvageable (truncated but partial text):   ${fixableByCleanup.toLocaleString()}`);
console.log(`  Unfixable (too short/garbage):                         ${unfixable.toLocaleString()}`);
