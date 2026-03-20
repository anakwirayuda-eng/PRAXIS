/**
 * PRAXIS — E2E Deep Smoke Test
 * Comprehensive audit across all sources: structural, semantic, cross-validation
 * Usage: node ingestion/e2e-smoke-test.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const RAW_MEDMCQA_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';

console.log('═══════════════════════════════════════════════');
console.log(' PRAXIS E2E DEEP SMOKE TEST');
console.log(' Wide & Down — Every Layer, Every Source');
console.log('═══════════════════════════════════════════════\n');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const rawMedMCQA = JSON.parse(fs.readFileSync(RAW_MEDMCQA_PATH, 'utf-8'));

const TRUE_COP_MAP = { 0: 'A', 1: 'B', 2: 'C', 3: 'D' };

// Build raw fingerprint map for MedMCQA cross-validation
const rawByFP = new Map();
rawMedMCQA.forEach(item => {
  if (!item.opa) return;
  const fp = [item.opa, item.opb, item.opc, item.opd]
    .map(o => (o || '').trim().toLowerCase().slice(0, 30))
    .sort().join('|');
  rawByFP.set(fp, item);
});

// ═══════════════════════════════════════
// LAYER 1: STRUCTURAL INTEGRITY
// ═══════════════════════════════════════
console.log('📐 LAYER 1: STRUCTURAL INTEGRITY');
let L1 = { total: 0, noQuestion: 0, noOptions: 0, noCorrect: 0, multiCorrect: 0, emptyOptionText: 0, duplicateIds: 0 };
const idSet = new Set();

for (const c of db) {
  L1.total++;
  if (!c.vignette?.narrative && !c.prompt) L1.noQuestion++;
  if (!Array.isArray(c.options) || c.options.length < 2) { L1.noOptions++; continue; }
  const corrects = c.options.filter(o => o.is_correct);
  if (corrects.length === 0) L1.noCorrect++;
  if (corrects.length > 1) L1.multiCorrect++;
  if (c.options.some(o => !o.text || o.text.trim().length === 0)) L1.emptyOptionText++;
  if (idSet.has(c._id)) L1.duplicateIds++;
  idSet.add(c._id);
}

console.log(`   Total cases:       ${L1.total}`);
console.log(`   No question:       ${L1.noQuestion} ${L1.noQuestion > 0 ? '🔴' : '✅'}`);
console.log(`   No options (<2):   ${L1.noOptions} ${L1.noOptions > 0 ? '🔴' : '✅'}`);
console.log(`   No correct answer: ${L1.noCorrect} ${L1.noCorrect > 0 ? '🔴' : '✅'}`);
console.log(`   Multi correct:     ${L1.multiCorrect} ${L1.multiCorrect > 0 ? '⚠️' : '✅'}`);
console.log(`   Empty option text: ${L1.emptyOptionText} ${L1.emptyOptionText > 0 ? '⚠️' : '✅'}`);
console.log(`   Duplicate _id:     ${L1.duplicateIds} ${L1.duplicateIds > 0 ? '🔴' : '✅'}`);

// ═══════════════════════════════════════
// LAYER 2: MEDMCQA ANSWER KEY CROSS-VALIDATION (vs Raw Source)
// ═══════════════════════════════════════
console.log('\n🔬 LAYER 2: MEDMCQA ANSWER KEY CROSS-VALIDATION');
let L2 = { checked: 0, matched: 0, mismatch: 0, notFound: 0, mismatches: [] };

for (const c of db) {
  if (c.meta?.source !== 'medmcqa') continue;
  
  const fp = (c.options || [])
    .map(o => (o.text || '').trim().toLowerCase().slice(0, 30))
    .sort().join('|');
  const raw = rawByFP.get(fp);
  
  if (!raw) { L2.notFound++; continue; }
  L2.checked++;
  
  const trueCorrect = TRUE_COP_MAP[parseInt(raw.cop, 10)];
  const dbCorrect = c.options?.find(o => o.is_correct)?.id;
  
  if (trueCorrect === dbCorrect) {
    L2.matched++;
  } else {
    L2.mismatch++;
    if (L2.mismatches.length < 5) {
      L2.mismatches.push({
        id: c._id, code: c.case_code,
        raw_cop: raw.cop, true_answer: trueCorrect, db_answer: dbCorrect,
        q: (c.vignette?.narrative || '').slice(0, 60),
      });
    }
  }
}

console.log(`   Checked:           ${L2.checked}`);
console.log(`   ✅ Matched:        ${L2.matched} (${(L2.matched/L2.checked*100).toFixed(1)}%)`);
console.log(`   🔴 Mismatch:       ${L2.mismatch} ${L2.mismatch > 0 ? '🔴' : '✅'}`);
console.log(`   Not found in raw:  ${L2.notFound}`);
if (L2.mismatches.length > 0) {
  console.log('   Sample mismatches:');
  L2.mismatches.forEach(m => console.log(`     ID ${m.id} (${m.code}): raw_cop=${m.raw_cop} → should be ${m.true_answer}, DB has ${m.db_answer} | "${m.q}"`));
}

// ═══════════════════════════════════════
// LAYER 3: RATIONALE-ANSWER SEMANTIC COHERENCE
// ═══════════════════════════════════════
console.log('\n🧠 LAYER 3: RATIONALE-ANSWER SEMANTIC COHERENCE');
let L3 = { checked: 0, coherent: 0, suspicious: 0, noRationale: 0, samples: [] };

// Random sample 500 cases across ALL sources
const sampleIndices = [];
for (let i = 0; i < 500; i++) {
  sampleIndices.push(Math.floor(Math.random() * db.length));
}

for (const idx of sampleIndices) {
  const c = db[idx];
  if (c.q_type !== 'MCQ') continue;
  
  const correctOpt = c.options?.find(o => o.is_correct);
  const ratText = (c.rationale?.correct || '').toLowerCase();
  
  if (!correctOpt || ratText.length < 30) { L3.noRationale++; continue; }
  L3.checked++;
  
  // Extract keywords from correct answer
  const keywords = (correctOpt.text || '').toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const mentionsCorrect = keywords.length === 0 || keywords.some(kw => ratText.includes(kw));
  
  // Check if rationale mentions wrong answer more prominently
  let mentionsWrongMore = false;
  for (const wo of c.options.filter(o => !o.is_correct)) {
    const woKeys = (wo.text || '').toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
    const woHits = woKeys.filter(k => ratText.includes(k)).length;
    const correctHits = keywords.filter(k => ratText.includes(k)).length;
    if (woKeys.length >= 2 && woHits > correctHits + 2) {
      mentionsWrongMore = true;
      break;
    }
  }
  
  if (mentionsCorrect && !mentionsWrongMore) {
    L3.coherent++;
  } else {
    L3.suspicious++;
    if (L3.samples.length < 3) {
      L3.samples.push({
        id: c._id, code: c.case_code, source: c.meta?.source,
        correct: `${correctOpt.id}: ${correctOpt.text?.slice(0, 40)}`,
        rat: ratText.slice(0, 80),
      });
    }
  }
}

console.log(`   Sampled:           ${L3.checked} (from 500 random)`);
console.log(`   ✅ Coherent:       ${L3.coherent} (${L3.checked > 0 ? (L3.coherent/L3.checked*100).toFixed(1) : 0}%)`);
console.log(`   ⚠️ Suspicious:    ${L3.suspicious} (${L3.checked > 0 ? (L3.suspicious/L3.checked*100).toFixed(1) : 0}%)`);
console.log(`   📭 No rationale:  ${L3.noRationale}`);
if (L3.samples.length > 0) {
  console.log('   Sample suspicious:');
  L3.samples.forEach(s => console.log(`     ID ${s.id} (${s.source}): correct=${s.correct} | rat="${s.rat}..."`));
}

// ═══════════════════════════════════════
// LAYER 4: SOURCE DISTRIBUTION & CATEGORY HEALTH
// ═══════════════════════════════════════
console.log('\n📊 LAYER 4: SOURCE & CATEGORY DISTRIBUTION');
const srcStats = {};
const catStats = {};
const typeStats = {};

for (const c of db) {
  const src = c.meta?.source || 'unknown';
  srcStats[src] = srcStats[src] || { total: 0, hasRationale: 0, hasCorrect: 0 };
  srcStats[src].total++;
  if (c.rationale?.correct && c.rationale.correct.length > 20) srcStats[src].hasRationale++;
  if (c.options?.some(o => o.is_correct)) srcStats[src].hasCorrect++;
  
  const cat = c.category || 'unknown';
  catStats[cat] = (catStats[cat] || 0) + 1;
  
  const qt = c.q_type || 'unknown';
  typeStats[qt] = (typeStats[qt] || 0) + 1;
}

console.log('   By Source (top 15):');
Object.entries(srcStats).sort((a,b) => b[1].total - a[1].total).slice(0, 15).forEach(([src, s]) => {
  const ratPct = s.total > 0 ? (s.hasRationale/s.total*100).toFixed(0) : 0;
  const corrPct = s.total > 0 ? (s.hasCorrect/s.total*100).toFixed(0) : 0;
  const flag = corrPct < 100 ? '🔴' : ratPct < 50 ? '⚠️' : '✅';
  console.log(`     ${flag} ${src}: ${s.total} (${corrPct}% has correct, ${ratPct}% has rationale)`);
});

console.log('\n   By Category:');
Object.entries(catStats).sort((a,b) => b[1] - a[1]).forEach(([cat, n]) => {
  console.log(`     ${cat}: ${n} (${(n/db.length*100).toFixed(1)}%)`);
});

console.log('\n   By Question Type:');
Object.entries(typeStats).forEach(([qt, n]) => console.log(`     ${qt}: ${n}`));

// ═══════════════════════════════════════
// LAYER 5: RANDOM DEEP INSPECTION (5 cases, full detail)
// ═══════════════════════════════════════
console.log('\n🔍 LAYER 5: RANDOM DEEP INSPECTION (5 cases)');
const deepSample = [];
// Pick from different sources
const sources = Object.keys(srcStats).sort((a,b) => srcStats[b].total - srcStats[a].total).slice(0, 5);
for (const src of sources) {
  const pool = db.filter(c => c.meta?.source === src);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick) deepSample.push(pick);
}

for (const c of deepSample) {
  const correctOpt = c.options?.find(o => o.is_correct);
  const rat = (c.rationale?.correct || '').slice(0, 120);
  console.log(`\n   ── ${c.case_code || c.hash_id} (${c.meta?.source}) ──`);
  console.log(`   Q: ${(c.vignette?.narrative || c.prompt || '').slice(0, 100)}...`);
  console.log(`   Options: ${c.options?.map(o => `${o.id}:${o.is_correct ? '✅' : '  '} "${o.text?.slice(0, 35)}"`).join(' | ')}`);
  console.log(`   Correct: ${correctOpt ? `${correctOpt.id}: ${correctOpt.text?.slice(0, 50)}` : '❌ NONE'}`);
  console.log(`   Rationale: "${rat}${rat.length >= 120 ? '...' : ''}"`);
  console.log(`   Category: ${c.category} | Confidence: ${c.confidence} | Antidote: ${c.meta?.antidote_applied || false}`);
  
  // Cross-validate MedMCQA against raw
  if (c.meta?.source === 'medmcqa') {
    const fp = (c.options || []).map(o => (o.text || '').trim().toLowerCase().slice(0, 30)).sort().join('|');
    const raw = rawByFP.get(fp);
    if (raw) {
      const trueLetter = TRUE_COP_MAP[parseInt(raw.cop, 10)];
      const match = trueLetter === correctOpt?.id;
      console.log(`   RAW CROSS-CHECK: cop=${raw.cop} → ${trueLetter} | DB=${correctOpt?.id} → ${match ? '✅ MATCH' : '🔴 MISMATCH!'}`);
      console.log(`   RAW exp: "${(raw.exp || '').slice(0, 80)}..."`);
    }
  }
}

// ═══════════════════════════════════════
// LAYER 6: ANTIDOTE AFTERMATH CHECK
// ═══════════════════════════════════════
console.log('\n\n💉 LAYER 6: ANTIDOTE AFTERMATH CHECK');
let L6 = { antidoted: 0, antidotedWithRat: 0, antidotedNoRat: 0, needsRegen: 0, regenDone: 0 };

for (const c of db) {
  if (c.meta?.antidote_applied) {
    L6.antidoted++;
    const rat = c.rationale?.correct || '';
    if (rat.length > 30) L6.antidotedWithRat++;
    else L6.antidotedNoRat++;
  }
  if (c.meta?.needs_rationale_regen) L6.needsRegen++;
  if (c.meta?.rationale_regenerated) L6.regenDone++;
}

console.log(`   Antidote applied:     ${L6.antidoted}`);
console.log(`   With rationale:       ${L6.antidotedWithRat} ✅`);
console.log(`   Without rationale:    ${L6.antidotedNoRat} ${L6.antidotedNoRat > 0 ? '⚠️ (Gatling Gun running)' : '✅'}`);
console.log(`   Needs regen flag:     ${L6.needsRegen}`);
console.log(`   Regen completed:      ${L6.regenDone}`);

// ═══════════════════════════════════════
// LAYER 7: EDGE CASE DETECTIVE
// ═══════════════════════════════════════
console.log('\n🕵️ LAYER 7: EDGE CASE DETECTIVE');
let L7 = { truncatedVignette: 0, veryShortQ: 0, duplicateOptions: 0, allSameOpts: 0, htmlInText: 0 };

for (const c of db) {
  const q = c.vignette?.narrative || c.prompt || '';
  if (q.length < 20 && c.q_type === 'MCQ') L7.veryShortQ++;
  if (q.includes('...') && q.endsWith('...')) L7.truncatedVignette++;
  if (/<[a-z]+>/i.test(q)) L7.htmlInText++;
  
  const texts = (c.options || []).map(o => (o.text || '').trim().toLowerCase());
  if (new Set(texts).size < texts.length) L7.duplicateOptions++;
  if (texts.length >= 2 && texts.every(t => t === texts[0])) L7.allSameOpts++;
}

console.log(`   Very short Q (<20):   ${L7.veryShortQ} ${L7.veryShortQ > 10 ? '⚠️' : '✅'}`);
console.log(`   Truncated vignette:   ${L7.truncatedVignette}`);
console.log(`   Duplicate options:    ${L7.duplicateOptions} ${L7.duplicateOptions > 0 ? '⚠️' : '✅'}`);
console.log(`   All same options:     ${L7.allSameOpts} ${L7.allSameOpts > 0 ? '🔴' : '✅'}`);
console.log(`   HTML in text:         ${L7.htmlInText} ${L7.htmlInText > 0 ? '⚠️' : '✅'}`);

// ═══════════════════════════════════════
// VERDICT
// ═══════════════════════════════════════
const criticals = L1.noCorrect + L1.noOptions + L2.mismatch + L1.duplicateIds;
const warnings = L1.multiCorrect + L1.emptyOptionText + L3.suspicious + L7.duplicateOptions + L7.htmlInText;

console.log('\n═══════════════════════════════════════════════');
console.log(` SMOKE TEST VERDICT`);
console.log(`   🔴 Critical issues:  ${criticals}`);
console.log(`   ⚠️ Warnings:        ${warnings}`);
console.log(`   Total cases:         ${db.length}`);
console.log(criticals === 0 ? '   ✅ DATABASE IS CLINICALLY SOUND' : '   🔴 CRITICAL ISSUES DETECTED — ACTION REQUIRED');
console.log('═══════════════════════════════════════════════');
