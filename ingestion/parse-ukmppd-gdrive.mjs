/**
 * UKMPPD Parser v2 — With password support + improved regex + OCR batch prep
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const BASES = [
  'GABUNGAN-20260316T110018Z-3-001/GABUNGAN',
  'GABUNGAN-20260316T110018Z-3-002/GABUNGAN',
  'GABUNGAN-20260316T110018Z-3-003/GABUNGAN',
];
const OUTPUT = 'ingestion/output';
const SKIP_FOLDERS = ['OSCE'];

// Passwords found in folder names
const PASSWORDS = ['ARYO8017', 'Ingeniobe2samakalian!', 'Youaretheb3st!', 'aryo8017'];

function findPDFs(base) {
  const result = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (!SKIP_FOLDERS.includes(f)) walk(full);
        } else if (f.toLowerCase().endsWith('.pdf') && !f.startsWith('.')) {
          result.push(full);
        }
      } catch { /* skip */ }
    }
  }
  walk(base);
  return result;
}

async function extractPDF(filePath) {
  const buf = new Uint8Array(readFileSync(filePath));
  
  // Try without password first
  try {
    const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
    return await extractText(doc);
  } catch (e) {
    if (!e.message?.includes('password') && !e.message?.includes('Password')) {
      return { text: null, error: e.message?.substring(0, 60) };
    }
  }
  
  // Try each password
  for (const pw of PASSWORDS) {
    try {
      const doc = await getDocument({ data: buf, password: pw, useSystemFonts: true }).promise;
      const text = await extractText(doc);
      if (text.text && text.text.length > 50) {
        return { ...text, unlockedWith: pw };
      }
    } catch { /* try next */ }
  }
  
  return { text: null, error: 'password-protected (all passwords failed)' };
}

async function extractText(doc) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Join with spaces between items, newlines between pages
    const pageText = content.items.map(item => item.str).join(' ');
    pages.push(pageText);
  }
  const text = pages.join('\n');
  // If very little text relative to pages, it's likely a scanned PDF
  if (text.replace(/\s/g, '').length < doc.numPages * 20) {
    return { text: null, error: 'scanned-image (needs OCR)', pages: doc.numPages };
  }
  return { text, pages: doc.numPages };
}

function parseQuestions(text, source) {
  const questions = [];
  
  // IMPROVED: Multiple parsing strategies
  
  // Strategy 1: Split on "1. Seorang..." or "1) Seorang..."
  let blocks = text.split(/(?:\n|^)\s*(\d{1,3})\s*[.)]\s+(?=[A-Z])/);
  
  if (blocks.length < 5) {
    // Strategy 2: Split on just numbered patterns with more flexibility
    blocks = text.split(/(?:\s{2,}|\n)(\d{1,3})\s*[.)]\s+/);
  }
  
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const num = blocks[i];
    const body = (blocks[i + 1] || '').trim();
    if (body.length < 25) continue;
    
    // IMPROVED: Try multiple option extraction patterns
    let vignette, options;
    
    // Pattern 1: "A. text" or "A) text" with newlines
    let optParts = body.split(/\n\s*([A-E])\s*[.)]\s*/);
    if (optParts.length >= 5) {
      vignette = optParts[0].trim();
      options = extractOptions(optParts);
    }
    
    // Pattern 2: " A. text" with double space separator
    if (!options || options.length < 3) {
      optParts = body.split(/\s{2,}([A-E])\s*[.)]\s*/);
      if (optParts.length >= 5) {
        vignette = optParts[0].trim();
        options = extractOptions(optParts);
      }
    }
    
    // Pattern 3: inline "A." "B." with single space  
    if (!options || options.length < 3) {
      optParts = body.split(/\s([A-E])\.\s+/);
      if (optParts.length >= 7) { // Need more parts for this greedy pattern
        vignette = optParts[0].trim();
        options = extractOptions(optParts);
      }
    }
    
    if (!options || options.length < 3 || !vignette || vignette.length < 15) continue;
    
    questions.push({ num: parseInt(num), vignette, options, source });
  }
  
  return questions;
}

function extractOptions(parts) {
  const options = [];
  for (let j = 1; j < parts.length - 1; j += 2) {
    const letter = parts[j];
    if (!/^[A-E]$/.test(letter)) continue;
    let text = (parts[j + 1] || '').split('\n')[0].trim();
    text = text.replace(/\s*(?:Jawaban|Kunci|Answer|KUNCI).*$/i, '').trim();
    if (text.length > 0 && !options.find(o => o.id === letter)) {
      options.push({ id: letter, text, is_correct: false });
    }
  }
  return options;
}

function findAnswerKeys(text) {
  const keys = {};
  // Multiple key patterns
  for (const m of text.matchAll(/(\d{1,3})\s*[.):\-=]\s*([A-E])\b/g)) {
    keys[parseInt(m[1])] = m[2];
  }
  // Also try: "Jawaban: A" or "Kunci: B"
  for (const m of text.matchAll(/(?:Jawaban|Kunci|Answer)\s*[:\-=]\s*([A-E])\b/gi)) {
    // These need context for question number, harder to match
  }
  return keys;
}

