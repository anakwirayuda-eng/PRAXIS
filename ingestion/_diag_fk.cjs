/** Diagnose FK Leaked text format */
const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked';

(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const files = ['BANK SOAL UKMPPD MATA.pdf', 'BANK SOAL UKMPPD PSIKIATRI.pdf'];
  
  for (const file of files) {
    const buf = new Uint8Array(fs.readFileSync(path.join(DIR, file)));
    const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
    
    console.log(`\n═══ ${file} (${doc.numPages} pages) ═══`);
    
    for (let i = 1; i <= Math.min(3, doc.numPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(x => x.str).join(' ');
      console.log(`\n--- Page ${i} (${text.length} chars) ---`);
      console.log(text.substring(0, 400));
    }
    
    // Count patterns in full text
    let full = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      full += content.items.map(x => x.str).join(' ') + '\n';
    }
    
    console.log('\n--- Pattern analysis ---');
    console.log('Seorang:', (full.match(/Seorang/gi) || []).length);
    console.log('pasien:', (full.match(/pasien/gi) || []).length);
    console.log('"1." or "1)":', (full.match(/\b\d+[.)]\s/g) || []).length);
    console.log('"A." options:', (full.match(/\bA\.\s/g) || []).length);
    console.log('"a." options:', (full.match(/\ba\.\s/g) || []).length);
    console.log('"A)" options:', (full.match(/\bA\)\s/g) || []).length);
    console.log('"a)" options:', (full.match(/\ba\)\s/g) || []).length);
    console.log('Jawaban:', (full.match(/Jawaban/gi) || []).length);
  }
})();
