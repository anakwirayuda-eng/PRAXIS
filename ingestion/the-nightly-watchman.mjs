/**
 * PRAXIS — The Nightly Watchman v1.0
 * Proactive Psychometric & Clinical Screening
 * Paradigms: Length Bias, Shuffle Poison, Negation Blindspot, Clinical Decay
 * Usage: node ingestion/the-nightly-watchman.mjs
 */
import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

console.log('═══════════════════════════════════════════════');
console.log(' 🌙 THE NIGHTLY WATCHMAN v1.0');
console.log(' Proactive Psychometric & Clinical Screening');
console.log(` 📊 Scanning ${db.length} cases...`);
console.log('═══════════════════════════════════════════════\n');

const flags = { lengthBias: [], absoluteTrap: [], shufflePoison: [], negationBlind: [], clinicalDecay: [], metricCollision: [] };

for (const c of db) {
  if (c.q_type !== 'MCQ' || !Array.isArray(c.options) || c.options.length < 2) continue;
  
  const correctOpt = c.options.find(o => o.is_correct);
  if (!correctOpt) continue;
  const wrongOpts = c.options.filter(o => !o.is_correct);
  const q = (c.vignette?.narrative || c.prompt || '').toLowerCase();
  const rat = (c.rationale?.correct || '').toLowerCase();

  // ═══════════════════════════════════════
  // PARADIGM 1: LENGTH BIAS (Correct option suspiciously longer)
  // ═══════════════════════════════════════
  const correctLen = (correctOpt.text || '').length;
  const avgWrongLen = wrongOpts.reduce((s, o) => s + (o.text || '').length, 0) / (wrongOpts.length || 1);
  if (avgWrongLen > 5 && correctLen / avgWrongLen > 1.8) {
    flags.lengthBias.push({ id: c._id, code: c.case_code, ratio: (correctLen / avgWrongLen).toFixed(2), correct: correctOpt.text?.slice(0, 50) });
  }

  // PARADIGM 1b: ABSOLUTE TRAP (Wrong options with absolute words)
  for (const wo of wrongOpts) {
    if (/\b(selalu|tidak pernah|semua|always|never|must|pasti|absolut|100%)\b/i.test(wo.text || '')) {
      flags.absoluteTrap.push({ id: c._id, code: c.case_code, opt: wo.id, text: wo.text?.slice(0, 50) });
      break;
    }
  }

  // ═══════════════════════════════════════
  // PARADIGM 2: SHUFFLE POISON ("All of the above", "A and B", etc.)
  // ═══════════════════════════════════════
  for (const o of c.options) {
    if (/\b(semua benar|di atas|di bawah|all of the above|none of the above|opsi [a-e]|option [a-e]|both [a-e]|a dan b|a and b|b and c|c and d)\b/i.test(o.text || '')) {
      flags.shufflePoison.push({ id: c._id, code: c.case_code, opt: o.id, text: o.text?.slice(0, 50), doNotShuffle: c.meta?.do_not_shuffle || false });
      break;
    }
  }

  // ═══════════════════════════════════════
  // PARADIGM 3: NEGATION BLINDSPOT (EXCEPT/KECUALI + affirming rationale)
  // ═══════════════════════════════════════
  const hasNegation = /\b(kecuali|except|not true|least likely|bukan|tidak benar|incorrect|false statement|contraindicated)\b/i.test(q);
  if (hasNegation && rat.length > 50) {
    // Check if rationale AFFIRMS the correct answer (should NEGATE it for EXCEPT questions)
    const affirmPhrases = /(adalah pilihan utama|is the (correct|recommended|best)|paling tepat|is true because|merupakan (jawaban|pilihan) yang (benar|tepat))/i;
    if (affirmPhrases.test(rat)) {
      flags.negationBlind.push({ id: c._id, code: c.case_code, q: q.slice(0, 60), ratSnippet: rat.slice(0, 80) });
    }
  }

  // ═══════════════════════════════════════
  // PARADIGM 4: CLINICAL DECAY (Outdated guidelines, withdrawn drugs)
  // ═══════════════════════════════════════
  const fullText = q + ' ' + (correctOpt.text || '') + ' ' + wrongOpts.map(o => o.text || '').join(' ') + ' ' + rat;
  
  // Withdrawn/outdated drugs
  if (/\b(ranitidine|ranitidin|cisapride|sibutramine|rofecoxib|troglitazone|dextropropoxyphene|tegaserod|phenylpropanolamine)\b/i.test(fullText)) {
    flags.clinicalDecay.push({ id: c._id, code: c.case_code, reason: 'withdrawn_drug', match: fullText.match(/\b(ranitidine|ranitidin|cisapride|sibutramine|rofecoxib|troglitazone|dextropropoxyphene|tegaserod|phenylpropanolamine)\b/i)?.[0] });
  }
  // Outdated guidelines
  if (/\b(JNC\s*7|JNC\s*VI|ATP\s*III|AHA\s*201[0-5]|WHO\s*201[0-5]|ACOG\s*201[0-5])\b/i.test(fullText)) {
    flags.clinicalDecay.push({ id: c._id, code: c.case_code, reason: 'outdated_guideline', match: fullText.match(/\b(JNC\s*7|JNC\s*VI|ATP\s*III|AHA\s*201[0-5]|WHO\s*201[0-5]|ACOG\s*201[0-5])\b/i)?.[0] });
  }

  // ═══════════════════════════════════════
  // PARADIGM 4b: METRIC COLLISION (mmol/L vs mg/dL ambiguity)
  // ═══════════════════════════════════════
  if (/\b(gluc|sugar|gula|glukosa|blood sugar)\b/i.test(q)) {
    const numMatch = q.match(/\b(\d+\.?\d*)\s*(mg\/dl|mmol\/l|mg%)?/i);
    if (numMatch) {
      const val = parseFloat(numMatch[1]);
      // If glucose value < 30 and no unit specified, it's likely mmol/L (could confuse Indonesian students)
      if (val < 30 && !numMatch[2]) {
        flags.metricCollision.push({ id: c._id, code: c.case_code, value: val, context: q.slice(Math.max(0, numMatch.index - 20), numMatch.index + 30) });
      }
    }
  }
}

