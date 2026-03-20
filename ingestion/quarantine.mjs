/**
 * Quarantine Script — flag cases with corrupted/truncated text
 * Sets meta.quarantined = true so CaseBrowser can filter them out
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// Corruption heuristics
function isCorrupt(text) {
  if (!text || text.length < 20) return 'too_short';
  
  // Random capitalization mid-word: "cNvitts", "maie"
  const weirdCaps = (text.match(/[a-z][A-Z][a-z]/g) || []).length;
  if (weirdCaps >= 3) return 'garbled_caps';
  
  // High ratio of non-ascii / control chars
  const nonAscii = (text.match(/[^\x20-\x7E\n\r\t.,;:!?'"()\-\/\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/g) || []).length;
  if (nonAscii / text.length > 0.15 && text.length > 30) return 'encoding_garbage';
  
  // Truncated mid-sentence (ends without punctuation and < 50 chars)
  if (text.length < 50 && !text.match(/[.?!)\]"]$/)) return 'truncated';
  
  // Repetitive gibberish (same char 5+ times)
  if (/(.)\1{5,}/.test(text)) return 'repetitive';
  
  // Missing spaces (very long "words")
  const words = text.split(/\s+/);
  const longWords = words.filter(w => w.length > 45);
  if (longWords.length >= 2) return 'no_spaces';
  
  // No answer marked correct
  return null;
}

function hasNoCorrectAnswer(c) {
  const opts = c.options || [];
  if (opts.length < 2) return true;
  return !opts.some(o => o.is_correct === true);
}

console.log('🔒 Quarantine Engine');
console.log('━'.repeat(60));

let quarantined = 0;
const reasons = {};

for (const c of db) {
  const text = c.question || c.vignette?.narrative || c.title || '';
  const reason = isCorrupt(text) || (hasNoCorrectAnswer(c) ? 'no_correct_answer' : null);
  
  if (reason) {
    c.meta = c.meta || {};
    c.meta.quarantined = true;
    c.meta.quarantine_reason = reason;
    quarantined++;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
}

console.log(`\n📊 Quarantined: ${quarantined.toLocaleString()} cases`);
console.log('\nBreakdown:');
for (const [r, n] of Object.entries(reasons).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${r.padEnd(25)} ${n.toLocaleString()}`);
}
console.log(`\n📊 Clean cases: ${(db.length - quarantined).toLocaleString()} / ${db.length.toLocaleString()}`);

const tmp = DB_PATH + '.tmp';
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('💾 Saved.');
