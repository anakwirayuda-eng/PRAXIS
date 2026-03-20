/**
 * Final cleanup v2 — TIGHT criteria
 * 1. Purge dead weight quarantined
 * 2. Scan active for TRULY empty cases only (no question AND no meaningful text)
 * 3. Prepare 18 fixable for batch
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const BATCH_PATH = join(__dirname, 'output', 'fix_no_answer.jsonl');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// ── Step 1: Prepare 18 fixable ──
const fixable = db.filter(c => 
  c.meta?.quarantined && 
  c.meta?.quarantine_reason === 'no_correct_answer' &&
  c.question && c.question.length > 30
);
const batchLines = fixable.map(c => {
  const opts = (c.options || []).map(o => `${o.id}. ${o.text}`).join('\n');
  return JSON.stringify({
    custom_id: `fix-${c._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Given this medical MCQ, identify which option (A/B/C/D/E) is the CORRECT answer. Respond with ONLY the letter and a brief rationale.\n\nQuestion: ${c.question}\n\nOptions:\n${opts}`
      }]
    }
  });
});
writeFileSync(BATCH_PATH, batchLines.join('\n'), 'utf8');
console.log(`📤 Batch: ${fixable.length} fixable cases`);

// ── Step 2: Purge dead weight ──
let purged = 0;
const cleaned = db.filter(c => {
  if (c.meta?.quarantined) {
    if (c.meta.quarantine_reason === 'no_correct_answer' && c.question && c.question.length > 30) {
      return true; // keep fixable
    }
    purged++;
    return false;
  }
  return true;
});
console.log(`🗑️  Purged: ${purged.toLocaleString()} dead weight`);

// ── Step 3: Scan active for TRULY empty ──
// Only quarantine if question is literally empty/null AND no usable text anywhere
let newQ = 0;
for (const c of cleaned) {
  if (c.meta?.quarantined) continue;
  
  const q = (c.question || '').trim();
  const narr = (c.vignette?.narrative || '').trim();

  // Only flag if BOTH question AND narrative are empty/very short
  if (q.length === 0 && narr.length === 0) {
    c.meta = c.meta || {};
    c.meta.quarantined = true;
    c.meta.quarantine_reason = 'empty_content';
    newQ++;
  }
}
console.log(`🔒 Newly quarantined (truly empty): ${newQ.toLocaleString()}`);

const active = cleaned.filter(c => !c.meta?.quarantined).length;
const quar = cleaned.filter(c => c.meta?.quarantined).length;
console.log(`\n📊 Final: ${cleaned.length.toLocaleString()} total`);
console.log(`   Active: ${active.toLocaleString()}`);
console.log(`   Quarantined: ${quar.toLocaleString()}`);

const tmp = DB_PATH + '.tmp';
writeFileSync(tmp, JSON.stringify(cleaned, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('💾 Saved.');
