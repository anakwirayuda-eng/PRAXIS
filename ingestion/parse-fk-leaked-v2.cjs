/**
 * FK Leaked Parser v2 — handles lowercase a-e options
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'output');
const DIR = 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked';

const FK_FILE_CATEGORY = {
  'ANESTESI': 'Anestesi & Emergency',
  'BEDAH': 'Bedah',
  'ENDOKRINOLOGI': 'Endokrinologi',
  'FORENSIK': 'Forensik & Medikolegal',
  'GASTROENTEROHEPATOLOGI': 'Gastroenterohepatologi',
  'HEMATOIMUNO': 'Hematologi & Infeksi',
  'IKM': 'IKM & Kesmas',
  'INTEGUMEN': 'Dermatovenereologi',
  'KARDIOLOGI': 'Kardiologi',
  'MATA': 'Mata',
  'NEFROLOGI': 'Nefrologi',
  'OBSGYN': 'Obstetri & Ginekologi',
  'OBSTETRI': 'Obstetri & Ginekologi',
  'PSIKIATRI': 'Psikiatri',
  'PULMONOLOGI': 'Pulmonologi',
  'SARAF': 'Neurologi',
  'THT': 'THT-KL',
};

function getCategoryFromFilename(fn) {
  for (const [key, cat] of Object.entries(FK_FILE_CATEGORY)) {
    if (fn.toUpperCase().includes(key)) return cat;
  }
  return 'Ilmu Penyakit Dalam';
}

function parseQuestions(text, category) {
  const questions = [];
  
  // Split on numbered patterns: "1. ", "2. ", etc.
  const blocks = text.split(/(?:\n|^|\s{2,})(\d{1,3})\s*[.)]\s+/);
  
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const num = blocks[i];
    const body = (blocks[i + 1] || '').trim();
    if (body.length < 25) continue;
    
    // Try BOTH uppercase and lowercase options
    let optParts, useLower = false;
    
    // Try uppercase first: "A. " "B. "
    optParts = body.split(/\n\s*([A-E])\s*[.)]\s*/);
    if (optParts.length < 5) optParts = body.split(/\s{2,}([A-E])\s*[.)]\s*/);
    if (optParts.length < 5) optParts = body.split(/\s+([A-E])\.\s+/);
    
    // Try lowercase: "a. " "b. "
    if (optParts.length < 7) {
      optParts = body.split(/\n\s*([a-e])\s*[.)]\s*/);
      if (optParts.length >= 5) useLower = true;
    }
    if (optParts.length < 5) {
      optParts = body.split(/\s{2,}([a-e])\s*[.)]\s*/);
      if (optParts.length >= 5) useLower = true;
    }
    if (optParts.length < 5) {
      optParts = body.split(/\s+([a-e])\.\s+/);
      if (optParts.length >= 7) useLower = true;
    }
    
    if (optParts.length < 7) continue;
    
    const vignette = optParts[0].replace(/\s+/g, ' ').trim();
    if (vignette.length < 15) continue;
    
    const options = [];
    const letterPattern = useLower ? /^[a-e]$/ : /^[A-E]$/;
    
    for (let j = 1; j < optParts.length - 1; j += 2) {
      const letter = optParts[j];
      if (!letterPattern.test(letter)) continue;
      const normLetter = letter.toUpperCase();
      let optText = optParts[j + 1].split('\n')[0].replace(/\s+/g, ' ')
        .replace(/\s*(?:Jawaban|Kunci|KUNCI|Pembahasan).*$/i, '').trim();
      if (optText.length > 0 && !options.find(o => o.id === normLetter)) {
        options.push({ id: normLetter, text: optText, is_correct: false });
      }
    }
    
    if (options.length < 3) continue;
    
    // Answer key from body
    const ansMatch = body.match(/(?:Jawaban|Kunci|KUNCI|Answer)\s*[:\-=]\s*([A-Ea-e])\b/i);
    if (ansMatch) {
      const correct = ansMatch[1].toUpperCase();
      for (const opt of options) opt.is_correct = opt.id === correct;
    }
    
    questions.push({ num: parseInt(num), vignette, options, category, source: 'fk-leaked-ukmppd' });
  }
  
  // Numbered key fallback
  const keys = {};
  for (const m of text.matchAll(/(\d{1,3})\s*[.):\-]\s*([A-Ea-e])\b/g)) {
    keys[parseInt(m[1])] = m[2].toUpperCase();
  }
  for (const q of questions) {
    if (!q.options.some(o => o.is_correct) && keys[q.num]) {
      for (const opt of q.options) opt.is_correct = opt.id === keys[q.num];
    }
  }
  
  return questions;
}

(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  console.log('═══ FK Leaked Parser v2 (lowercase support) ═══\n');
  
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.pdf') && !f.includes('[BOOK]'));
  console.log(`Processing: ${files.length} PDFs\n`);
  
  const allQuestions = [];
  
  for (const file of files) {
    const filePath = path.join(DIR, file);
    const category = getCategoryFromFilename(file);
    process.stdout.write(`  ${file.substring(0, 55).padEnd(55)} `);
    
    try {
      const buf = new Uint8Array(fs.readFileSync(filePath));
      const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
      
      let fullText = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(x => x.str).join(' ') + '\n';
      }
      
      const questions = parseQuestions(fullText, category);
      const keyed = questions.filter(q => q.options.some(o => o.is_correct)).length;
      console.log(`${questions.length} Qs, ${keyed} keyed → ${category}`);
      allQuestions.push(...questions);
    } catch (e) {
      console.log(`❌ ${e.message?.substring(0, 40)}`);
    }
  }
  
  // Dedup within FK set
  const seen = new Set();
  const deduped = [];
  for (const q of allQuestions) {
    const key = q.vignette.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) { seen.add(key); deduped.push(q); }
  }
  
  // Inject into master
  const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf8'));
  const existingKeys = new Set();
  for (const c of cases) {
    const vig = (c.vignette?.narrative || '').substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (vig.length > 10) existingKeys.add(vig);
  }
  
  let sid = cases.length, added = 0, dup2 = 0;
  for (const q of deduped) {
    const key = q.vignette.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (existingKeys.has(key)) { dup2++; continue; }
    existingKeys.add(key);
    cases.push({
      _id: sid++,
      q_type: 'MCQ',
      category: q.category,
      title: q.vignette.substring(0, 80) + '...',
      vignette: { narrative: q.vignette, demographics: {} },
      prompt: 'Pilih jawaban yang paling tepat.',
      options: q.options,
      rationale: { correct: '', distractors: {} },
      meta: { source: q.source, examType: 'UKMPPD', difficulty: 2, tags: ['FK Leaked', q.category] },
    });
    added++;
  }
  
  // Save
  const tmp1 = path.join(OUTPUT, 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp1, JSON.stringify(cases), 'utf-8');
  fs.renameSync(tmp1, path.join(OUTPUT, 'compiled_cases.json'));
  
  const fc = cases.filter(c => !c.meta?.quarantined && !c.meta?.quarantine_flag);
  const tmp2 = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp2, JSON.stringify(fc), 'utf-8');
  fs.renameSync(tmp2, path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'));
  
  const keyed = deduped.filter(q => q.options.some(o => o.is_correct)).length;
  console.log('\n═══ RESULTS ═══');
  console.log(`Raw: ${allQuestions.length} | Deduped: ${deduped.length} | New: ${added} | Cross-dup: ${dup2}`);
  console.log(`Keyed: ${keyed}/${deduped.length}`);
  console.log(`Master: ${cases.length.toLocaleString()}`);
  console.log(`Frontend: ${fc.length.toLocaleString()}`);
})();
