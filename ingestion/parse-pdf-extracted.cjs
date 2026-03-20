/**
 * Parse UKMPPD from extracted PDF text files (output of extract_pdfs.py)
 * Handles the clean PyMuPDF-extracted text from PDF referensi
 * 
 * Usage: node ingestion/parse-pdf-extracted.cjs
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('=== Parse Extracted PDF Text Files ===\n');

// Load existing for dedup
let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));
let nextId = 980000 + cases.filter(c => c._id >= 980000).length;

// Build text-based fuzzy dedup index from ALL existing UKMPPD cases
function textFingerprint(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 100);
}
const existingFingerprints = new Set();
for (const c of cases) {
  if (c.meta?.examType === 'UKMPPD' && c.vignette?.narrative) {
    existingFingerprints.add(textFingerprint(c.vignette.narrative));
  }
}
console.log(`Existing: ${cases.length.toLocaleString()} cases (${existingFingerprints.size} UKMPPD fingerprints)\n`);

// Find all pdf_*.txt files in output
const pdfTxtFiles = fs.readdirSync(OUTPUT_DIR)
  .filter(f => f.startsWith('pdf_') && f.endsWith('.txt'))
  .filter(f => {
    // Skip files we've already parsed from TXT referensi
    const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
    return size > 1000; // Skip near-empty files (image-only PDFs)
  });

console.log(`Found ${pdfTxtFiles.length} extracted PDF text files\n`);

function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.match(/\b(anak|pediatr|neonat|bayi|balita)\b/)) return 'Pediatrics';
  if (t.match(/\b(hamil|obstetri|partus|kehamilan|persalinan)\b/)) return 'Obstetrics & Gynecology';
  if (t.match(/\b(bedah|operasi|fraktur|laparoto|appendik|hernia|luka.*bakar)\b/)) return 'Surgery';
  if (t.match(/\b(mata|visus|retina|katarak|glaukom|konjungtiv)\b/)) return 'Ophthalmology';
  if (t.match(/\b(telinga|hidung|tht|tonsil|sinusit|otitis)\b/)) return 'ENT';
  if (t.match(/\b(kulit|dermat|urtikaria|eksim|psoriasis|skabies|eritema|bula|papul)\b/)) return 'Dermatology';
  if (t.match(/\b(jiwa|psikiat|halusinasi|waham|depresi|cemas|skizofrenia)\b/)) return 'Psychiatry';
  if (t.match(/\b(saraf|neurol|stroke|epilepsi|kejang|meningit)\b/)) return 'Neurology';
  if (t.match(/\b(jantung|kardio|hipertensi|EKG|koroner|aritmia)\b/)) return 'Cardiology';
  if (t.match(/\b(paru|pneumonia|tb|tuberkulosis|asma|ppok|bronk|sesak.*napas)\b/)) return 'Pulmonology';
  if (t.match(/\b(ginjal|urol|batu.*ginjal|nefr|dialisis)\b/)) return 'Nephrology';
  if (t.match(/\b(diabetes|dm|tiroid|hormon|endokrin|insulin)\b/)) return 'Endocrinology';
  if (t.match(/\b(anemia|hemoglobin|leukosit|trombosit|transfusi|hemofilia|talasemia)\b/)) return 'Hematology';
  if (t.match(/\b(forensik|visum|mayat|tanatolog)\b/)) return 'Forensic Medicine';
  if (t.match(/\b(masyarakat|epidemiol|surveilans|puskesmas)\b/)) return 'Public Health';
  if (t.match(/\b(farmako|obat|dosis|efek.*samping|interaksi)\b/)) return 'Pharmacology';
  if (t.match(/\b(vagina|serviks|pap smear|keputihan)\b/)) return 'Obstetrics & Gynecology';
  return 'General Medicine';
}

let totalAdded = 0;

for (const txtFile of pdfTxtFiles) {
  const filePath = path.join(OUTPUT_DIR, txtFile);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  
  // Extract source PDF name
  const pdfName = txtFile.replace('pdf_', '').replace('.txt', '.pdf');
  const sourceTag = 'ukmppd-pdf-scribd';
  
  console.log(`--- ${pdfName} (${lines.length} lines, ${(raw.length/1024).toFixed(0)} KB) ---`);
  
  // Parse questions
  const questions = [];
  let currentQ = null;
  let explanationMode = false;
  let currentExplanation = '';
  
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length < 3) continue;
    
    // Detect numbered question
    const qMatch = t.match(/^(\d{1,4})\.\s+(.{15,})/);
    if (qMatch) {
      const num = parseInt(qMatch[1], 10);
      if (num > 0 && num < 2000) {
        // Save previous
        if (currentQ && currentQ.opts.length >= 2 && currentQ.text.length > 20) {
          if (explanationMode) currentQ.explanation = currentExplanation.trim();
          questions.push(currentQ);
        }
        currentQ = { number: num, text: qMatch[2], opts: [], explanation: '' };
        explanationMode = false;
        currentExplanation = '';
        continue;
      }
    }
    
    // Detect patient-name start (backup pattern)
    if (!currentQ) {
      const patientMatch = t.match(/^(Tn\.|Ny\.|Nn\.|An\.|By\.|Seorang)\s+.{20,}/i);
      if (patientMatch) {
        if (currentQ && currentQ.opts.length >= 2) questions.push(currentQ);
        currentQ = { number: questions.length + 1, text: t, opts: [], explanation: '' };
        explanationMode = false;
        currentExplanation = '';
        continue;
      }
    }
    
    // Detect explanation markers
    if (t.match(/^(Jawaban|Pembahasan|Penjelasan|Kunci|Answer)\s*[:\.]?\s*/i)) {
      explanationMode = true;
      const afterMarker = t.replace(/^(Jawaban|Pembahasan|Penjelasan|Kunci|Answer)\s*[:\.]?\s*/i, '').trim();
      if (afterMarker.length > 5) currentExplanation += afterMarker + ' ';
      continue;
    }
    
    // Detect option
    const optMatch = t.match(/^([A-Ea-e])[\.\)]\s+(.{2,})/);
    if (optMatch && currentQ && !explanationMode) {
      const letter = optMatch[1].toUpperCase();
      const optText = optMatch[2].trim();
      if (optText.length > 1 && !currentQ.opts.find(o => o.l === letter)) {
        currentQ.opts.push({ l: letter, t: optText });
      }
      continue;
    }
    
    // Accumulate text
    if (currentQ) {
      if (explanationMode) {
        if (t.length > 5) currentExplanation += t + ' ';
      } else if (t.length > 8 && !t.match(/^(Page|Halaman|Copyright|©|Scribd|www\.|http)/i)) {
        currentQ.text += ' ' + t;
      }
    }
  }
  // Save last
  if (currentQ && currentQ.opts.length >= 2 && currentQ.text.length > 20) {
    if (explanationMode) currentQ.explanation = currentExplanation.trim();
    questions.push(currentQ);
  }
  
  console.log(`  Parsed: ${questions.length} questions`);
  
  // Inject
  let added = 0, skipped = 0, textDupes = 0;
  for (const q of questions) {
    const hashId = `${sourceTag}_${pdfName.replace('.pdf','')}_q${q.number}`;
    if (existingHashes.has(hashId)) { skipped++; continue; }
    
    // Text-based fuzzy dedup
    const fp = textFingerprint(q.text);
    if (existingFingerprints.has(fp)) { textDupes++; continue; }
    existingFingerprints.add(fp);
    existingHashes.add(hashId);
    
    // Detect verified answer from explanation
    let detectedAnswer = null;
    if (q.explanation) {
      const ansMatch = q.explanation.match(/jawaban(?:nya)?[\s:]+(?:adalah\s+)?([A-E])/i);
      if (ansMatch) detectedAnswer = ansMatch[1].toUpperCase();
    }
    
    const category = detectCategory(q.text);
    cases.push({
      _id: nextId++,
      hash_id: hashId,
      q_type: 'MCQ',
      confidence: detectedAnswer ? 3.5 : 2.0,
      category,
      title: q.text.trim().substring(0, 80) + (q.text.length > 80 ? '...' : ''),
      vignette: { demographics: { age: null, sex: null }, narrative: q.text.trim() },
      prompt: '',
      options: q.opts.map((o, idx) => ({
        id: o.l, text: o.t,
        is_correct: detectedAnswer ? o.l === detectedAnswer : idx === 0,
      })),
      rationale: { correct: q.explanation || '', distractors: {} },
      meta: {
        source: sourceTag, examType: 'UKMPPD', difficulty: 3,
        filename: pdfName, originalNumber: q.number,
        hasVerifiedAnswer: !!detectedAnswer,
      },
      validation: {
        overallScore: detectedAnswer ? 3.5 : 2.0,
        layers: { content: 4, answer: detectedAnswer ? 4 : 1, format: 3, image: 5,
                  explanation: q.explanation ? 4 : 1, source: 3 },
        standard: 'pymupdf-parse',
        warnings: detectedAnswer ? [] : ['answer_key_unverified'],
      },
    });
    
    // Demographics
    const ageMatch = q.text.match(/(\d{1,3})\s*(tahun|bulan|hari)/i);
    if (ageMatch) cases[cases.length-1].vignette.demographics.age = parseInt(ageMatch[1], 10);
    const sexMatch = q.text.match(/(laki-?laki|perempuan|pria|wanita|Tn\.|Ny\.|Nn\.|An\.|By\.)/i);
    if (sexMatch) cases[cases.length-1].vignette.demographics.sex = 
      sexMatch[1].toLowerCase().match(/(laki|pria|tn)/i) ? 'M' : 'F';
    
    added++;
  }
  
  console.log(`  Added: ${added}, Hash-skipped: ${skipped}, Text-dupes: ${textDupes}\n`);
  totalAdded += added;
}

if (totalAdded > 0) {
  fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
}

console.log(`\nTotal NEW from PDFs: ${totalAdded}`);
console.log(`Total cases: ${cases.length.toLocaleString()}`);
console.log(`UKMPPD total: ${cases.filter(c => c.meta?.examType === 'UKMPPD').length}`);
console.log('Done!\n');
