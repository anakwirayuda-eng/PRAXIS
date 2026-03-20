import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'compiled_cases.json'), 'utf8'));

// Count distinct sources
const sources = {};
db.forEach(c => {
  const s = c.meta?.source || 'unknown';
  sources[s] = (sources[s] || 0) + 1;
});
console.log('═══ SOURCES IN DB ═══');
Object.entries(sources).sort((a,b) => b[1]-a[1]).forEach(([s,n]) => console.log(`  ${n.toString().padStart(6)}  ${s}`));

// Count q_type
const types = {};
db.forEach(c => { types[c.q_type || '?'] = (types[c.q_type || '?'] || 0) + 1; });
console.log('\n═══ Q_TYPES ═══');
Object.entries(types).sort((a,b) => b[1]-a[1]).forEach(([t,n]) => console.log(`  ${n.toString().padStart(6)}  ${t}`));

// Check exam_type or exam field
const exams = {};
db.forEach(c => {
  const e = c.exam_type || c.exam || c.meta?.exam || 'none';
  exams[e] = (exams[e] || 0) + 1;
});
console.log('\n═══ EXAM_TYPE FIELD ═══');
Object.entries(exams).sort((a,b) => b[1]-a[1]).forEach(([e,n]) => console.log(`  ${n.toString().padStart(6)}  ${e}`));
