/**
 * Morning Session:
 *   1. Clean MedMCQA dirty explanations ($0) 
 *   2. Download + apply contradiction results
 *   3. Check FASE 2 batch status
 * 
 * Usage: node ingestion/morning-cleanup.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const API_KEY = readFileSync(envPath, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

console.log('══════════════════════════════════════════════════');
console.log(' MORNING CLEANUP SESSION');
console.log('══════════════════════════════════════════════════\n');

let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
console.log(`📂 Loaded ${cases.length.toLocaleString()} cases\n`);

// ═══════════════════════════════════════════════════
// TASK 1: CLEAN MEDMCQA EXPLANATIONS ($0)
// ═══════════════════════════════════════════════════
console.log('━━━ TASK 1: Clean MedMCQA Explanations ($0) ━━━\n');

let cleaned = {
  ans_prefix: 0,
  ref_stripped: 0,
  hash_converted: 0,
  image_ref: 0,
  extra_mile: 0,
  page_ref: 0,
  total_touched: 0,
};

function cleanExplanation(text) {
  if (!text || text.length === 0) return { text, changed: false };
  let t = text;
  let changed = false;

  // 1. Strip "Ans. A/B/C/D [optionText]" prefix
  // Pattern: "Ans. C Cardinal veinRef; hangman's..." → keep after "Ref;" content
  const ansMatch = t.match(/^Ans\.\s*[A-Ea-e]\.?\s*[^.]*?((?:Ref[;:]|#|\n|$))/);
  if (ansMatch) {
    // Remove just the "Ans. X [text]" prefix, keep the ref/content
    t = t.replace(/^Ans\.\s*[A-Ea-e]\.?\s*[^#;:\n]*?(?=Ref[;:]|#|\n|[A-Z][a-z]{3,})/i, '');
    if (t !== text) { cleaned.ans_prefix++; changed = true; }
  }

  // 2. Strip "Ref; textbook pg. ##" references
  // "Ref; hangman's essesntial medical Embroyology pg. 57" → remove
  const before2 = t;
  t = t.replace(/Ref[;:]\s*[^#\n]*?(?=\s*#|\s*\n|\s*$)/gi, '');
  if (t !== before2) { cleaned.ref_stripped++; changed = true; }

  // 3. Convert # separators to newlines
  const before3 = t;
  t = t.replace(/\s*#\s*/g, '\n\n');
  if (t !== before3) { cleaned.hash_converted++; changed = true; }

  // 4. Strip "(Image)" phantom refs
  const before4 = t;
  t = t.replace(/\s*\(Image\)\s*/gi, ' ');
  if (t !== before4) { cleaned.image_ref++; changed = true; }

  // 5. Clean "Extra mile" / "Extra Mileage" sections — keep content but add header
  const before5 = t;
  t = t.replace(/Extra\s*mile(age)?/gi, '\n\n📚 Extra:');
  if (t !== before5) { cleaned.extra_mile++; changed = true; }

  // 6. Strip raw "pg. ##" page references
  const before6 = t;
  t = t.replace(/\s*pg\.\s*\d+\s*/gi, ' ');
  if (t !== before6) { cleaned.page_ref++; changed = true; }

  // General cleanup
  t = t.replace(/^\s+/, '');          // trim leading whitespace
  t = t.replace(/\n{3,}/g, '\n\n');   // collapse multiple newlines
  t = t.replace(/\s{2,}/g, ' ');      // collapse multiple spaces (but keep newlines)
  t = t.trim();

  return { text: t, changed };
}

for (const c of cases) {
  if (!c.rationale?.correct) continue;
  
  const result = cleanExplanation(c.rationale.correct);
  if (result.changed) {
    c.rationale.correct = result.text;
    cleaned.total_touched++;
  }
}

console.log(`  ✅ Explanations cleaned:`);
console.log(`     "Ans." prefix stripped:  ${cleaned.ans_prefix}`);
console.log(`     "Ref;" refs stripped:    ${cleaned.ref_stripped}`);
console.log(`     # → newlines:           ${cleaned.hash_converted}`);
console.log(`     "(Image)" removed:      ${cleaned.image_ref}`);
console.log(`     "Extra mile" cleaned:   ${cleaned.extra_mile}`);
console.log(`     "pg. ##" stripped:       ${cleaned.page_ref}`);
console.log(`     Total cases touched:    ${cleaned.total_touched}\n`);

