/**
 * Parse UKMPPD from PDF using pdf-parse
 * Specifically for the 2025 tryout and PDF referensi folder
 * 
 * Usage: node ingestion/parse-ukmppd-pdf.mjs
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const PDF_DIRS = [
  join(import.meta.dirname, '..', 'TXT referensi'),
  join(import.meta.dirname, '..', 'PDF referensi'),
];
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('══════════════════════════════════════════════════');
console.log(' UKMPPD PDF Parser');
console.log('══════════════════════════════════════════════════\n');

// Load existing for dedup
let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));
console.log(`📦 Existing: ${cases.length.toLocaleString()} cases\n`);

const allParsed = [];
let nextId = 960000 + cases.filter(c => c._id >= 960000).length;

// Collect all PDF files
const pdfFiles = [];
for (const dir of PDF_DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.pdf')) {
      pdfFiles.push(join(dir, f));
    }
  }
}
console.log(`📂 Found ${pdfFiles.length} PDF files\n`);

function parseQuestionsFromText(text) {
  const lines = text.split('\n');
  const questions = [];
  let currentQ = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect numbered question
    const qMatch = trimmed.match(/^(\d{1,3})\.\s+(.{20,})/);
    if (qMatch) {
      if (currentQ && currentQ.options.length >= 2) questions.push(currentQ);
      currentQ = { number: parseInt(qMatch[1], 10), text: qMatch[2], options: [] };
      continue;
    }

    // Detect option (A-E or a-e)
    const optMatch = trimmed.match(/^([A-Ea-e])[\.\)]\s+(.{2,})/);
    if (optMatch && currentQ) {
      const letter = optMatch[1].toUpperCase();
      let optText = optMatch[2].trim()
        .replace(/\s*-\s*$/, '')
        .replace(/\s+dx\s*:.*/i, '')
        .replace(/\s+Tx\s*:.*/i, '')
        .trim();
      if (optText.length > 1 && !currentQ.options.find(o => o.letter === letter)) {
        currentQ.options.push({ letter, text: optText });
      }
      continue;
    }

    // Accumulate question text (skip headers/noise)
    if (currentQ && trimmed.length > 10 &&
        !trimmed.match(/^(TRY OUT|WWW\.|#Solusi|OPTIMA|PSIKIATRI|BEDAH|INTEGUMEN|RHEUMATOLOGI)/i) &&
        !trimmed.match(/^(dx\s*:|Tx\s*:)/i) &&
        !trimmed.match(/^(BTKV|BEDAH PLASTIK|BEDAH DIGESTIF|BEDAH ONKOLOGI|BEDAH ORTHOPEDI)/i)) {
      currentQ.text += ' ' + trimmed;
    }
  }
  if (currentQ && currentQ.options.length >= 2) questions.push(currentQ);
  return questions;
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.match(/\b(anak|pediatr|neonat|bayi|balita)\b/)) return 'Pediatrics';
  if (t.match(/\b(hamil|obstetri|partus|kehamilan|persalinan|nifas|post.*partum)\b/)) return 'Obstetrics & Gynecology';
  if (t.match(/\b(bedah|operasi|fraktur|laparoto|appendik|hernia|luka.*bakar|tendon)\b/)) return 'Surgery';
  if (t.match(/\b(mata|visus|retina|katarak|glaukom|konjungtiv|oftalmol)\b/)) return 'Ophthalmology';
  if (t.match(/\b(telinga|hidung|tht|tonsil|sinusit|rinit|otitis)\b/)) return 'ENT';
  if (t.match(/\b(kulit|dermat|urtikaria|eksim|psoriasis|skabies|eritema|bula|plak|papul|pustul)\b/)) return 'Dermatology';
  if (t.match(/\b(jiwa|psikiat|halusinasi|waham|depresi|cemas|skizofrenia)\b/)) return 'Psychiatry';
  if (t.match(/\b(saraf|neurol|stroke|epilepsi|kejang|meningit)\b/)) return 'Neurology';
  if (t.match(/\b(jantung|kardio|hipertensi|EKG|koroner|aritmia)\b/)) return 'Cardiology';
  if (t.match(/\b(paru|pneumonia|tb|tuberkulosis|asma|ppok|bronk|sesak.*napas)\b/)) return 'Pulmonology';
  if (t.match(/\b(ginjal|urol|batu.*ginjal|nefr|dialisis|hemodialisis)\b/)) return 'Nephrology';
  if (t.match(/\b(diabetes|dm|tiroid|hormon|endokrin|insulin)\b/)) return 'Endocrinology';
  if (t.match(/\b(anemia|hb|hemoglobin|leukosit|trombosit|transfusi|hemofilia|talasemia|leukemia|limfoma)\b/)) return 'Hematology';
  if (t.match(/\b(forensik|visum|mayat|tanatolog|toksikolog)\b/)) return 'Forensic Medicine';
  if (t.match(/\b(masyarakat|epidemiol|surveilans|puskesmas|promosi.*kesehatan)\b/)) return 'Public Health';
  if (t.match(/\b(farmako|obat|dosis|efek.*samping|interaksi)\b/)) return 'Pharmacology';
  return 'General Medicine';
}

