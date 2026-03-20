/**
 * Diagnostic: understand FDI Jawaban format for proper key extraction
 */
const fs = require('fs');
const path = require('path');

(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const FILE = path.join('PDF referensi', 'FDI', '[FDI] PEMBAHASAN TO FDI 1 BATCH I  2021.pdf');
  
  const buf = new Uint8Array(fs.readFileSync(FILE));
  const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
  
  // Get full text page by page, look at pages around first few "Jawaban"
  let jawabanPages = 0;
  let soalPages = 0;
  const pageTexts = [];
  
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pageTexts.push({ num: i, text });
    
    if (/SOAL/i.test(text)) soalPages++;
    if (/Jawaban/i.test(text)) jawabanPages++;
  }
  
  console.log(`Total pages: ${doc.numPages}`);
  console.log(`SOAL pages: ${soalPages}`);
  console.log(`Jawaban pages: ${jawabanPages}`);
  
  // Show first 5 pages that contain "Jawaban"
  let shown = 0;
  for (const p of pageTexts) {
    if (/Jawaban/i.test(p.text) && shown < 5) {
      console.log(`\n═══ PAGE ${p.num} (has Jawaban) ═══`);
      // Clean and show first 400 chars
      const clean = p.text
        .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R.+?\.C\s*O\s*M/gi, '')
        .replace(/©\s*FDI\d{4}/gi, '')
        .trim();
      console.log(clean.substring(0, 500));
      shown++;
    }
  }
  
  // Also show the pattern: SOAL page → Jawaban page alternation
  console.log('\n═══ PAGE TYPE SEQUENCE (first 20 pages) ═══');
  for (let i = 0; i < Math.min(20, pageTexts.length); i++) {
    const t = pageTexts[i].text;
    const hasSoal = /SOAL/i.test(t);
    const hasJawaban = /Jawaban/i.test(t);
    const hasSeorang = /Seorang/i.test(t);
    const type = hasSoal && hasSeorang ? 'SOAL+Q' : hasSoal ? 'SOAL' : hasJawaban ? 'JAWABAN' : 'OTHER';
    console.log(`  Page ${pageTexts[i].num}: ${type} (${t.length} chars)`);
  }
})();
