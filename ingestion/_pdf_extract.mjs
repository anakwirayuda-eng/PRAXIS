/**
 * PDF Text Extractor helper using pdfjs-dist (Mozilla PDF.js)
 * Usage: node _pdf_extract.mjs <path-to-pdf>
 * Outputs: raw text to stdout
 */
import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const filePath = process.argv[2];
if (!filePath) { process.exit(1); }

const buf = new Uint8Array(readFileSync(filePath));
const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;

const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const text = content.items.map(item => item.str).join(' ');
  pages.push(text);
}

process.stdout.write(pages.join('\n'));
