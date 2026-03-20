/**
 * Parse AIPKI UGM PDF text → MedCase Pro JSON
 * PDF format: numbered questions (1., 2., ...) with a.-e. options
 * Much cleaner than DOCX extraction
 */
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'output', 'aipki_ugm_pdf_raw.txt'), 'utf-8');

console.log('═══ Parse AIPKI UGM (PDF version) ═══\n');

// Remove page headers
const clean = raw.replace(/Kumpulan Soal Tryout AIPKI Regio IV\r?\n/g, '');

// Split by question numbers: "1.", "2.", ..., "234."
const qPattern = /(?:^|\n)\s*(\d+)\.\s*\n?/;
const parts = clean.split(/(?:^|\n)\s*\d+\.\s*\n?/).filter(p => p.trim().length > 10);

console.log(`Raw question blocks: ${parts.length}`);

function guessCategory(t) {
  t = t.toLowerCase();
  if (/jantung|cardiac|ekg|infark|murmur|aritmia/.test(t)) return 'cardiology';
  if (/paru|pneumonia|tb|asma|batuk|ppok|sesak napas/.test(t)) return 'pulmonology';
  if (/saraf|stroke|kejang|epilepsi|meningitis|koma|hemisfer/.test(t)) return 'neurology';
  if (/anak|bayi|neonatus|imunisasi|lahir|pertumbuhan|balita/.test(t)) return 'pediatrics';
  if (/hamil|partus|persalinan|janin|kehamilan|kontrasepsi|obstetri|serviks|seksio/.test(t)) return 'obgyn';
  if (/kulit|dermatit|ruam|gatal|urtikaria|psoriasis|eksim/.test(t)) return 'dermatology';
  if (/mata|visus|konjungtiv|katarak|glaukoma|retina|kornea/.test(t)) return 'ophthalmology';
  if (/telinga|tht|sinusitis|otitis|tonsil|faringitis|laring/.test(t)) return 'ent';
  if (/jiwa|depresi|cemas|skizofreni|paranoid|halusinasi|bipolar|obsesi|fobia|malingering|somatoform|konversi|disosia|psikotik|waham/.test(t)) return 'psychiatry';
  if (/bedah|operasi|fraktur|luka|trauma|apendik|hernia|ileus/.test(t)) return 'surgery';
  if (/ginjal|batu.saluran|hematuria|kreatinin|ureter/.test(t)) return 'nephrology';
  if (/hepatitis|sirosis|ikterus|diare|gastri|kolon|usus/.test(t)) return 'gastroenterology';
  if (/diabetes|tiroid|hormon|insulin|cushing/.test(t)) return 'endocrinology';
  if (/anemia|leukosit|trombosit|darah|transfusi/.test(t)) return 'hematology';
  if (/forensik|visum|mayat|KUHP|KUHAP|autopsi|lebam|gantung|tenggelam|keracunan|identitas|medikolegal/.test(t)) return 'forensics';
  if (/etika|informed.consent|otonom|beneficence/.test(t)) return 'bioethics';
  if (/epidemiologi|prevalensi|screening|surveilans|masyarakat/.test(t)) return 'public-health';
  if (/farmakologi|dosis|efek.samping|kontraindikasi/.test(t)) return 'pharmacology';
  return 'internal-medicine';
}

function extractDemo(text) {
  const result = {};
  const a = text.match(/(\d+)\s*(tahun|th|bulan)/i);
  if (a) {
    if (/tahun|th/i.test(a[2])) result.age = parseInt(a[1]);
    else result.age = parseFloat((parseInt(a[1]) / 12).toFixed(1));
  }
  if (/\b(laki|pria|Tn|bapak)\b/i.test(text)) result.sex = 'M';
  else if (/\b(wanita|perempuan|ibu|Ny|gadis)\b/i.test(text)) result.sex = 'F';
  return result;
}

const questions = [];

for (const block of parts) {
  // Split by option markers: a., b., c., d., e. (or f,g,h,i,j)
  const optSplit = block.split(/\n\s*([a-j])\.\s*\n?/i);
  
  if (optSplit.length < 3) continue; // No options found
  
  // First part is the vignette
  let vignette = optSplit[0].trim()
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (vignette.length < 15) continue;
  
  // Parse options: optSplit alternates between letter and text
  const options = [];
  for (let i = 1; i < optSplit.length - 1; i += 2) {
    const letter = optSplit[i].toUpperCase();
    const text = (optSplit[i + 1] || '').trim().replace(/\r/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      options.push({ id: letter, text, is_correct: false });
    }
  }
  
  if (options.length < 3) continue;
  
  questions.push({
    q_type: 'MCQ',
    category: guessCategory(vignette),
    title: vignette.substring(0, 80) + (vignette.length > 80 ? '...' : ''),
    vignette: {
      narrative: vignette,
      demographics: extractDemo(vignette),
    },
    prompt: 'Pilih jawaban yang paling tepat.',
    options,
    rationale: { correct: '', distractors: {} },
    meta: {
      source: 'aipki-ugm',
      examType: 'UKMPPD',
      difficulty: 2,
      tags: ['AIPKI', 'UGM', 'Regio IV'],
      needsAnswerKey: true,
    },
  });
}

console.log(`Parsed: ${questions.length} questions`);

// Save
const outPath = path.join(__dirname, 'output', 'aipki_ugm_parsed.json');
fs.writeFileSync(outPath, JSON.stringify(questions, null, 2), 'utf-8');

// Category breakdown
const cats = {};
for (const q of questions) { cats[q.category] = (cats[q.category] || 0) + 1; }
console.log('\nCategory breakdown:');
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(22)} ${count}`);
}

// Re-inject into compiled_cases.json
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'compiled_cases.json'), 'utf-8'));
const withoutOld = cases.filter(c => c.meta?.source !== 'aipki-ugm');
const startId = withoutOld.length;
for (let k = 0; k < questions.length; k++) {
  questions[k]._id = startId + k;
  questions[k]._searchKey = [
    questions[k].title, questions[k].vignette?.narrative, questions[k].category,
    ...(questions[k].meta?.tags || []),
    ...questions[k].options.map(o => o.text),
  ].filter(Boolean).join(' ').toLowerCase();
  withoutOld.push(questions[k]);
}
fs.writeFileSync(path.join(__dirname, 'output', 'compiled_cases.json'), JSON.stringify(withoutOld), 'utf-8');
fs.copyFileSync(
  path.join(__dirname, 'output', 'compiled_cases.json'),
  path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'),
);
console.log(`\nInjected: ${questions.length} (replaced old AIPKI)`);
console.log(`Total cases: ${withoutOld.length}`);
