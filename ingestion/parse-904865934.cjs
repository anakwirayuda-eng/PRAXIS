/**
 * Parse 904865934-Copy-of-Soal-Try-Out-Prediksi-Batch-Agustus-2025-h2.txt ONLY
 * Targeted parser for UKDI Corner tryout format with heavy annotations
 * 
 * Usage: node ingestion/parse-904865934.cjs
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'TXT referensi', '904865934-Copy-of-Soal-Try-Out-Prediksi-Batch-Agustus-2025-h2.txt');
const COMPILED = path.join(__dirname, 'output', 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('═══ Parse 904865934 Tryout UKMPPD 2025 ═══\n');

const raw = fs.readFileSync(FILE, 'utf-8');
const lines = raw.split('\n');

// Noise patterns to skip/ignore
const SKIP_LINE = /^(TRY OUT|WWW\.|#Solusi|Divisi|UKDI|TO PREDIKSI|BTKV|INTEGUMEN|RHEUMATOLOGI|BEDAH PLASTIK|BEDAH DIGESTIF|BEDAH ONKOLOGI|BEDAH ORTHOPEDI)/i;
const ANNOTATION = /^(dx\s*:|Tx\s*:|etio\s*:|Potepst|Tawal|tipel|Rumus|bolch|coment|Anatomi|lasifikasi|goop|pxmakro|mikroskop|peritoneum|Glokasi|regio|mutian|very poten|selunder|tepst|Rtepat|ebukan|kendur|pempigus|self limited)/i;

const questions = [];
let currentQ = null;

for (const line of lines) {
  const t = line.trim();
  
  // Skip empty, form feeds, pure numbers, short garbage
  if (!t || /^\f/.test(t) || /^\d{1,2}$/.test(t) || t.length < 3) continue;
  if (SKIP_LINE.test(t)) continue;
  if (/^[\*\-\>\<\|\u2190\u2193\u2191\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467XS]\s*$/.test(t)) continue;
  if (/^[\u2460-\u2469]/.test(t)) continue;
  if (/^(r\/|D\s+Bar|NDIAR|\u2218)/.test(t)) continue;
  
  // Detect patient scenario start (Tn./Ny./Nn./An./By./Seorang + substantial text)
  const patientStart = t.match(/^(Tn\.|Ny\.|Nn\.|An\.|By\.|Seorang\s)/i);
  if (patientStart && t.length > 30) {
    // Save previous
    if (currentQ && currentQ.opts.length >= 2 && currentQ.text.length > 30) {
      questions.push(currentQ);
    }
    currentQ = { text: t, opts: [] };
    continue;
  }
  
  // Detect option line
  const optMatch = t.match(/^([a-eA-E])[\.\)]\s+(.{3,})/);
  if (optMatch && currentQ) {
    const letter = optMatch[1].toUpperCase();
    let optText = optMatch[2]
      .replace(/\s*[-\u2013]\s*$/, '')      // trailing dash
      .replace(/\s+dx\s*:.*/i, '')          // dx: annotation
      .replace(/\s+Tx\s*:.*/i, '')          // Tx: annotation
      .replace(/\s+etio\s*:.*/i, '')        // etio: annotation
      .replace(/very poten$/i, '')          // potency annotation
      .replace(/\s*[\u2460-\u2469].*/g, '')  // circled numbers
      .trim();
    if (optText.length > 1 && !currentQ.opts.find(o => o.l === letter)) {
      currentQ.opts.push({ l: letter, t: optText });
    }
    continue;
  }
  
  // Accumulate question text (skip annotations)
  if (currentQ && t.length > 10 && !ANNOTATION.test(t) && !SKIP_LINE.test(t)) {
    let clean = t
      .replace(/\s*dx\s*:.*/gi, '')
      .replace(/\s*Tx\s*:.*/gi, '')
      .replace(/\s*etio\s*:.*/gi, '')
      .replace(/[\u2460-\u2469]/g, '')
      .replace(/\s*[-\u2013]\s*$/, '')
      .trim();
    if (clean.length > 5) {
      currentQ.text += ' ' + clean;
    }
  }
}
// Save last
if (currentQ && currentQ.opts.length >= 2 && currentQ.text.length > 30) {
  questions.push(currentQ);
}

console.log(`Parsed: ${questions.length} questions\n`);

// Show first 3 for verification
questions.slice(0, 3).forEach((q, i) => {
  console.log(`Q${i+1}: ${q.text.substring(0, 120)}...`);
  console.log(`  Options: ${q.opts.map(o => o.l + '. ' + o.t.substring(0, 40)).join(' | ')}\n`);
});

// Load existing for dedup
let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));

