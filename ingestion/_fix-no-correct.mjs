/**
 * Recover correct answers for 1,053 cases by matching to MedMCQA source
 * MedMCQA has `cop` field (1-4) = correct option position
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const MCQA_PATH = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');

console.log('🔧 Loading databases...');
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const mcqa = JSON.parse(readFileSync(MCQA_PATH, 'utf8'));

// Build fingerprint map from MedMCQA source
// Key: first 60 chars of question (lowercase) → { cop, opa, opb, opc, opd }
console.log(`   MedMCQA source: ${mcqa.length.toLocaleString()} records`);

const srcMap = new Map();
for (const r of mcqa) {
  if (!r.question || !r.cop) continue;
  const key = r.question.trim().toLowerCase().slice(0, 60);
  if (key.length >= 10) srcMap.set(key, r);
}
console.log(`   Source fingerprints: ${srcMap.size.toLocaleString()}`);

// Find cases with no correct answer
const noCorrect = db.filter(c => {
  if (!Array.isArray(c.options) || c.options.length < 2) return false;
  return !c.options.some(o => o.is_correct);
});
console.log(`\n📋 Cases with no correct answer: ${noCorrect.length}`);

let fixed = 0, notFound = 0, ambiguous = 0;
const COP_TO_LETTER = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };

for (const c of noCorrect) {
  const q = (c.question || '').trim().toLowerCase().slice(0, 60);
  if (q.length < 10) { notFound++; continue; }
  
  const match = srcMap.get(q);
  if (!match) {
    // Try option-based matching
    const optKey = c.options.map(o => (o.text || '').trim().toLowerCase().slice(0, 30)).join('|');
    let optMatch = null;
    for (const r of mcqa) {
      const srcOptKey = [r.opa, r.opb, r.opc, r.opd].map(o => (o || '').trim().toLowerCase().slice(0, 30)).join('|');
      if (srcOptKey === optKey && srcOptKey.length > 20) { optMatch = r; break; }
    }
    if (!optMatch) { notFound++; continue; }
    
    const correctLetter = COP_TO_LETTER[optMatch.cop];
    if (correctLetter) {
      c.options.forEach(o => { o.is_correct = (o.id === correctLetter); });
      fixed++;
    }
    continue;
  }
  
  const correctLetter = COP_TO_LETTER[match.cop];
  if (!correctLetter) { ambiguous++; continue; }
  
  c.options.forEach(o => { o.is_correct = (o.id === correctLetter); });
  fixed++;
}

console.log(`\n✅ Fixed: ${fixed}`);
console.log(`❌ Not found in source: ${notFound}`);
console.log(`⚠️  Ambiguous: ${ambiguous}`);

// Check remaining
const stillBroken = db.filter(c => {
  if (!Array.isArray(c.options) || c.options.length < 2) return false;
  return !c.options.some(o => o.is_correct);
});
console.log(`\n📊 Still no correct answer: ${stillBroken.length}`);

// Save
writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log('💾 Saved.');
