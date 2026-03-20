import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB, 'utf8'));
const clean = db.filter(c => !c.meta?.quarantined);
const cats = {};
clean.forEach(c => { cats[c.category] = (cats[c.category] || 0) + 1; });
console.log(`Clean cases: ${clean.length.toLocaleString()} / ${db.length.toLocaleString()}\n`);
Object.entries(cats).sort((a,b) => b[1]-a[1]).forEach(([c,n]) => {
  const pct = ((n / clean.length) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(n / clean.length * 50));
  console.log(`${n.toString().padStart(7)}  ${pct.padStart(5)}%  ${bar}  ${c}`);
});
