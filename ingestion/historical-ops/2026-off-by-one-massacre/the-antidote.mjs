/**
 * PRAXIS — The Antidote Protocol (DEFCON 1)
 * Resolves the "Off-By-One Massacre" & Purges AI Sycophancy
 * 
 * Matches by option-text fingerprint (immune to ID shifts from merger)
 * Usage: node ingestion/the-antidote.mjs
 */
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve('public/data/compiled_cases.json');
const RAW_PATH = path.resolve('ingestion/sources/medmcqa/medmcqa_raw.json');

console.log('🚨 INITIATING THE ANTIDOTE PROTOCOL...\n');

// 1. Load Raw MedMCQA as Ultimate Source of Truth
const rawData = JSON.parse(fs.readFileSync(RAW_PATH, 'utf-8'));
console.log(`📦 Raw MedMCQA: ${rawData.length} cases`);

// Build fingerprint map: sorted option texts → raw case
// This is immune to option reordering and ID shifts from merger
const rawByFingerprint = new Map();
const rawByHashIdx = new Map();

rawData.forEach((item, idx) => {
  if (!item.question || !item.opa) return;
  
  // Fingerprint: sorted, trimmed, lowercased first 30 chars of each option
  const fp = [item.opa, item.opb, item.opc, item.opd]
    .map(o => (o || '').trim().toLowerCase().slice(0, 30))
    .sort()
    .join('|');
  rawByFingerprint.set(fp, item);
  
  // Also index by hash_id pattern
  rawByHashIdx.set(`medmcqa_${item.id || idx}`, item);
});

console.log(`🔑 Fingerprint index: ${rawByFingerprint.size} | Hash index: ${rawByHashIdx.size}`);

// 2. Load Production Database
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
console.log(`📊 Production DB: ${db.length} cases\n`);

const TRUE_COP_MAP = { 0: 'A', 1: 'B', 2: 'C', 3: 'D' };

let stats = {
  medmcqa_total: 0,
  matched: 0,
  unmatched: 0,
  lucky_zeroes: 0,
  already_correct: 0,
  fixed_answers: 0,
  purged_ai_poison: 0,
  restored_original_exp: 0,
};

for (const c of db) {
  // Only process MedMCQA cases
  if (c.meta?.source !== 'medmcqa' && !String(c.hash_id || '').startsWith('medmcqa_')) continue;
  stats.medmcqa_total++;

  // Match: try hash_id first, then fingerprint
  let raw = rawByHashIdx.get(c.hash_id);
  
  if (!raw) {
    // Fingerprint match
    const fp = (c.options || [])
      .map(o => (o.text || '').trim().toLowerCase().slice(0, 30))
      .sort()
      .join('|');
    raw = rawByFingerprint.get(fp);
  }

  if (!raw || raw.cop === undefined || raw.cop === null) {
    stats.unmatched++;
    continue;
  }
  stats.matched++;

  const copIndex = parseInt(raw.cop, 10);
  const trueLetter = TRUE_COP_MAP[copIndex];
  if (!trueLetter) {
    stats.unmatched++;
    continue;
  }

  const currentCorrect = c.options?.find(o => o.is_correct);
  
  if (!currentCorrect) continue;

  // Check if already correct
  if (currentCorrect.id === trueLetter) {
    if (copIndex === 0) stats.lucky_zeroes++;
    else stats.already_correct++;
    continue;
  }

  // 🚨 THE MASSACRE DETECTED — Fix the answer
  c.options.forEach(o => { o.is_correct = (o.id === trueLetter); });
  stats.fixed_answers++;

  // PROTOCOL: PURGE AI SYCOPHANCY
  // If rationale was generated/enriched by AI batches, it justified the WRONG answer
  const ratText = c.rationale?.correct || '';
  const isAiGenerated = (
    c.meta?.is_holy_trinity ||
    c.meta?.triangulated ||
    ratText.includes('[Board') ||
    ratText.includes('## Why') ||
    ratText.includes('**Why') ||
    ratText.length > 300 // AI rationales tend to be verbose
  );

  const originalExp = (raw.exp || '').trim();

  if (isAiGenerated && originalExp.length > 20) {
    // Replace AI hallucination with original MedMCQA explanation
    c.rationale = {
      correct: originalExp,
      distractors: {},
      pearl: null,
    };
    // Strip holy trinity flags
    delete c.meta.is_holy_trinity;
    delete c.meta.triangulated;
    c.meta.antidote_applied = true;
    stats.purged_ai_poison++;
  } else if (originalExp.length > 20) {
    // Not AI-generated but answer was still wrong — restore original exp
    c.rationale = c.rationale || {};
    c.rationale.correct = originalExp;
    c.meta.antidote_applied = true;
    stats.restored_original_exp++;
  } else {
    // No original explanation available, just fix the answer
    c.meta.antidote_applied = true;
    c.meta.needs_rationale_regen = true;
  }
}

// 3. ATOMIC SAVE
console.log('💾 Saving Purified Database...');
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf-8');

console.log(`
╔══════════════════════════════════════════════╗
║  ✅ ANTIDOTE PROTOCOL COMPLETE              ║
║  EXTINCTION EVENT AVERTED                    ║
╚══════════════════════════════════════════════╝

   📊 MedMCQA in DB:         ${stats.medmcqa_total}
   🔗 Matched to raw:        ${stats.matched}
   ❓ Unmatched:              ${stats.unmatched}
   ─────────────────────────────
   🍀 Lucky Zeroes (cop=0):   ${stats.lucky_zeroes}
   ✅ Already correct:        ${stats.already_correct}
   💉 ANSWERS FIXED:          ${stats.fixed_answers}
   🤮 AI Poison Purged:       ${stats.purged_ai_poison}
   📝 Original Exp Restored:  ${stats.restored_original_exp}
`);
