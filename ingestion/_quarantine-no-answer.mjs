/**
 * Smart quarantine: remove only empty-question no-correct-answer cases
 * Keep 124 cases that have question text for API batch fix
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

let quarantined = 0, kept = 0;
const kept_ids = [];

const clean = db.filter(c => {
  if (!Array.isArray(c.options) || c.options.length < 2) return true;
  if (c.options.some(o => o.is_correct)) return true; // has correct answer, keep
  
  // No correct answer — check if has question text
  const hasQ = (c.question || '').trim().length > 10;
  if (hasQ) {
    kept++;
    kept_ids.push(c._id);
    return true; // keep for API fix
  }
  
  quarantined++;
  return false; // empty question + no answer = garbage
});

writeFileSync(DB_PATH, JSON.stringify(clean, null, 2), 'utf8');
console.log(`Quarantined (empty + no answer): ${quarantined}`);
console.log(`Kept for API fix (has text, no answer): ${kept}`);
console.log(`Clean DB: ${clean.length}`);

// Export the 124 for batch API
const batchCases = clean.filter(c => kept_ids.includes(c._id));
const batchPath = join(__dirname, 'output', 'fix_124_no_answer.json');
writeFileSync(batchPath, JSON.stringify(batchCases, null, 2), 'utf8');
console.log(`\nExported ${batchCases.length} cases to fix_124_no_answer.json for API batch`);
