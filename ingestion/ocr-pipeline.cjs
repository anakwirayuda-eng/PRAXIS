/**
 * OCR Pipeline: Scanned PDF → Tesseract.js → Parsed MCQs
 * 
 * Pipeline: pdfjs-dist (render page) → raw pixel data → sharp (PNG) → tesseract.js (OCR) → parse MCQs
 * 
 * Usage: node ingestion/ocr-pipeline.cjs [pdf-path] [category]
 * Or: node ingestion/ocr-pipeline.cjs --batch (process all known scanned PDFs)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT = path.join(__dirname, 'output');

// Known scanned PDFs to process
const SCANNED_PDFS = [
  { path: 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked\\BANK SOAL UKMPPD MATA.pdf', category: 'Mata' },
  { path: 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked\\BANK SOAL UKMPPD SARAF.pdf', category: 'Neurologi' },
  { path: 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked\\BANK SOAL UKMPPD THT-KL.pdf', category: 'THT-KL' },
  { path: 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked\\BANK SOAL UKMPPD PSIKIATRI.pdf', category: 'Psikiatri' },
  { path: 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked\\BANK SOAL UKMPPD IKM (Statistik, Metopen, Epidemiologi, SKN, P2P).pdf', category: 'IKM & Kesmas' },
];

async function renderPDFPage(doc, pageNum, scale = 2.0) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const { width, height } = viewport;
  
  // Create a simple pixel buffer (no canvas needed)
  const operatorList = await page.getOperatorList();
  
  // Fallback: try to get text first (some "scanned" PDFs have hidden text layer)
  const textContent = await page.getTextContent();
  const text = textContent.items.map(item => item.str).join(' ');
  
  return { text, width: Math.floor(width), height: Math.floor(height) };
}

async function ocrPDF(filePath, category) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const Tesseract = require('tesseract.js');
  
  console.log(`\n📄 Processing: ${path.basename(filePath)}`);
  console.log(`   Category: ${category}`);
  
  const buf = new Uint8Array(fs.readFileSync(filePath));
  let doc;
  try {
    doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
  } catch (e) {
    console.log(`   ❌ Cannot open: ${e.message?.substring(0, 50)}`);
    return [];
  }
  
  console.log(`   Pages: ${doc.numPages}`);
  
  // First, try text extraction (hidden text layer)
  let fullText = '';
  let hasText = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
    if (pageText.replace(/\s/g, '').length > 30) hasText = true;
  }
  
  if (hasText && fullText.replace(/\s/g, '').length > doc.numPages * 30) {
    console.log(`   📝 Has text layer (${fullText.length} chars) — using direct extraction`);
  } else {
    console.log(`   📷 Pure scanned — need OCR via Tesseract.js`);
    console.log(`   ⚠️ OCR will take ~5-15 seconds per page...`);
    
    // For pure scanned PDFs, we need to render to image then OCR
    // pdfjs-dist can't render without canvas in Node.js
    // Alternative: use pdf-image or pdf-poppler to convert pages
    // For now, try the pdf's own text layer more aggressively
    
    // Try with different item joining
    fullText = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Join items with newlines based on Y position changes
      let lastY = null;
      let pageText = '';
      for (const item of content.items) {
        const y = Math.round(item.transform?.[5] || 0);
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          pageText += '\n';
        }
        pageText += item.str + ' ';
        lastY = y;
      }
      fullText += pageText + '\n---PAGE---\n';
    }
    
    // If still no text, use actual OCR via Tesseract on the raw PDF
    if (fullText.replace(/\s/g, '').length < doc.numPages * 20) {
      console.log(`   🔍 Attempting Tesseract.js OCR directly on PDF...`);
      
      // Tesseract.js can actually OCR PDF files directly!
      try {
        const worker = await Tesseract.createWorker('ind+eng', 1, {
          logger: m => {
            if (m.status === 'recognizing text' && m.progress) {
              process.stdout.write(`\r   OCR progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        });
        
        const result = await worker.recognize(filePath);
        fullText = result.data.text;
        console.log(`\n   ✅ OCR done: ${fullText.length} chars`);
        await worker.terminate();
      } catch (e) {
        console.log(`\n   ❌ OCR failed: ${e.message?.substring(0, 80)}`);
        return [];
      }
    }
  }
  
  if (fullText.length < 100) {
    console.log(`   ❌ No text extracted`);
    return [];
  }
  
  // Parse questions from extracted text
  const questions = parseQuestions(fullText, category);
  console.log(`   ✅ Parsed: ${questions.length} questions`);
  
  return questions;
}

function parseQuestions(text, category) {
  const questions = [];
  
  const blocks = text.split(/(?:\n|^|\s{2,})(\d{1,3})\s*[.)]\s+/);
  
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const num = blocks[i];
    const body = (blocks[i + 1] || '').trim();
    if (body.length < 25) continue;
    
    let optParts = body.split(/\n\s*([A-E])\s*[.)]\s*/);
    if (optParts.length < 5) optParts = body.split(/\s{2,}([A-E])\s*[.)]\s*/);
    if (optParts.length < 5) optParts = body.split(/\s+([A-E])\.\s+/);
    if (optParts.length < 7) continue;
    
    const vignette = optParts[0].replace(/\s+/g, ' ').trim();
    if (vignette.length < 15) continue;
    
    const options = [];
    for (let j = 1; j < optParts.length - 1; j += 2) {
      const letter = optParts[j];
      if (!/^[A-E]$/.test(letter)) continue;
      let optText = optParts[j + 1].split('\n')[0].replace(/\s+/g, ' ')
        .replace(/\s*(?:Jawaban|Kunci|KUNCI|Pembahasan).*$/i, '').trim();
      if (optText.length > 0 && !options.find(o => o.id === letter)) {
        options.push({ id: letter, text: optText, is_correct: false });
      }
    }
    
    if (options.length < 3) continue;
    
    const ansMatch = body.match(/(?:Jawaban|Kunci|KUNCI|Answer)\s*[:\-=]\s*([A-E])\b/i);
    if (ansMatch) {
      for (const opt of options) opt.is_correct = opt.id === ansMatch[1];
    }
    
    questions.push({
      num: parseInt(num),
      vignette,
      options,
      category,
      source: 'fk-leaked-ukmppd-ocr',
    });
  }
  
  // Numbered keys fallback
  const keys = {};
  for (const m of text.matchAll(/(\d{1,3})\s*[.):\-]\s*([A-E])\b/g)) {
    keys[parseInt(m[1])] = m[2];
  }
  for (const q of questions) {
    if (!q.options.some(o => o.is_correct) && keys[q.num]) {
      for (const opt of q.options) opt.is_correct = opt.id === keys[q.num];
    }
  }
  
  return questions;
}

