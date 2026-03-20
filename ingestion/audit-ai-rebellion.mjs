/**
 * PRAXIS — AI Rebellion Audit (Semantic Dissonance Scanner)
 * Detects Holy Trinity rationales that explain the WRONG answer
 * Usage: node ingestion/audit-ai-rebellion.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

console.log('📡 ACTIVATING AI HALLUCINATION RADAR...\n');

let stats = { checked: 0, safe: 0, suspicious: 0, no_rationale: 0 };
const suspectIds = [];

for (const c of db) {
  // Only check MedMCQA that were NOT touched by Antidote (i.e. Holy Trinity auto-corrected)
  if (c.meta?.source !== 'medmcqa') continue;
  if (c.meta?.antidote_applied) continue; // Already cleaned by Antidote
  
  const correctOpt = c.options?.find(o => o.is_correct);
  const ratText = (c.rationale?.correct || '').toLowerCase();
  
  if (!correctOpt || ratText.length < 50) {
    stats.no_rationale++;
    continue;
  }
  
  stats.checked++;
  
  // Extract meaningful words (5+ chars) from correct option text
  const correctKeywords = (correctOpt.text || '').toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
  
  // Check if rationale mentions ANY keyword from the correct answer
  const mentionsCorrect = correctKeywords.length === 0 || 
    correctKeywords.some(kw => ratText.includes(kw));
  
  // Also check if rationale is suspiciously explaining a WRONG option
  const wrongOpts = c.options.filter(o => !o.is_correct);
  let mentionsWrongStrongly = false;
  for (const wo of wrongOpts) {
    const woKeywords = (wo.text || '').toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
    const woMatches = woKeywords.filter(kw => ratText.includes(kw)).length;
    const correctMatches = correctKeywords.filter(kw => ratText.includes(kw)).length;
    // Suspicious: rationale mentions wrong option more than correct option
    if (woKeywords.length >= 2 && woMatches > correctMatches + 1) {
      mentionsWrongStrongly = true;
      break;
    }
  }

  if (!mentionsCorrect || mentionsWrongStrongly) {
    stats.suspicious++;
    suspectIds.push(c._id);
    if (suspectIds.length <= 5) {
      console.log(`  ⚠️ ID ${c._id} (${c.case_code}): correct=${correctOpt.id}:"${correctOpt.text.slice(0,40)}" | rat mentions wrong opt`);
    }
  } else {
    stats.safe++;
  }
}

console.log(`\n✅ RADAR COMPLETE.`);
console.log(`   🔍 Checked:       ${stats.checked}`);
console.log(`   🛡️ Safe:          ${stats.safe}`);
console.log(`   ⚠️ Suspicious:    ${stats.suspicious}`);
console.log(`   📭 No rationale:  ${stats.no_rationale}`);

// Save suspect IDs for batch regen
if (suspectIds.length > 0) {
  fs.writeFileSync('ingestion/output/ai_rebellion_suspects.json', JSON.stringify(suspectIds, null, 2));
  console.log(`\n💾 Saved ${suspectIds.length} suspect IDs to output/ai_rebellion_suspects.json`);
}

// Also collect IDs that need rationale regen (from Antidote)
const needsRegen = db.filter(c => c.meta?.needs_rationale_regen).map(c => c._id);
console.log(`\n📋 Total needing rationale regen: ${needsRegen.length} (Antidote) + ${suspectIds.length} (AI Rebellion) = ${needsRegen.length + suspectIds.length}`);
