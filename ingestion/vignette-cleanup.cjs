/**
 * TASK 6: UKMPPD Vignette Cleanup — The Regex Guillotine
 * Strips PDF noise, expands abbreviations, joins orphan sentences.
 * $0 cost, pure local processing.
 * 
 * Usage: node ingestion/vignette-cleanup.cjs
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('═══ TASK 6: Vignette Cleanup — Regex Guillotine ═══\n');

let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));

// Indonesian medical abbreviation dictionary
const ABBREVIATIONS = {
  ' px ': ' pasien ',
  ' Px ': ' Pasien ',
  ' tx ': ' terapi ',
  ' Tx ': ' Terapi ',
  ' dx ': ' diagnosis ',
  ' Dx ': ' Diagnosis ',
  ' hx ': ' riwayat ',
  ' Hx ': ' Riwayat ',
  ' cx ': ' cervix ',
  ' Cx ': ' Cervix ',
  ' sx ': ' simptom ',
  ' Sx ': ' Simptom ',
  ' rx ': ' resep ',
  ' Rx ': ' Resep ',
  ' dd ': ' diagnosis banding ',
  ' DD ': ' Diagnosis Banding ',
  ' KU ': ' keadaan umum ',
  ' TD ': ' tekanan darah ',
  ' RR ': ' respiratory rate ',
  ' HR ': ' heart rate ',
  ' GCS ': ' Glasgow Coma Scale ',
  ' TTV ': ' tanda-tanda vital ',
  ' SOAP ': ' Subjektif Objektif Asesmen Plan ',
  ' UGD ': ' Unit Gawat Darurat ',
  ' IGD ': ' Instalasi Gawat Darurat ',
  ' ICU ': ' Intensive Care Unit ',
  ' NICU ': ' Neonatal ICU ',
  ' VT ': ' vaginal toucher ',
};

const fixes = {
  pdfNoise: 0,
  headerFooter: 0,
  bulletDestructor: 0,
  orphanSentence: 0,
  abbreviation: 0,
  trailingWhitespace: 0,
  ansRefClean: 0,
  pageRefClean: 0,
  extraMileClean: 0,
};

function cleanText(text) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text;
  const original = text;

  // 1. PDF page numbers: "Hal 45 dari 100", "Page 3 of 50", "3/100"
  cleaned = cleaned.replace(/(Hal|Halaman|Page)\s*\d+\s*(dari|of|\/)\s*\d+/gi, '');
  
  // 2. PDF header/footer noise
  cleaned = cleaned.replace(/Soal Try Out UKMPPD/gi, '');
  cleaned = cleaned.replace(/SOAL UKMPPD/gi, '');
  cleaned = cleaned.replace(/Try ?Out UKMPPD/gi, '');
  cleaned = cleaned.replace(/Kumpulan Soal UKMPPD/gi, '');
  cleaned = cleaned.replace(/Rekapan Soal UKMPPD/gi, '');
  cleaned = cleaned.replace(/Pembahasan UKMPPD/gi, '');
  cleaned = cleaned.replace(/Copyright\s*©?\s*\d*/gi, '');
  
  // 3. Bullet/option artifacts stuck in text
  cleaned = cleaned.replace(/^[A-E]\.\s*jawaban[•\-*]?\s*/gmi, '');
  
  // 4. Orphan sentence joiner (line breaks in middle of sentences)
  cleaned = cleaned.replace(/([a-z,;:])\s*\n\s*([a-z])/gi, '$1 $2');
  
  // 5. Multiple spaces/newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/ {2,}/g, ' ');
  cleaned = cleaned.trim();

  if (cleaned !== original) return { text: cleaned, changed: true };
  return { text: cleaned, changed: false };
}

function cleanExplanation(text) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text;
  const original = text;
  
  // "Ans. A/B/C/D/E." prefix
  cleaned = cleaned.replace(/^Ans\.\s*[A-Za-z]\.?\s*/i, '');
  
  // "Ref; textbook" references
  cleaned = cleaned.replace(/\s*Ref[;:]\s*.{0,100}$/i, '');
  
  // "pg. 57" page references
  cleaned = cleaned.replace(/\s*pg\.\s*\d+/gi, '');
  
  // "Extra mile:" / "Extra Mileage:" raw sections (noisy MedMCQA pattern)
  cleaned = cleaned.replace(/\s*Extra\s*mile:?\s*/gi, '\n');
  
  // "(Image)" phantom references
  cleaned = cleaned.replace(/\(Image\)/gi, '');
  
  cleaned = cleaned.trim();
  if (cleaned !== original) return { text: cleaned, changed: true };
  return { text: cleaned, changed: false };
}

let cleaned = 0;
for (const c of cases) {
  let changed = false;
  
  // Clean vignette narrative
  if (c.vignette?.narrative) {
    const r = cleanText(c.vignette.narrative);
    if (r.changed) {
      c.vignette.narrative = r.text;
      fixes.pdfNoise++;
      changed = true;
    }
  }
  
  // Clean title
  if (c.title) {
    const r = cleanText(c.title);
    if (r.changed) {
      c.title = r.text;
      fixes.headerFooter++;
      changed = true;
    }
  }
  
  // Clean prompt
  if (c.prompt) {
    const r = cleanText(c.prompt);
    if (r.changed) {
      c.prompt = r.text;
      fixes.bulletDestructor++;
      changed = true;
    }
  }
  
  // Clean explanation
  if (c.rationale?.correct) {
    const r = cleanExplanation(c.rationale.correct);
    if (r.changed) {
      c.rationale.correct = r.text;
      fixes.ansRefClean++;
      changed = true;
    }
  }
  
  // Clean option texts
  if (c.options) {
    for (const opt of c.options) {
      if (opt.text) {
        const trimmed = opt.text.trim();
        if (trimmed !== opt.text) {
          opt.text = trimmed;
          fixes.trailingWhitespace++;
          changed = true;
        }
      }
    }
  }
  
  // Expand UKMPPD abbreviations in narrative (only for UKMPPD sources)
  if (c.meta?.source?.includes('ukmppd') && c.vignette?.narrative) {
    let text = c.vignette.narrative;
    for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
      if (text.includes(abbr)) {
        text = text.split(abbr).join(full);
        fixes.abbreviation++;
        changed = true;
      }
    }
    c.vignette.narrative = text;
  }
  
  if (changed) cleaned++;
}

// Save
fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
fs.copyFileSync(COMPILED, PUBLIC_COMPILED);

console.log(`Cases cleaned: ${cleaned.toLocaleString()}\n`);
console.log('Fix breakdown:');
for (const [k, v] of Object.entries(fixes)) {
  if (v > 0) console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`);
}
console.log('\nDone!');
