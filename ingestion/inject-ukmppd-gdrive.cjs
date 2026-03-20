/**
 * Inject FDI v3 parsed questions into compiled_cases
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'output');

function guessCat(t) {
  t = t.toLowerCase();
  if (/jantung|cardio|ekg|ecg|coronar/.test(t)) return 'cardiology';
  if (/paru|pulmo|asma|pneum|sesak/.test(t)) return 'pulmonology';
  if (/neuro|stroke|kejang|epilep|meningit/.test(t)) return 'neurology';
  if (/anak|bayi|pediatr|neonat/.test(t)) return 'pediatrics';
  if (/hamil|obstetri|gineko|persalin/.test(t)) return 'obgyn';
  if (/kulit|derma|eksim/.test(t)) return 'dermatology';
  if (/mata|ophth|katarak|retina/.test(t)) return 'ophthalmology';
  if (/psikiatri|depresi|ansietas|skizo/.test(t)) return 'psychiatry';
  if (/bedah|fraktur|trauma|hernia|luka/.test(t)) return 'surgery';
  if (/ginjal|renal|nefro/.test(t)) return 'nephrology';
  if (/gastro|hati|hepat|lambung|usus/.test(t)) return 'gastroenterology';
  if (/diabet|tiroid|endokrin|insulin/.test(t)) return 'endocrinology';
  if (/anemia|darah|hematol|leuk/.test(t)) return 'hematology';
  if (/farmako|obat|dosis|reseptor/.test(t)) return 'pharmacology';
  if (/forens|visum|otopsi|medikolegal/.test(t)) return 'forensics';
  if (/tht|telinga|hidung|tenggorok/.test(t)) return 'ent';
  if (/ikm|epidemiol|statistik|kesmas|wabah|bpjs|puskesmas/.test(t)) return 'public-health';
  return 'internal-medicine';
}

const fdi = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'fdi_parsed_v3.json'), 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf8'));

// Build dedup set
const existing = new Set();
for (const c of cases) {
  const vig = (c.vignette?.narrative || '')
    .replace(/F\s*U\s*T\s*U\s*R\s*E.+?\.C\s*O\s*M/gi, '')
    .trim().substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
  if (vig.length > 10) existing.add(vig);
}

let sid = cases.length, added = 0, dup = 0;

for (const q of fdi) {
  const vig = q.vignette
    .replace(/F\s*U\s*T\s*U\s*R\s*E.+?\.C\s*O\s*M/gi, '')
    .trim();
  const key = vig.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
  
  if (existing.has(key)) { dup++; continue; }
  existing.add(key);
  
  cases.push({
    _id: sid++,
    q_type: 'MCQ',
    category: guessCat(vig),
    title: vig.substring(0, 80) + '...',
    vignette: { narrative: vig, demographics: {} },
    prompt: 'Pilih jawaban yang paling tepat.',
    options: q.options,
    rationale: { correct: q.rationale || '', distractors: {} },
    meta: {
      source: 'fdi-tryout',
      examType: 'UKMPPD',
      difficulty: 2,
      tags: ['FDI', 'Tryout', '2021'],
    },
  });
  added++;
}

// Atomic save
const tmp1 = path.join(OUTPUT, 'compiled_cases.json.tmp');
fs.writeFileSync(tmp1, JSON.stringify(cases), 'utf-8');
fs.renameSync(tmp1, path.join(OUTPUT, 'compiled_cases.json'));

const fc = cases.filter(c => !c.meta?.quarantined && !c.meta?.quarantine_flag);
const tmp2 = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json.tmp');
fs.writeFileSync(tmp2, JSON.stringify(fc), 'utf-8');
fs.renameSync(tmp2, path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'));

console.log('═══ FDI v3 Injection ═══');
console.log(`Parsed: ${fdi.length} | Added: ${added} | Dupes: ${dup}`);
console.log(`Master: ${cases.length.toLocaleString()}`);
console.log(`Frontend: ${fc.length.toLocaleString()}`);
