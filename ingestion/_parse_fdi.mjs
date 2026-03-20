/**
 * FDI Parser v2 — Uses SOAL delimiter + Jawaban extraction
 * FDI format: [SOAL header] Seorang... A. ... B. ... [Jawaban page: D. KATA_KUNCI]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const FDI_DIR = 'PDF referensi/FDI';
const OUTPUT = 'ingestion/output';

async function extractPDF(filePath) {
  const buf = new Uint8Array(readFileSync(filePath));
  
  // Try without password, then with passwords
  const passwords = ['', 'ARYO8017', 'aryo8017', 'fdi2021', 'FDI2021'];
  for (const pw of passwords) {
    try {
      const opts = { data: buf, useSystemFonts: true };
      if (pw) opts.password = pw;
      const doc = await getDocument(opts).promise;
      
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
      }
      const text = pages.join('\n');
      if (text.replace(/\s/g, '').length > doc.numPages * 20) {
        return { text, pages: doc.numPages, pw: pw || null };
      }
    } catch { /* try next */ }
  }
  return null;
}

function parseFDIQuestions(text) {
  const questions = [];
  
  // Strategy: Split on "SOAL" marker (each question starts with SOAL page header)
  // FDI format: "SOAL © FDI2020 Seorang laki-laki berusia..."
  const soalBlocks = text.split(/(?:^|\n).*?SOAL\s+/i);
  
  for (let blockIdx = 1; blockIdx < soalBlocks.length; blockIdx++) {
    const block = soalBlocks[blockIdx];
    if (block.length < 50) continue;
    
    // Clean FDI header noise
    let clean = block
      .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R.+?\.C\s*O\s*M/gi, '')
      .replace(/©\s*FDI\d{4}/gi, '')
      .trim();
    
    // Extract options A-E
    // FDI uses: "A. text B. text C. text D. text E. text"
    const optionPattern = /\b([A-E])\.\s+(.+?)(?=\s+[A-E]\.\s|\s*$|\s*Jawaban|\n.*?(?:SOAL|Keyword|Pembahasan))/gs;
    
    // Simpler: split on option markers
    const parts = clean.split(/\s+([A-E])\.\s+/);
    
    if (parts.length < 7) continue; // Need vignette + at least 3 options (A, B, C)
    
    const vignette = parts[0]
      .replace(/\s+/g, ' ')
      .replace(/^\s*\d+\s*[.)]\s*/, '') // Remove leading question number if present
      .trim();
    
    if (vignette.length < 20) continue;
    
    const options = [];
    for (let j = 1; j < parts.length - 1; j += 2) {
      const letter = parts[j];
      if (!/^[A-E]$/.test(letter)) continue;
      
      let optText = parts[j + 1]
        .split(/\n/)[0]  // Take first line only
        .replace(/\s+/g, ' ')
        .replace(/\s*(?:Jawaban|Keyword|Pembahasan|Sumber).*$/i, '')
        .trim();
      
      if (optText.length > 0 && !options.find(o => o.id === letter)) {
        options.push({ id: letter, text: optText, is_correct: false });
      }
    }
    
    if (options.length < 3) continue;
    
    questions.push({
      blockIdx,
      vignette,
      options,
      source: 'fdi-tryout',
    });
  }
  
  // Extract answer keys from Jawaban/Pembahasan pages
  // Pattern: after "Jawaban" or answer page, look for "D. DIAGNOSIS" or "A. ANSWER TEXT"
  // But more reliable: look for the first letter after each pembahasan section
  const jawabanMatches = [...text.matchAll(/(?:Jawaban|JAWABAN)\s*[:=]?\s*\n?\s*([A-E])\b/gi)];
  
  // Also try: line starting with a single letter after "Jawaban" keyword
  const jawabanBlocks = text.split(/(?:Jawaban|JAWABAN)\s/gi);
  
  let answersFound = 0;
  for (let i = 0; i < Math.min(questions.length, jawabanBlocks.length - 1); i++) {
    const block = jawabanBlocks[i + 1];
    if (!block) continue;
    
    // First capital letter A-E at the start of the answer block
    const ansMatch = block.match(/^\s*([A-E])\.\s/);
    if (ansMatch) {
      const correctLetter = ansMatch[1];
      if (questions[i]) {
        for (const opt of questions[i].options) {
          opt.is_correct = opt.id === correctLetter;
        }
        answersFound++;
      }
    }
  }
  
  // Fallback: scan for "N. X" answer key patterns
  if (answersFound < questions.length / 2) {
    const keyPattern = /(\d{1,3})\s*[.):\-]\s*([A-E])\b/g;
    const keys = {};
    for (const m of text.matchAll(keyPattern)) {
      keys[parseInt(m[1])] = m[2];
    }
    
    // Try to match by question number
    for (let i = 0; i < questions.length; i++) {
      if (questions[i].options.some(o => o.is_correct)) continue;
      const qNum = i + 1;
      if (keys[qNum]) {
        for (const opt of questions[i].options) {
          opt.is_correct = opt.id === keys[qNum];
        }
        answersFound++;
      }
    }
  }
  
  return { questions, answersFound };
}