function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.match(/\b(anak|pediatr|neonat|bayi|balita)\b/)) return 'Pediatrics';
  if (t.match(/\b(hamil|obstetri|partus|kehamilan|persalinan)\b/)) return 'Obstetrics & Gynecology';
  if (t.match(/\b(bedah|operasi|fraktur|laparoto|appendik|hernia|luka.*bakar|tendon|achilles|klavikula|kompartemen)\b/)) return 'Surgery';
  if (t.match(/\b(mata|visus|retina|katarak|glaukom|konjungtiv)\b/)) return 'Ophthalmology';
  if (t.match(/\b(telinga|hidung|tht|tonsil|sinusit|otitis)\b/)) return 'ENT';
  if (t.match(/\b(kulit|dermat|urtikaria|eksim|psoriasis|skabies|eritema|bula|plak|papul|pustul|selulitis|erisipelas)\b/)) return 'Dermatology';
  if (t.match(/\b(jiwa|psikiat|halusinasi|waham|depresi|cemas|skizofrenia)\b/)) return 'Psychiatry';
  if (t.match(/\b(saraf|neurol|stroke|epilepsi|kejang|meningit)\b/)) return 'Neurology';
  if (t.match(/\b(jantung|kardio|hipertensi|EKG|koroner|aritmia)\b/)) return 'Cardiology';
  if (t.match(/\b(paru|pneumonia|tb|tuberkulosis|asma|ppok|bronk|sesak.*napas)\b/)) return 'Pulmonology';
  if (t.match(/\b(ginjal|urol|batu.*ginjal|nefr|dialisis)\b/)) return 'Nephrology';
  if (t.match(/\b(diabetes|dm|tiroid|hormon|endokrin|insulin)\b/)) return 'Endocrinology';
  if (t.match(/\b(anemia|hemoglobin|leukosit|trombosit|transfusi|hemofilia|talasemia)\b/)) return 'Hematology';
  if (t.match(/\b(forensik|visum|mayat|tanatolog)\b/)) return 'Forensic Medicine';
  if (t.match(/\b(masyarakat|epidemiol|surveilans|puskesmas)\b/)) return 'Public Health';
  if (t.match(/\b(vagina|serviks|duh|pap smear|keputihan)\b/)) return 'Obstetrics & Gynecology';
  if (t.match(/\b(hemoroid|fistula|appendisitis|peritonitis|intususepsi|hirschprung|atresia)\b/)) return 'Surgery';
  if (t.match(/\b(asam urat|gout|osteoporosis|spondilo|artritis)\b/)) return 'Rheumatology';
  return 'General Medicine';
}

let nextId = 965000;
let added = 0, skipped = 0;
const newCases = [];

for (let i = 0; i < questions.length; i++) {
  const q = questions[i];
  const hashId = `ukmppd-ukdicorner_904865934_q${i+1}`;
  if (existingHashes.has(hashId)) { skipped++; continue; }
  
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
    options: q.opts.map((o, idx) => ({
      id: o.l, text: o.t, is_correct: idx === 0,
    })),
    rationale: { correct: '', distractors: {} },
    meta: {
      source: 'ukmppd-ukdicorner', examType: 'UKMPPD', difficulty: 3,
      filename: '904865934-Copy-of-Soal-Try-Out-Prediksi-Batch-Agustus-2025-h2.txt',
      originalNumber: i + 1, hasVerifiedAnswer: false,
    },
    validation: {
      overallScore: 2.0,
      layers: { content: 4, answer: 1, format: 3, image: 5, explanation: 1, source: 3 },
      standard: 'ukdicorner-txt-parse', warnings: ['answer_key_unverified'],
    },
  };
  
  const ageMatch = q.text.match(/(\d{1,3})\s*(tahun|bulan|hari)/i);
  if (ageMatch) caseObj.vignette.demographics.age = parseInt(ageMatch[1], 10);
  const sexMatch = q.text.match(/(laki-?laki|perempuan|pria|wanita|Tn\.|Ny\.|Nn\.|An\.|By\.)/i);
  if (sexMatch) caseObj.vignette.demographics.sex = sexMatch[1].toLowerCase().match(/(laki|pria|tn)/i) ? 'M' : 'F';
  
  newCases.push(caseObj);
  added++;
}

console.log(`\nAdded: ${added}, Skipped (dedup): ${skipped}`);

// Category breakdown
const cats = {};
for (const c of newCases) cats[c.category] = (cats[c.category] || 0) + 1;
console.log('\nCategory breakdown:');
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}

if (newCases.length > 0) {
  cases.push(...newCases);
  fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
  console.log(`\nTotal cases now: ${cases.length.toLocaleString()}`);
  console.log(`UKMPPD total: ${cases.filter(c => c.meta && c.meta.examType === 'UKMPPD').length}`);
}
console.log('Done!');
