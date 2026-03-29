import fs from 'fs';

const DB_PATH = 'public/data/compiled_cases.json';
const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';
const LOG_PATH = 'ingestion/output/antidote_audit.json';

// Patch 1: robust normalization
function normalizeComparable(str) {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]*>?/gm, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function detectCopBase(items) {
  const values = new Set(items.map((item) => Number.parseInt(item?.cop, 10)).filter(Number.isInteger));
  if (values.has(0) && values.has(4)) {
    throw new Error('Mixed MedMCQA `cop` bases detected in raw source.');
  }
  if (values.has(0)) return 0;
  if (values.has(4)) return 1;
  return 1; // Default fallback just in case
}

console.log('💉 ANTIDOTE v3 (CODEX PATCHED) — HASH-FIRST MOP-UP PROTOCOL\\n');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const copBase = detectCopBase(raw);
console.log(`🧭 MedMCQA \`cop\` base detected: ${copBase}-indexed`);

// 1. Build Data Structures
const rawByHash = new Map();
const rawByFP = new Map(); // array of items

raw.forEach(item => {
  if (item.id) rawByHash.set(`medmcqa_${item.id}`, item);
  
  if (!item.opa) return;
  const fp = [item.opa, item.opb, item.opc, item.opd]
    .map(o => (o || '').trim().toLowerCase().slice(0, 30))
    .sort().join('|');
    
  if (!rawByFP.has(fp)) rawByFP.set(fp, []);
  rawByFP.get(fp).push(item);
});

let stats = {
  totalMedMCQA: 0,
  alreadyCorrect: 0,
  matchedByHash: 0,
  matchedByUniqueFP: 0,
  quarantinedAmbiguousFP: 0,
  quarantinedSpatialAnomaly: 0,
  noRawFound: 0,
  noCopProvided: 0
};

for (const c of db) {
  if (c.meta?.source !== 'medmcqa') continue;
  stats.totalMedMCQA++;
  
  // Clean up old status if any
  if (c.meta?.status?.startsWith('QUARANTINED_AMBIGUOUS_RAW') || c.meta?.status?.startsWith('QUARANTINED_SPATIAL_ANOMALY')) {
    delete c.meta.status;
  }
  
  let targetRaw = null;
  let matchType = '';
  
  // Step A: Hash-first strategy
  if (c.hash_id && rawByHash.has(c.hash_id)) {
    targetRaw = rawByHash.get(c.hash_id);
    matchType = 'hash';
  } else {
    // Step B: Fingerprint fallback
    const fp = (c.options || []).map(o => (o.text || '').trim().toLowerCase().slice(0, 30)).sort().join('|');
    const candidates = rawByFP.get(fp);
    
    if (!candidates || candidates.length === 0) {
      stats.noRawFound++;
      continue;
    }
    
    // Check ambiguity
    let correctTexts = new Set();
    for (const cand of candidates) {
       let candCop = Number.parseInt(cand.cop, 10);
       if (!isNaN(candCop)) {
          const candText = [cand.opa, cand.opb, cand.opc, cand.opd][candCop - copBase];
          if (candText) {
             correctTexts.add(normalizeComparable(candText));
          }
       }
    }
    
    if (correctTexts.size > 1) {
       // Amber Alert: Fingerprint collision with conflicting answers
       c.meta = c.meta || {};
       c.meta.status = 'QUARANTINED_AMBIGUOUS_RAW';
       stats.quarantinedAmbiguousFP++;
       continue;
    }
    
    targetRaw = candidates[0];
    matchType = 'unique_fp';
  }
  
  // Step C & D: Extract and Spatial Check
  let copParsed = Number.parseInt(targetRaw.cop, 10);
  if (isNaN(copParsed)) {
     stats.noCopProvided++;
     continue;
  }
  
  const rawCorrectText = [targetRaw.opa, targetRaw.opb, targetRaw.opc, targetRaw.opd][copParsed - copBase];
  if (!rawCorrectText) {
     stats.noRawFound++;
     continue;
  }
  
  // Spatial Anomaly
  if (/(all|none) of the (above|options)|semua (di atas )?benar|salah semua/i.test(rawCorrectText)) {
    c.meta = c.meta || {};
    c.meta.status = 'QUARANTINED_SPATIAL_ANOMALY';
    stats.quarantinedSpatialAnomaly++;
    continue;
  }
  
  const anchoredOption = c.options?.find(
    (option) => normalizeComparable(option?.text) === normalizeComparable(rawCorrectText)
  );
  if (!anchoredOption) { 
    stats.noRawFound++; 
    continue; 
  }
  
  const dbCorrect = c.options?.find(o => o.is_correct);
  if (dbCorrect && normalizeComparable(dbCorrect.text) === normalizeComparable(rawCorrectText)) { 
    stats.alreadyCorrect++; 
    continue; 
  }
  
  // Step E: Save and fix
  c.options.forEach(o => { o.is_correct = normalizeComparable(o.text) === normalizeComparable(rawCorrectText); });
  c.meta = c.meta || {};
  c.meta.antidote_v3 = true;
  c.meta.antidote_applied = true;
  c.meta.answer_anchor_text = rawCorrectText;
  c.meta._recovered_from = matchType;
  
  const origExp = (targetRaw.exp || '').trim();
  if (origExp.length > 20) {
    c.rationale = { correct: origExp, distractors: {}, pearl: null };
  } else {
    c.meta.needs_rationale_regen = true;
  }
  
  if (matchType === 'hash') stats.matchedByHash++;
  else stats.matchedByUniqueFP++;
}

fs.mkdirSync('ingestion/output', {recursive: true});
fs.writeFileSync(LOG_PATH, JSON.stringify(stats, null, 2), 'utf8');
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf8');

console.log(`✅ ANTIDOTE v3 (CODEX PATCHED) COMPLETE`);
console.log(`   Audited:               ${stats.totalMedMCQA} MedMCQA Cases`);
console.log(`   Already correct:       ${stats.alreadyCorrect}`);
console.log(`   Fixed by Hash:         ${stats.matchedByHash}`);
console.log(`   Fixed by Unique FP:    ${stats.matchedByUniqueFP}`);
console.log(`   ---------------------------------------`);
console.log(`   🚨 Quarantined (Ambiguous FP):     ${stats.quarantinedAmbiguousFP}`);
console.log(`   🚨 Quarantined (Spatial Anomaly):  ${stats.quarantinedSpatialAnomaly}`);
console.log(`   No Raw/No Cop:                     ${stats.noRawFound + stats.noCopProvided}`);
console.log(`   Audit log saved to: ${LOG_PATH}`);
