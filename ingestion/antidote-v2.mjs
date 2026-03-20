/**
 * PRAXIS — Antidote v2 (Mop-Up Protocol)
 * Fixes 664 remaining MedMCQA mismatches that survived Antidote v1
 * Usage: node ingestion/antidote-v2.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';

function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCopBase(items) {
  const values = new Set(items.map((item) => Number.parseInt(item?.cop, 10)).filter(Number.isInteger));
  if (values.has(0) && values.has(4)) {
    throw new Error('Mixed MedMCQA `cop` bases detected in raw source.');
  }
  if (values.has(0)) return 0;
  if (values.has(4)) return 1;
  throw new Error(`Unable to infer MedMCQA \`cop\` base from values: ${[...values].sort((a, b) => a - b).join(', ')}`);
}

console.log('💉 ANTIDOTE v2 — MOP-UP PROTOCOL\n');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const copBase = detectCopBase(raw);
console.log(`🧭 MedMCQA \`cop\` base detected: ${copBase}-indexed`);

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
  
  const rawCorrectText = [r.opa, r.opb, r.opc, r.opd][Number.parseInt(r.cop, 10) - copBase];
  if (!rawCorrectText) continue;
  
  const dbCorrect = c.options?.find(o => o.is_correct);
  const anchoredOption = c.options?.find(
    (option) => normalizeComparable(option?.text) === normalizeComparable(rawCorrectText),
  );
  if (!anchoredOption) { notFound++; continue; }
  
  if (normalizeComparable(dbCorrect?.text) === normalizeComparable(rawCorrectText)) { already++; continue; }
  
  // FIX: Set correct answer
  c.options.forEach(o => { o.is_correct = normalizeComparable(o.text) === normalizeComparable(rawCorrectText); });
  c.meta.antidote_v2 = true;
  c.meta.antidote_applied = true;
  c.meta.answer_anchor_text = rawCorrectText;
  
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
