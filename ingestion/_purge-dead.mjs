import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// Purge dead weight quarantined (keep fixable 18)
const KEEP_REASONS = new Set(['no_correct_answer']);
let purged = 0;
const cleaned = db.filter(c => {
  if (c.meta && c.meta.quarantined) {
    if (KEEP_REASONS.has(c.meta.quarantine_reason) && c.question && c.question.length > 30) {
      return true;
    }
    purged++;
    return false;
  }
  return true;
});

const active = cleaned.filter(c => !(c.meta && c.meta.quarantined)).length;
const quar = cleaned.length - active;
console.log('Purged:', purged);
console.log('Final:', cleaned.length, '| Active:', active, '| Quarantined:', quar);

// Use writeFileSync directly (no rename)
writeFileSync(DB_PATH, JSON.stringify(cleaned, null, 2), 'utf8');
console.log('Saved.');
