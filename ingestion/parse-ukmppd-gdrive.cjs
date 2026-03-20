/**
 * Universal UKMPPD PDF Parser
 * Parses tryout PDFs from: UKDI, FDI, Ingenio, Eritrosit, Aesculapio, SinauYuk, SOS, Medsense
 * 
 * Usage: node ingestion/parse-ukmppd-gdrive.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASES = [
  'GABUNGAN-20260316T110018Z-3-001/GABUNGAN',
  'GABUNGAN-20260316T110018Z-3-002/GABUNGAN',
  'GABUNGAN-20260316T110018Z-3-003/GABUNGAN',
];
const OUTPUT = path.join(__dirname, 'output');
const SKIP_FOLDERS = ['OSCE']; // Not MCQ

function findPDFs(base) {
  const result = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_FOLDERS.includes(f)) walk(full);
      } else if (f.toLowerCase().endsWith('.pdf') && !f.startsWith('.')) {
        result.push(full);
      }
    }
  }
  walk(base);
  return result;
}

function extractPDF(filePath) {
  try {
    const script = `
      const pdfMod = require('pdf-parse');
      const pdf = typeof pdfMod === 'function' ? pdfMod : pdfMod.default || pdfMod;
      const fs = require('fs');
      const buf = fs.readFileSync(process.argv[1]);
      (typeof pdf === 'function' ? pdf(buf) : Promise.reject(new Error('pdf-parse not a function')))
        .then(d => process.stdout.write(d.text))
        .catch(e => { process.stderr.write(e.message); process.exit(1); });
    `;
    const tmpScript = path.join(__dirname, '_tmp_pdf_extract.cjs');
    fs.writeFileSync(tmpScript, script);
    const result = execSync(`node "${tmpScript}" "${filePath}"`, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
    return result;
  } catch (e) {
    return null;
  }
}

function parseQuestions(text, source) {
  const questions = [];
  
  // Pattern 1: Numbered questions (1. / 1) / Soal 1)
  // Most tryout PDFs use: "1. Seorang laki-laki..." or "1) Seorang..."
  const blocks = text.split(/(?:^|\n)\s*(?:Soal\s+)?(\d{1,3})[.)]\s+/i);
  
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const num = blocks[i];
    const body = (blocks[i + 1] || '').trim();
    if (body.length < 30) continue;
    
    // Extract options A-E
    const optMatch = body.split(/\n\s*([A-E])[.)]\s*/);
    if (optMatch.length < 5) continue; // Need at least vignette + 2 options
    
    const vignette = optMatch[0].trim();
    const options = [];
    for (let j = 1; j < optMatch.length - 1; j += 2) {
      const letter = optMatch[j];
      let text = (optMatch[j + 1] || '').split('\n')[0].trim();
      // Clean trailing noise
      text = text.replace(/\s*(?:Jawaban|Kunci|Answer).*$/i, '').trim();
      if (text.length > 0) {
        options.push({ id: letter, text, is_correct: false });
      }
    }
    
    if (options.length < 3 || vignette.length < 20) continue;
    
    questions.push({
      num: parseInt(num),
      vignette,
      options,
      source,
    });
  }
  
  return questions;
}

function findAnswerKey(text) {
  // Look for answer key patterns: "1.A 2.B 3.C" or "1-A, 2-B" or "Kunci: 1.A"
  const keys = {};
  
  // Pattern: "1. A" or "1.A" or "1) A" or "1-A"
  const matches = text.matchAll(/(\d{1,3})\s*[.):\-]\s*([A-E])\b/g);
  for (const m of matches) {
    keys[parseInt(m[1])] = m[2];
  }
  
  return keys;
}

// ═══ MAIN ═══
console.log('═══ UKMPPD GDrive PDF Parser ═══\n');

const allPDFs = [];
for (const base of BASES) {
  const pdfs = findPDFs(base);
  allPDFs.push(...pdfs);
}
console.log(`Found ${allPDFs.length} PDFs (excluding OSCE)\n`);

