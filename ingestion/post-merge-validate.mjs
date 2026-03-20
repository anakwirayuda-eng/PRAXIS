/**
 * 🛡️ POST-MERGE VALIDATOR — Run after every data change
 * All-in-one: dedup, examType, _id, category, options integrity
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// ═══ SKDI CATEGORIES ═══
const VALID_CATEGORIES = new Set([
  'Ilmu Penyakit Dalam', 'Bedah', 'Obstetri & Ginekologi', 'Ilmu Kesehatan Anak',
  'Psikiatri', 'Ilmu Kesehatan Masyarakat', 'Radiologi', 'Neurologi', 'Mata',
  'Farmakologi', 'THT', 'Kedokteran Gigi', 'Anestesi & Emergency Medicine',
  'Kulit & Kelamin', 'Forensik', 'Anatomi', 'Biokimia', 'Patologi Anatomi',
  'Mikrobiologi', 'Rehabilitasi Medik',
]);

// ═══ SOURCE → EXAM TYPE MAPPING ═══
const SOURCE_TO_EXAM = {
  'medmcqa': 'UKMPPD',    // Indian NEET-PG, closest to UKMPPD
  'medqa': 'USMLE',
  'headqa': 'MIR-Spain',
  'pedmedqa': 'Academic',
  'polish-ldek-en': 'Academic',
  'fk-leaked-ukmppd': 'UKMPPD',
  'tw-medqa': 'Academic',
  'greek-mcqa': 'Academic',
  'frenchmedmcqa': 'Academic',
  'pubmedqa': 'Research',
  'ukmppd-pdf': 'UKMPPD',
  'ukmppd-scribd': 'UKMPPD',
  'ukmppd-pdf-scribd': 'UKMPPD',
  'ukmppd-rekapan-2021-ocr': 'UKMPPD',
  'ukmppd-web': 'UKMPPD',
  'ukmppd-ukdicorner': 'UKMPPD',
  'ukmppd-optima': 'UKMPPD',
  'sct-factory-v1': 'UKMPPD',
  'sct-alchemist-v3': 'UKMPPD',
  'igakuqa': 'IgakuQA',
  'fdi-tryout': 'UKMPPD',
  'aipki-ugm': 'UKMPPD',
  'aipki-tryout': 'UKMPPD',
  'worldmedqa': 'Academic',
  'medexpqa': 'Academic',
  'nano1337-mcqs': 'Academic',
  'litfl': 'Clinical',
  'asian-medqa': 'Academic',
  'sinauyuk-tryout': 'UKMPPD',
  'ingenio-tryout': 'UKMPPD',
  'ukdi-tryout': 'UKMPPD',
  'medsense-tryout': 'UKMPPD',
  'unknown': 'Academic',
};
// MMLU subsets all → Academic
for (const k of ['mmlu-professional_psychology', 'mmlu-high_school_biology', 'mmlu-nutrition',
  'mmlu-professional_medicine', 'mmlu-clinical_knowledge', 'mmlu-human_aging', 'mmlu-virology',
  'mmlu-college_biology', 'mmlu-anatomy', 'mmlu-college_medicine', 'mmlu-medical_genetics']) {
  SOURCE_TO_EXAM[k] = 'Academic';
}

console.log('🛡️ ═══ POST-MERGE VALIDATOR ═══\n');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const stats = { deduped: 0, examTyped: 0, idFixed: 0, catFixed: 0, optFixed: 0, noCorrect: 0 };

// ─── 1. DEDUP by question text (keep first occurrence) ───
console.log('1️⃣  Dedup check...');
const seen = new Map();
const deduped = [];
for (const c of db) {
  const key = (c.question || '').trim().toLowerCase().slice(0, 100);
  if (key.length < 20) { deduped.push(c); continue; } // too short to dedup
  if (seen.has(key)) {
    stats.deduped++;
    continue; // skip duplicate
  }
  seen.set(key, true);
  deduped.push(c);
}
console.log(`   Duplicates removed: ${stats.deduped}`);

// ─── 2. FIX _IDs (null, undefined, or duplicate) ───
console.log('2️⃣  ID validation...');
const usedIds = new Set();
let maxId = 0;
for (const c of deduped) {
  if (c._id != null && Number.isFinite(Number(c._id))) {
    maxId = Math.max(maxId, Number(c._id));
    usedIds.add(Number(c._id));
  }
}
for (const c of deduped) {
  if (c._id == null || !Number.isFinite(Number(c._id)) || (usedIds.has(Number(c._id)) && c !== deduped.find(x => Number(x._id) === Number(c._id)))) {
    maxId++;
    c._id = maxId;
    stats.idFixed++;
  }
}
console.log(`   IDs fixed: ${stats.idFixed}`);

// ─── 3. ASSIGN examType from source ───
console.log('3️⃣  ExamType assignment...');
for (const c of deduped) {
  if (!c.meta?.examType) {
    const src = c.meta?.source || 'unknown';
    const examType = SOURCE_TO_EXAM[src] || 'Academic';
    c.meta = c.meta || {};
    c.meta.examType = examType;
    stats.examTyped++;
  }
}
console.log(`   ExamTypes assigned: ${stats.examTyped.toLocaleString()}`);

// Count by examType
const examCounts = {};
deduped.forEach(c => { examCounts[c.meta?.examType || '?'] = (examCounts[c.meta?.examType || '?'] || 0) + 1; });
Object.entries(examCounts).sort((a,b) => b[1]-a[1]).forEach(([e,n]) => console.log(`     ${n.toString().padStart(6)}  ${e}`));

// ─── 4. CATEGORY validation ───
console.log('4️⃣  Category validation...');
for (const c of deduped) {
  if (!VALID_CATEGORIES.has(c.category)) {
    c.meta = c.meta || {};
    c.meta._invalid_category = c.category;
    c.category = 'Ilmu Penyakit Dalam'; // fallback
    stats.catFixed++;
  }
}
console.log(`   Invalid categories fixed: ${stats.catFixed}`);

// ─── 5. OPTIONS integrity ───
console.log('5️⃣  Options integrity...');
for (const c of deduped) {
  if (!Array.isArray(c.options) || c.options.length < 2) {
    stats.optFixed++;
    continue;
  }
  // Ensure at least one correct answer
  const hasCorrect = c.options.some(o => o.is_correct);
  if (!hasCorrect) {
    stats.noCorrect++;
  }
  // Ensure all options have id + text
  c.options.forEach((o, i) => {
    if (!o.id) o.id = String.fromCharCode(65 + i);
    if (!o.text) o.text = 'Option unavailable.';
  });
}
console.log(`   Missing options: ${stats.optFixed}`);
console.log(`   No correct answer: ${stats.noCorrect}`);

// ─── SAVE ───
console.log('\n💾 Saving...');
writeFileSync(DB_PATH, JSON.stringify(deduped, null, 2), 'utf8');

console.log(`\n${'═'.repeat(60)}`);
console.log('✅ POST-MERGE VALIDATION COMPLETE');
console.log(`   Final DB: ${deduped.toLocaleString().length > 0 ? deduped.length.toLocaleString() : deduped.length} cases`);
console.log(`   Deduped: -${stats.deduped}`);
console.log(`   IDs fixed: ${stats.idFixed}`);
console.log(`   ExamTypes assigned: ${stats.examTyped.toLocaleString()}`);
console.log(`   Categories fixed: ${stats.catFixed}`);
console.log(`   Options issues: ${stats.optFixed + stats.noCorrect}`);