// ═══════════════════════════════════════
// REPORT
// ═══════════════════════════════════════
console.log('🎯 PARADIGM 1: LENGTH BIAS (Correct option >1.8x longer)');
console.log(`   Found: ${flags.lengthBias.length}`);
if (flags.lengthBias.length > 0) {
  flags.lengthBias.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code} (ratio ${f.ratio}x): "${f.correct}"`));
}

console.log(`\n🎯 PARADIGM 1b: ABSOLUTE TRAP (Wrong options with absolutes)`);
console.log(`   Found: ${flags.absoluteTrap.length}`);
if (flags.absoluteTrap.length > 0) {
  flags.absoluteTrap.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code} opt ${f.opt}: "${f.text}"`));
}

console.log(`\n🔀 PARADIGM 2: SHUFFLE POISON ("All of the above" etc.)`);
console.log(`   Found: ${flags.shufflePoison.length}`);
const alreadyFlagged = flags.shufflePoison.filter(f => f.doNotShuffle).length;
console.log(`   Already flagged do_not_shuffle: ${alreadyFlagged}`);
if (flags.shufflePoison.length > 0) {
  flags.shufflePoison.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code} opt ${f.opt}: "${f.text}"`));
}

console.log(`\n☠️ PARADIGM 3: NEGATION BLINDSPOT (EXCEPT/KECUALI + affirming rationale)`);
console.log(`   Found: ${flags.negationBlind.length}`);
if (flags.negationBlind.length > 0) {
  flags.negationBlind.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code}: Q="${f.q}" | Rat="${f.ratSnippet}..."`));
}

console.log(`\n⏳ PARADIGM 4: CLINICAL DECAY (Withdrawn drugs / outdated guidelines)`);
console.log(`   Found: ${flags.clinicalDecay.length}`);
const byReason = {};
flags.clinicalDecay.forEach(f => { byReason[f.reason] = (byReason[f.reason] || 0) + 1; });
Object.entries(byReason).forEach(([r, n]) => console.log(`     ${r}: ${n}`));
if (flags.clinicalDecay.length > 0) {
  flags.clinicalDecay.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code}: ${f.reason} — "${f.match}"`));
}

console.log(`\n📐 PARADIGM 4b: METRIC COLLISION (Ambiguous lab units)`);
console.log(`   Found: ${flags.metricCollision.length}`);
if (flags.metricCollision.length > 0) {
  flags.metricCollision.slice(0, 3).forEach(f => console.log(`   ⚠️ ${f.code}: glucose=${f.value} no unit | "...${f.context}..."`));
}

// ═══════════════════════════════════════
// AUTO-FIX: Inject do_not_shuffle for shuffle poisons
// ═══════════════════════════════════════
let shuffleFixed = 0;
const shuffleIds = new Set(flags.shufflePoison.map(f => f.id));
for (const c of db) {
  if (shuffleIds.has(c._id) && !c.meta?.do_not_shuffle) {
    c.meta = c.meta || {};
    c.meta.do_not_shuffle = true;
    shuffleFixed++;
  }
}

if (shuffleFixed > 0) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf-8');
  console.log(`\n🛡️ AUTO-FIX: Injected do_not_shuffle=true on ${shuffleFixed} cases.`);
}

// Save report
const report = {
  timestamp: new Date().toISOString(),
  totalCases: db.length,
  findings: {
    lengthBias: flags.lengthBias.length,
    absoluteTrap: flags.absoluteTrap.length,
    shufflePoison: flags.shufflePoison.length,
    negationBlindspot: flags.negationBlind.length,
    clinicalDecay: flags.clinicalDecay.length,
    metricCollision: flags.metricCollision.length,
  },
  autoFixed: { shufflePoison: shuffleFixed },
  details: {
    negationBlindspot: flags.negationBlind,
    clinicalDecay: flags.clinicalDecay,
    metricCollision: flags.metricCollision,
  },
};
fs.writeFileSync('ingestion/output/watchman_report.json', JSON.stringify(report, null, 2), 'utf-8');

console.log('\n═══════════════════════════════════════════════');
console.log(' 🌙 NIGHTLY WATCHMAN COMPLETE');
console.log(`   Length Bias:        ${flags.lengthBias.length}`);
console.log(`   Absolute Trap:      ${flags.absoluteTrap.length}`);
console.log(`   Shuffle Poison:     ${flags.shufflePoison.length} (${shuffleFixed} auto-fixed)`);
console.log(`   Negation Blindspot: ${flags.negationBlind.length}`);
console.log(`   Clinical Decay:     ${flags.clinicalDecay.length}`);
console.log(`   Metric Collision:   ${flags.metricCollision.length}`);
console.log('═══════════════════════════════════════════════');