// Separate soal vs pembahasan/kunci
const soalPDFs = allPDFs.filter(f => {
  const name = path.basename(f).toLowerCase();
  return !name.includes('pembahasan') && !name.includes('coretan') && !name.includes('kunci');
});
const kunciPDFs = allPDFs.filter(f => {
  const name = path.basename(f).toLowerCase();
  return name.includes('pembahasan') || name.includes('kunci') || name.includes('coretan');
});

console.log(`Soal PDFs: ${soalPDFs.length}`);
console.log(`Kunci/Pembahasan PDFs: ${kunciPDFs.length}\n`);

let totalParsed = 0;
let totalFailed = 0;
const allQuestions = [];
const perSourceStats = {};

for (let i = 0; i < soalPDFs.length; i++) {
  const filePath = soalPDFs[i];
  const fileName = path.basename(filePath);
  
  // Determine source label
  let source = 'ukmppd-gdrive';
  const relative = filePath.toLowerCase();
  if (relative.includes('ukdi')) source = 'ukdi-tryout';
  else if (relative.includes('fdi')) source = 'fdi-tryout';
  else if (relative.includes('ingenio')) source = 'ingenio-tryout';
  else if (relative.includes('eritrosit')) source = 'eritrosit-tryout';
  else if (relative.includes('aesculapio')) source = 'aesculapio-tryout';
  else if (relative.includes('sinauyuk')) source = 'sinauyuk-tryout';
  else if (relative.includes('sos')) source = 'sos-tryout';
  else if (relative.includes('medsense')) source = 'medsense-tryout';
  else if (relative.includes('mediko')) source = 'mediko-tryout';
  
  process.stdout.write(`  [${i + 1}/${soalPDFs.length}] ${fileName.substring(0, 50)}...`);
  
  const text = extractPDF(filePath);
  if (!text || text.length < 100) {
    console.log(' SKIP (empty/unreadable)');
    totalFailed++;
    continue;
  }
  
  const questions = parseQuestions(text, source);
  
  // Try to find answer key in the same text (some PDFs have answers at the end)
  const keys = findAnswerKey(text);
  let keysApplied = 0;
  for (const q of questions) {
    if (keys[q.num]) {
      const correctLetter = keys[q.num];
      for (const opt of q.options) {
        opt.is_correct = opt.id === correctLetter;
      }
      keysApplied++;
    }
  }
  
  console.log(` ${questions.length} Qs, ${keysApplied} keyed`);
  
  allQuestions.push(...questions);
  perSourceStats[source] = (perSourceStats[source] || 0) + questions.length;
  totalParsed += questions.length;
}

// Try to match kunci PDFs to unanswered questions
console.log('\nProcessing answer key PDFs...');
for (const kunciPath of kunciPDFs) {
  const text = extractPDF(kunciPath);
  if (!text) continue;
  const keys = findAnswerKey(text);
  const keyCount = Object.keys(keys).length;
  if (keyCount > 0) {
    console.log(`  ${path.basename(kunciPath).substring(0, 50)}: ${keyCount} keys found`);
  }
}

// Save raw parsed
fs.writeFileSync(
  path.join(OUTPUT, 'ukmppd_gdrive_parsed.json'),
  JSON.stringify(allQuestions, null, 2)
);

console.log('\n═══ SUMMARY ═══');
console.log(`Total PDFs processed: ${soalPDFs.length}`);
console.log(`Total questions parsed: ${totalParsed}`);
console.log(`Failed/unreadable: ${totalFailed}`);
console.log('\nPer source:');
for (const [src, count] of Object.entries(perSourceStats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${src}: ${count}`);
}

const withKeys = allQuestions.filter(q => q.options.some(o => o.is_correct)).length;
console.log(`\nWith answer keys: ${withKeys}/${totalParsed} (${Math.round(withKeys / totalParsed * 100)}%)`);
console.log(`Without keys: ${totalParsed - withKeys} (need manual/AI keying)`);
console.log(`\nSaved to: output/ukmppd_gdrive_parsed.json`);
