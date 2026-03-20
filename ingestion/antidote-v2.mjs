/**
 * PRAXIS — Antidote v2 (Mop-Up Protocol)
 * Fixes 664 remaining MedMCQA mismatches that survived Antidote v1
 * Usage: node ingestion/antidote-v2.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';
const COP = { 0: 'A', 1: 'B', 2: 'C', 3: 'D' };

console.log('💉 ANTIDOTE v2 — MOP-UP PROTOCOL\n');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));

// Build fingerprint map
const rawByFP = new Map();
raw.forEach(item => {
  if (!item.opa) return;
  const fp = [item.opa, item.opb, item.opc, item.opd]
    .map(o => (o || '').trim().toLowerCase().slice(0, 30))
    .sort().join('|');
  rawByFP.set(fp, item);
});

let fixed = 0, already = 0, notFound = 0;

for (const c of db) {
  if (c.meta?.source !== 'medmcqa') continue;
  
  const fp = (c.options || []).map(o => (o.text || '').trim().toLowerCase().slice(0, 30)).sort().join('|');
  const r = rawByFP.get(fp);
  if (!r) { notFound++; continue; }
  
  const trueC = COP[parseInt(r.cop, 10)];
  if (!trueC) continue;
  
  const dbC = c.options?.find(o => o.is_correct)?.id;
  
  if (trueC === dbC) { already++; continue; }
  
  // FIX: Set correct answer
  c.options.forEach(o => { o.is_correct = (o.id === trueC); });
  c.meta.antidote_v2 = true;
  c.meta.antidote_applied = true;
  
  // Restore original rationale if available
  const origExp = (r.exp || '').trim();
  if (origExp.length > 20) {
    c.rationale = { correct: origExp, distractors: {}, pearl: null };
  } else {
    c.meta.needs_rationale_regen = true;
  }
  
  fixed++;
}

// Save
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf8');

console.log(`✅ ANTIDOTE v2 COMPLETE`);
console.log(`   Already correct: ${already}`);
console.log(`   Fixed:           ${fixed}`);
console.log(`   Not in raw:      ${notFound}`);