// ═══════════════════════════════════════════════════
// TASK 2: DOWNLOAD CONTRADICTION RESULTS
// ═══════════════════════════════════════════════════
console.log('━━━ TASK 2: Download Contradiction Results ━━━\n');

const contraBatch = await (await fetch(`${BASE}/batches/batch_69b6bc9d470c819080883c26cb6b97e5`, { headers })).json();
console.log(`  Batch status: ${contraBatch.status}`);

let contraStats = { support: 0, contradict: 0, error: 0, nuked: 0 };

if (contraBatch.output_file_id) {
  const contraResults = await (await fetch(`${BASE}/files/${contraBatch.output_file_id}/content`, { headers })).text();
  writeFileSync(join(OUTPUT_DIR, 'contradiction_results.jsonl'), contraResults, 'utf-8');
  const contraLines = contraResults.split('\n').filter(l => l.trim());
  console.log(`  📥 Downloaded ${contraLines.length} results\n`);

  // Build map for quick lookup
  const caseMap = new Map();
  for (const c of cases) caseMap.set(c._id, c);

  for (const line of contraLines) {
    try {
      const r = JSON.parse(line);
      const id = parseInt(r.custom_id.replace('contra_', ''), 10);
      const c = caseMap.get(id);
      if (!c) continue;

      const content = r.response?.body?.choices?.[0]?.message?.content;
      if (!content) { contraStats.error++; continue; }
      
      const verdict = JSON.parse(content);
      if (verdict.verdict === 'SUPPORT') {
        contraStats.support++;
      } else if (verdict.verdict === 'CONTRADICT') {
        contraStats.contradict++;
        // NUKE the contradicting explanation
        c.rationale = c.rationale || {};
        c.rationale._original_correct = c.rationale.correct; // backup
        c.rationale.correct = ''; // nuke it
        c.meta = c.meta || {};
        c.meta.explanation_nuked = true;
        c.meta.nuke_reason = verdict.reason || 'Contradiction detected';
        contraStats.nuked++;
      }
    } catch { contraStats.error++; }
  }

  console.log(`  ✅ SUPPORT (explanation OK):     ${contraStats.support}`);
  console.log(`  ❌ CONTRADICT (explanation nuked): ${contraStats.contradict}`);
  console.log(`  ⚠️ Parse errors:                 ${contraStats.error}`);
  console.log(`  💀 Explanations nuked:            ${contraStats.nuked}\n`);
} else {
  console.log(`  ⏳ Batch not ready yet (${contraBatch.status})\n`);
}

// ═══════════════════════════════════════════════════
// TASK 3: CHECK FASE 2 BATCH STATUS
// ═══════════════════════════════════════════════════
console.log('━━━ TASK 3: FASE 2 Batch Status ━━━\n');

const fase2Info = JSON.parse(readFileSync(join(OUTPUT_DIR, 'fase2_batch_info.json'), 'utf-8'));
const fase2Batch = await (await fetch(`${BASE}/batches/${fase2Info.batch_id}`, { headers })).json();
console.log(`  Batch: ${fase2Info.batch_id}`);
console.log(`  Status: ${fase2Batch.status}`);
console.log(`  Progress: ${fase2Batch.request_counts?.completed || 0}/${fase2Batch.request_counts?.total || '?'}`);
if (fase2Batch.output_file_id) {
  console.log(`  Output file: ${fase2Batch.output_file_id}`);
}
console.log();

// ═══════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════
writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
copyFileSync(COMPILED, PUBLIC_COMPILED);

console.log('══════════════════════════════════════════════════');
console.log(' MORNING CLEANUP COMPLETE');
console.log('══════════════════════════════════════════════════');
console.log(`  Explanations cleaned: ${cleaned.total_touched.toLocaleString()}`);
console.log(`  Contradictions nuked: ${contraStats.nuked}`);
console.log(`  FASE 2 status:        ${fase2Batch.status} (${fase2Batch.request_counts?.completed || 0}/${fase2Batch.request_counts?.total || '?'})`);
console.log(`  Saved to:             compiled_cases.json + public/data/`);
console.log('══════════════════════════════════════════════════\n');
