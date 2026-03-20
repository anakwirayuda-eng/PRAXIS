/**
 * PRAXIS — Endgame Micro-Fixes
 * 1. Flag clinical decay cases (meta.is_decayed)
 * 2. Flag negation blindspot cases for targeted regen
 * Usage: node ingestion/endgame-flags.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

const WITHDRAWN_DRUGS = /\b(ranitidine|ranitidin|cisapride|sibutramine|rofecoxib|troglitazone|dextropropoxyphene|tegaserod|phenylpropanolamine)\b/i;
const OUTDATED_GUIDELINES = /\b(JNC\s*7|JNC\s*VI|ATP\s*III|AHA\s*201[0-5]|WHO\s*201[0-5]|ACOG\s*201[0-5])\b/i;
const NEGATION_Q = /\b(kecuali|except|not true|least likely|bukan|tidak benar|incorrect|false statement|contraindicated)\b/i;
const AFFIRM_RAT = /(adalah pilihan utama|is the (correct|recommended|best)|paling tepat|is true because|merupakan (jawaban|pilihan) yang (benar|tepat)|is the correct answer because)/i;

let decayed = 0, negation = 0;
const negationIds = [];

for (const c of db) {
  if (c.q_type !== 'MCQ' || !Array.isArray(c.options)) continue;
  
  const correctOpt = c.options.find(o => o.is_correct);
  if (!correctOpt) continue;
  const wrongOpts = c.options.filter(o => !o.is_correct);
  const q = (c.vignette?.narrative || c.prompt || '');
  const rat = (c.rationale?.correct || '');
  const fullText = q + ' ' + correctOpt.text + ' ' + wrongOpts.map(o => o.text || '').join(' ') + ' ' + rat;

  // Clinical Decay flag
  if (WITHDRAWN_DRUGS.test(fullText) || OUTDATED_GUIDELINES.test(fullText)) {
    if (!c.meta.is_decayed) { c.meta.is_decayed = true; decayed++; }
  }

  // Negation Blindspot flag
  if (NEGATION_Q.test(q) && rat.length > 50 && AFFIRM_RAT.test(rat)) {
    if (!c.meta.negation_blindspot) { c.meta.negation_blindspot = true; negation++; negationIds.push(c._id); }
  }
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf-8');
fs.writeFileSync('ingestion/output/negation_blindspot_ids.json', JSON.stringify(negationIds, null, 2), 'utf-8');

console.log(`✅ Endgame flags injected:`);
console.log(`   🏛️ Clinical Decay (is_decayed): ${decayed}`);
console.log(`   ☠️ Negation Blindspot: ${negation} (IDs saved)`);