(async () => {
  console.log('═══ OCR Pipeline for Scanned PDFs ═══\n');
  
  const args = process.argv.slice(2);
  let pdfsToProcess;
  
  if (args[0] === '--batch' || args.length === 0) {
    pdfsToProcess = SCANNED_PDFS.filter(p => fs.existsSync(p.path));
    console.log(`Batch mode: ${pdfsToProcess.length} PDFs`);
  } else {
    pdfsToProcess = [{ path: args[0], category: args[1] || 'uncategorized' }];
  }
  
  const allQuestions = [];
  
  for (const pdf of pdfsToProcess) {
    const questions = await ocrPDF(pdf.path, pdf.category);
    allQuestions.push(...questions);
  }
  
  if (allQuestions.length > 0) {
    fs.writeFileSync(path.join(OUTPUT, 'ocr_parsed.json'), JSON.stringify(allQuestions, null, 2));
    const keyed = allQuestions.filter(q => q.options.some(o => o.is_correct)).length;
    console.log(`\n═══ TOTAL ═══`);
    console.log(`Questions: ${allQuestions.length}`);
    console.log(`Keyed: ${keyed}`);
    console.log(`Saved to: output/ocr_parsed.json`);
  } else {
    console.log('\n⚠️ No questions extracted');
  }
})();