function getSourceLabel(filePath) {
  const low = filePath.toLowerCase();
  if (low.includes('aipki')) return 'aipki-tryout';
  if (low.includes('ukdi')) return 'ukdi-tryout';
  if (low.includes('fdi')) return 'fdi-tryout';
  if (low.includes('ingenio')) return 'ingenio-tryout';
  if (low.includes('eritrosit')) return 'eritrosit-tryout';
  if (low.includes('aesculapio')) return 'aesculapio-tryout';
  if (low.includes('sinauyuk') || low.includes('sinau')) return 'sinauyuk-tryout';
  if (low.includes('sos')) return 'sos-tryout';
  if (low.includes('medsense')) return 'medsense-tryout';
  if (low.includes('mediko')) return 'mediko-tryout';
  if (low.includes('ukmppd')) return 'ukmppd-rekapan';
  return 'ukmppd-gdrive';
}

// ═══ MAIN ═══
console.log('═══ UKMPPD GDrive PDF Parser v2 (password + improved regex) ═══\n');

const allPDFs = [];
for (const base of BASES) allPDFs.push(...findPDFs(base));

// Don't skip pembahasan — they often contain embedded MCQs too
const soalPDFs = allPDFs.filter(f => {
  const name = basename(f).toLowerCase();
  // Skip only pure kunci files (just answer lists) and coretan (handwritten notes)
  return !name.startsWith('kunci') && !name.includes('coretan');
});

console.log(`Total PDFs found: ${allPDFs.length}`);
console.log(`Processing: ${soalPDFs.length} (excluding kunci/coretan)\n`);

let totalParsed = 0, totalFailed = 0, totalScanned = 0, totalUnlocked = 0;
const allQuestions = [];
const perSourceStats = {};
const scanList = []; // PDFs that need OCR

for (let i = 0; i < soalPDFs.length; i++) {
  const filePath = soalPDFs[i];
  const fileName = basename(filePath);
  const source = getSourceLabel(filePath);
  
  process.stdout.write(`  [${i + 1}/${soalPDFs.length}] ${fileName.substring(0, 50).padEnd(50)} `);
  
  const result = await extractPDF(filePath);
  
  if (result.error?.includes('scanned')) {
    console.log(`📷 SCANNED (${result.pages} pages — needs OCR)`);
    scanList.push({ path: filePath, pages: result.pages, source });
    totalScanned++;
    continue;
  }
  
  if (!result.text || result.text.length < 50) {
    console.log(`❌ ${result.error || 'empty'}`);
    totalFailed++;
    continue;
  }
  
  if (result.unlockedWith) {
    process.stdout.write(`🔓(${result.unlockedWith}) `);
    totalUnlocked++;
  }
  
  const questions = parseQuestions(result.text, source);
  
  // Try to find answer keys in the text
  const keys = findAnswerKeys(result.text);
  let keysApplied = 0;
  for (const q of questions) {
    if (keys[q.num]) {
      for (const opt of q.options) opt.is_correct = opt.id === keys[q.num];
      keysApplied++;
    }
  }
  
  console.log(`${questions.length} Qs, ${keysApplied} keyed`);
  
  if (questions.length > 0) {
    allQuestions.push(...questions);
    perSourceStats[source] = (perSourceStats[source] || 0) + questions.length;
    totalParsed += questions.length;
  }
}

// Save
writeFileSync(join(OUTPUT, 'ukmppd_gdrive_parsed.json'), JSON.stringify(allQuestions, null, 2));

if (scanList.length > 0) {
  writeFileSync(join(OUTPUT, 'ukmppd_needs_ocr.json'), JSON.stringify(scanList, null, 2));
}

const withKeys = allQuestions.filter(q => q.options.some(o => o.is_correct)).length;

console.log('\n═══ SUMMARY ═══');
console.log(`PDFs processed: ${soalPDFs.length}`);
console.log(`Unlocked with password: ${totalUnlocked}`);
console.log(`Scanned (needs OCR): ${totalScanned} (${scanList.reduce((s, x) => s + x.pages, 0)} pages)`);
console.log(`Failed: ${totalFailed}`);
console.log(`Questions parsed: ${totalParsed}`);
console.log('\nPer source:');
for (const [src, count] of Object.entries(perSourceStats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${src}: ${count}`);
}
console.log(`\nWith answer keys: ${withKeys}/${totalParsed} (${totalParsed > 0 ? Math.round(withKeys / totalParsed * 100) : 0}%)`);
console.log(`Without keys: ${totalParsed - withKeys}`);
console.log(`\nSaved to: ${OUTPUT}/ukmppd_gdrive_parsed.json`);
if (scanList.length > 0) {
  console.log(`OCR list: ${OUTPUT}/ukmppd_needs_ocr.json (${scanList.length} PDFs)`);
}
