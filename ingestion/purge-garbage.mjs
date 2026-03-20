/**
 * Purge garbage, keep salvageable quarantined cases
 * - PURGE: garbled_caps, too_short, repetitive, encoding_garbage, no_spaces
 * - KEEP (quarantined): truncated (empty question but has answers — might be recoverable)
 * - KEEP (quarantined): no_correct_answer (fixable by batch)
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

const PURGE_REASONS = new Set(['garbled_caps', 'too_short', 'repetitive', 'encoding_garbage', 'no_spaces']);

let purged = 0;
let kept = 0;
const purgeReasons = {};

const cleaned = db.filter(c => {
  const reason = c.meta?.quarantine_reason;
  if (reason && PURGE_REASONS.has(reason)) {
    purgeReasons[reason] = (purgeReasons[reason] || 0) + 1;
    purged++;
    return false; // remove
  }
  kept++;
  return true; // keep
});

console.log(`🗑️  PURGED: ${purged.toLocaleString()} garbage cases`);
for (const [r, n] of Object.entries(purgeReasons).sort((a,b) => b[1]-a[1])) {
  console.log(`   ${r}: ${n.toLocaleString()}`);
}
console.log(`\n📦 KEPT: ${kept.toLocaleString()} cases`);

const stillQuarantined = cleaned.filter(c => c.meta?.quarantined).length;
const active = cleaned.filter(c => !c.meta?.quarantined).length;
console.log(`   Active (clean): ${active.toLocaleString()}`);
console.log(`   Quarantined (recoverable): ${stillQuarantined.toLocaleString()}`);

const tmp = DB_PATH + '.tmp';
writeFileSync(tmp, JSON.stringify(cleaned, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('\n💾 Saved.');
