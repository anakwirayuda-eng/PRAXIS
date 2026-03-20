import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB, 'utf8'));

// Find ALL non-standard categories (anything not in our 20 SKDI list)
const STANDARD = new Set([
  'Ilmu Penyakit Dalam','Bedah','Obstetri & Ginekologi','Ilmu Kesehatan Anak',
  'Neurologi','Psikiatri','Kulit & Kelamin','Mata','THT',
  'Ilmu Kesehatan Masyarakat','Farmakologi','Forensik','Radiologi',
  'Patologi Anatomi','Patologi Klinik','Anestesi & Emergency Medicine',
  'Mikrobiologi','Biokimia','Anatomi','Kedokteran Gigi','Rehabilitasi Medik',
]);

const FIXMAP = {
  'Neurology': 'Neurologi',
  'Neurology and Neurosurgery': 'Neurologi',
  'Fisiologi': 'Anatomi',
  'Histologi': 'Anatomi',
};

const stray = {};
let fixed = 0;
for (const c of db) {
  if (!STANDARD.has(c.category)) {
    stray[c.category] = (stray[c.category] || 0) + 1;
    if (FIXMAP[c.category]) {
      c.meta = c.meta || {};
      c.meta._original_category = c.category;
      c.category = FIXMAP[c.category];
      fixed++;
    }
  }
}

console.log('Stray categories found:');
for (const [c, n] of Object.entries(stray).sort((a,b) => b[1]-a[1])) {
  console.log('  ' + n + '  ' + c + (FIXMAP[c] ? ' → FIXED to ' + FIXMAP[c] : ' → NO MAPPING'));
}
console.log('Fixed:', fixed);

const tmp = DB + '.tmp';
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB);
console.log('Saved.');
