import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB, 'utf8'));
const q = db.filter(c => c.meta && c.meta.quarantined);
console.log('Still quarantined:', q.length);

const reasons = {};
q.forEach(c => { reasons[c.meta.quarantine_reason || '?'] = (reasons[c.meta.quarantine_reason || '?'] || 0) + 1; });
Object.entries(reasons).sort((a,b) => b[1]-a[1]).forEach(([r,n]) => console.log('  ' + n + '  ' + r));

// no_correct_answer breakdown
const noAns = q.filter(c => c.meta.quarantine_reason === 'no_correct_answer');
console.log('\nno_correct_answer:', noAns.length);
const fixable = noAns.filter(c => c.question && c.question.length > 30);
console.log('  with question text (FIXABLE):', fixable.length);
console.log('  without question text:', noAns.length - fixable.length);

// truncated remaining
const trunc = q.filter(c => c.meta.quarantine_reason === 'truncated');
console.log('\ntruncated remaining:', trunc.length);
const truncFixable = trunc.filter(c => c.question && c.question.length > 30);
console.log('  with partial text (salvageable):', truncFixable.length);
console.log('  still empty:', trunc.length - truncFixable.length);

// Show samples of fixable no_correct_answer
console.log('\n═══ Fixable no_correct_answer samples ═══');
fixable.slice(0, 5).forEach(c => {
  console.log(`  [${c._id}] ${c.category}`);
  console.log(`  Q: ${(c.question||'').slice(0,100)}`);
  console.log(`  Opts: ${(c.options||[]).map(o=>o.id+':'+o.is_correct).join(', ')}`);
  console.log();
});