// ═══ MAIN ═══
console.log('═══ FDI Parser v2 (SOAL-delimiter) ═══\n');

const dirs = ['PDF referensi/FDI'];
// Also check GDrive FDI folders
const gdriveBase = 'GABUNGAN-20260316T110018Z-3-001/GABUNGAN/FDI';
if (existsSync(gdriveBase)) dirs.push(gdriveBase);
const gdriveBase2 = 'GABUNGAN-20260316T110018Z-3-002/GABUNGAN/FDI';
if (existsSync(gdriveBase2)) dirs.push(gdriveBase2);
const gdriveBase3 = 'GABUNGAN-20260316T110018Z-3-003/GABUNGAN/FDI';
if (existsSync(gdriveBase3)) dirs.push(gdriveBase3);

let allQuestions = [];
let totalAnswered = 0;

for (const dir of dirs) {
  if (!existsSync(dir)) continue;
  
  const files = [];
  function walk(d) {
    for (const f of readdirSync(d)) {
      const full = join(d, f);
      try {
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else if (f.toLowerCase().endsWith('.pdf')) files.push(full);
      } catch {}
    }
  }
  walk(dir);
  
  console.log(`📁 ${dir}: ${files.length} PDFs`);
  
  for (const filePath of files) {
    const fileName = basename(filePath);
    process.stdout.write(`  ${fileName.substring(0, 55).padEnd(55)} `);
    
    const result = await extractPDF(filePath);
    if (!result) {
      console.log('❌ locked/empty');
      continue;
    }
    
    if (result.pw) process.stdout.write(`🔓(${result.pw}) `);
    
    const { questions, answersFound } = parseFDIQuestions(result.text);
    console.log(`${questions.length} Qs, ${answersFound} keyed`);
    
    allQuestions.push(...questions);
    totalAnswered += answersFound;
  }
}

// Deduplicate by vignette prefix
const seen = new Set();
const deduped = [];
for (const q of allQuestions) {
  const key = q.vignette.substring(0, 60).toLowerCase().replace(/\s+/g, ' ');
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(q);
  }
}

const withKeys = deduped.filter(q => q.options.some(o => o.is_correct)).length;

console.log('\n═══ RESULTS ═══');
console.log(`Raw questions: ${allQuestions.length}`);
console.log(`After dedup: ${deduped.length}`);
console.log(`With answer keys: ${withKeys}`);
console.log(`Without keys: ${deduped.length - withKeys}`);

// Save
writeFileSync(join(OUTPUT, 'fdi_parsed_v2.json'), JSON.stringify(deduped, null, 2));
console.log(`\nSaved to: ${OUTPUT}/fdi_parsed_v2.json`);

// Sample
if (deduped.length > 0) {
  console.log('\n═══ SAMPLE ═══');
  const s = deduped[5] || deduped[0];
  console.log(`Vignette: ${s.vignette.substring(0, 200)}...`);
  for (const o of s.options) console.log(`  ${o.id}. ${o.text.substring(0, 80)} ${o.is_correct ? '★' : ''}`);
}