for (const pdfPath of pdfFiles) {
  const fname = basename(pdfPath);
  console.log(`━━━ ${fname} ━━━`);
  
  try {
    const buf = readFileSync(pdfPath);
    const data = await pdfParse(buf);
    console.log(`  Pages: ${data.numpages}, Text: ${(data.text.length / 1024).toFixed(0)} KB`);
    
    // Save extracted text for debugging
    writeFileSync(join(OUTPUT_DIR, `pdf_${fname.replace('.pdf', '.txt')}`), data.text, 'utf-8');
    
    const questions = parseQuestionsFromText(data.text);
    console.log(`  Parsed: ${questions.length} questions`);
    
    const sourceTag = 'ukmppd-pdf-scribd';
    let added = 0, skipped = 0;
    
    for (const q of questions) {
      const hashId = `${sourceTag}_${basename(fname, '.pdf')}_q${q.number}`;
      if (existingHashes.has(hashId)) { skipped++; continue; }
      existingHashes.add(hashId);
      
      const category = detectCategory(q.text);
      const caseObj = {
        _id: nextId++,
        hash_id: hashId,
        q_type: 'MCQ',
        confidence: 2.0,
        category,
        title: q.text.trim().substring(0, 80) + (q.text.length > 80 ? '...' : ''),
        vignette: {
          demographics: { age: null, sex: null },
          narrative: q.text.trim(),
        },
        prompt: '',
        options: q.options.map((o, idx) => ({
          id: o.letter, text: o.text, is_correct: idx === 0,
        })),
        rationale: { correct: '', distractors: {} },
        meta: {
          source: sourceTag, examType: 'UKMPPD', difficulty: 3,
          filename: fname, originalNumber: q.number, hasVerifiedAnswer: false,
        },
        validation: {
          overallScore: 2.0,
          layers: { content: 4, answer: 1, format: 3, image: 5, explanation: 1, source: 3 },
          standard: 'pdf-parse', warnings: ['answer_key_unverified'],
        },
      };
      
      // Demographics
      const ageMatch = q.text.match(/(\d{1,3})\s*(tahun|bulan|hari)/i);
      if (ageMatch) caseObj.vignette.demographics.age = parseInt(ageMatch[1], 10);
      const sexMatch = q.text.match(/(laki-?laki|perempuan|pria|wanita|Tn\.|Ny\.|Nn\.|An\.|By\.)/i);
      if (sexMatch) caseObj.vignette.demographics.sex = sexMatch[1].toLowerCase().match(/(laki|pria|tn)/i) ? 'M' : 'F';
      
      allParsed.push(caseObj);
      added++;
    }
    console.log(`  ✅ Added: ${added}, Skipped: ${skipped}\n`);
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }
}

console.log(`\n📊 Total NEW from PDFs: ${allParsed.length}`);

// Category breakdown
const cats = {};
for (const c of allParsed) cats[c.category] = (cats[c.category] || 0) + 1;
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}

if (allParsed.length > 0) {
  cases.push(...allParsed);
  writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  copyFileSync(COMPILED, PUBLIC_COMPILED);
  console.log(`\n📦 Total cases now: ${cases.length.toLocaleString()}`);
}
console.log(`  UKMPPD total: ${cases.filter(c => c.meta?.examType === 'UKMPPD').length + allParsed.length}`);
console.log(`✅ Done!\n`);
