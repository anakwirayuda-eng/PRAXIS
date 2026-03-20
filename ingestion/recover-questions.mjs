/**
 * Recover 11,454 empty-question cases from MedMCQA source
 * Match by option text (opa/opb/opc/opd) since question field was lost during parsing
 * Cost: $0
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const SRC_PATH = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const src = JSON.parse(readFileSync(SRC_PATH, 'utf8'));

// Build lookup from source: key = sorted options text → question
console.log('🔍 Building source lookup...');
const lookup = new Map();
for (const s of src) {
  const key = [s.opa, s.opb, s.opc, s.opd].map(o => (o || '').trim().toLowerCase().slice(0, 30)).sort().join('|');
  if (key && s.question) {
    lookup.set(key, { question: s.question, exp: s.exp || '', subject: s.subject_name, topic: s.topic_name });
  }
}
console.log(`   Source lookup: ${lookup.size.toLocaleString()} entries`);

// Find empty-question quarantined cases and try to recover
const empty = db.filter(c => c.meta?.quarantined && (!c.question || c.question.length < 5));
console.log(`   Empty-question cases: ${empty.length.toLocaleString()}`);

let recovered = 0;
let notFound = 0;

for (const c of empty) {
  const opts = (c.options || []).map(o => (o.text || '').trim().toLowerCase().slice(0, 30)).sort().join('|');
  const match = lookup.get(opts);
  
  if (match) {
    c.question = match.question;
    c.title = match.question.length <= 80 ? match.question : match.question.slice(0, 77) + '...';
    if (match.exp) {
      c.rationale = c.rationale || {};
      c.rationale.correct = c.rationale.correct || match.exp;
    }
    // Un-quarantine!
    c.meta.quarantined = false;
    c.meta.quarantine_reason = null;
    c.meta._recovered_from = 'medmcqa_source';
    recovered++;
  } else {
    notFound++;
  }
}

console.log(`\n✅ Recovered: ${recovered.toLocaleString()}`);
console.log(`❌ Not found in source: ${notFound.toLocaleString()}`);

// Final stats
const active = db.filter(c => !c.meta?.quarantined).length;
const quarantined = db.filter(c => c.meta?.quarantined).length;
console.log(`\n📊 Final DB: ${db.length.toLocaleString()} total`);
console.log(`   Active: ${active.toLocaleString()}`);
console.log(`   Still quarantined: ${quarantined.toLocaleString()}`);

const tmp = DB_PATH + '.tmp';
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('💾 Saved.');
